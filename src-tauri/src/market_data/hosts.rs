//! 公共主站池：测速排序、失败冷却，以及“整次请求在一台主站上完成，失败则整次换站”的执行器。
//!
//! 任何需要访问主站的功能都应通过 [`run_with_failover`] 执行，不得跨主站拼接半截数据。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use tradeflow_tdx::standard::{BarPeriod, Market, SecurityBars, Standard};
use tradeflow_tdx::{Client, SecurityCode, Session};

/// 59.36.5.11:7709 及主项目已确认的慢站/不稳定站不进入本池。
/// 节点覆盖陕西、浙江、上海、北京、武汉、深圳和广州，并分散在传统运营商与双线 CDN。
pub(crate) const DEFAULT_HOSTS: [&str; 19] = [
    // 陕西电信现有集群。
    "117.34.114.15:7709",
    "117.34.114.14:7709",
    "117.34.114.18:7709",
    "117.34.114.20:7709",
    "117.34.114.17:7709",
    "117.34.114.27:7709",
    "117.34.114.16:7709",
    // 传统运营商异地节点：浙江、上海、北京、武汉。
    "115.238.56.198:7709",
    "60.12.136.250:7709",
    "180.153.18.170:7709",
    "202.108.253.139:80",
    "119.97.185.59:7709",
    // 官方双线/CDN：深圳、上海、北京、广州，且交叉使用华为云与腾讯云。
    "110.41.2.72:7709",
    "101.33.225.16:7709",
    "150.158.160.2:7709",
    "123.60.164.122:7709",
    "49.232.15.141:7709",
    "43.139.18.171:7709",
    "116.205.183.150:7709",
];
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1_500);
const HOST_COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostProbe {
    pub host: String,
    pub ok: bool,
    pub latency_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct HostAttempt {
    pub host: String,
    pub error: String,
}

#[derive(Debug)]
pub(crate) struct HostSuccess<T> {
    pub host: String,
    pub latency_ms: f64,
    pub value: T,
    pub attempts: Vec<HostAttempt>,
}

#[derive(Default)]
struct HostPoolState {
    ranked: Vec<String>,
    cooldown_until: HashMap<String, Instant>,
}

struct ReusableConnection<C> {
    host: String,
    client: C,
}

static HOST_POOL: OnceLock<Mutex<HostPoolState>> = OnceLock::new();
static ACTIVE_CONNECTION: OnceLock<Mutex<Option<ReusableConnection<Client<Standard>>>>> =
    OnceLock::new();

fn pool() -> std::sync::MutexGuard<'static, HostPoolState> {
    HOST_POOL
        .get_or_init(|| Mutex::new(HostPoolState::default()))
        .lock()
        .expect("host pool mutex poisoned")
}

fn elapsed_ms(started: Instant) -> f64 {
    (started.elapsed().as_secs_f64() * 10_000.0).round() / 10.0
}

fn active_connection()
-> std::sync::MutexGuard<'static, Option<ReusableConnection<Client<Standard>>>> {
    ACTIVE_CONNECTION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("active TDX connection mutex poisoned")
}

fn run_reusing_connection<C, T, E>(
    slot: &mut Option<ReusableConnection<C>>,
    host: &str,
    connect: impl FnOnce() -> Result<C, E>,
    task: impl FnOnce(&mut C) -> Result<T, E>,
) -> Result<T, E> {
    if slot
        .as_ref()
        .is_none_or(|connection| connection.host != host)
    {
        let client = connect()?;
        *slot = Some(ReusableConnection {
            host: host.to_string(),
            client,
        });
    }
    let result = task(&mut slot.as_mut().expect("connection was initialized").client);
    if result.is_err() {
        *slot = None;
    }
    result
}

/// 在一条可复用连接上执行 `task`。同一时刻只允许一个请求使用连接；失败后丢弃连接。
pub(crate) fn connect_and_run<T>(
    host: &str,
    task: impl FnOnce(&mut Client<Standard>) -> Result<T, String>,
) -> Result<T, String> {
    crate::market_query::check_active()?;
    if crate::market_query::is_independent() {
        // Private connection for the whole paged request; never lock the foreground socket.
        let mut client = Client::<Standard>::connect(host, CONNECT_TIMEOUT).map_err(|error| error.to_string())?;
        crate::market_query::check_active()?;
        return task(&mut client);
    }
    let mut slot = active_connection();
    let reused = slot
        .as_ref()
        .is_some_and(|connection| connection.host == host);
    let result = run_reusing_connection(
        &mut slot,
        host,
        || {
            eprintln!("market.connection.open host={host}");
            Client::<Standard>::connect(host, CONNECT_TIMEOUT).map_err(|error| error.to_string())
        },
        task,
    );
    if result.is_err() {
        eprintln!("market.connection.failed host={host} reused={reused}");
    }
    result
}

/// 按顺序在每台主站上完整执行一次 `attempt`，返回第一台成功的结果；全部失败时返回每台的错误。
pub(crate) fn run_with_failover<T>(
    hosts: &[String],
    mut attempt: impl FnMut(&str) -> Result<T, String>,
) -> Result<HostSuccess<T>, Vec<HostAttempt>> {
    let mut attempts = Vec::new();
    for host in hosts {
        if crate::market_query::check_active().is_err() { break; }
        let started = Instant::now();
        match attempt(host) {
            Ok(value) => {
                return Ok(HostSuccess {
                    host: host.clone(),
                    latency_ms: elapsed_ms(started),
                    value,
                    attempts,
                });
            }
            Err(error) => attempts.push(HostAttempt {
                host: host.clone(),
                error,
            }),
        }
    }
    Err(attempts)
}

fn probe_host(host: &str) -> HostProbe {
    let started = Instant::now();
    let result = Client::<Standard>::connect(host, CONNECT_TIMEOUT)
        .map_err(|error| error.to_string())
        .and_then(|mut client| {
            let rows = client
                .call(&SecurityBars {
                    market: Market::Shanghai,
                    code: SecurityCode::new("600000").expect("valid probe code"),
                    period: BarPeriod::Day,
                    offset: 0,
                    count: 1,
                })
                .map_err(|error| error.to_string())?;
            if rows.is_empty() {
                return Err("daily capability probe returned empty data".to_string());
            }
            Ok(())
        });
    HostProbe {
        host: host.to_string(),
        ok: result.is_ok(),
        latency_ms: elapsed_ms(started),
        error: result.err(),
    }
}

fn rank_probes(mut probes: Vec<HostProbe>, hosts: &[&str]) -> Vec<HostProbe> {
    let order = |host: &str| hosts.iter().position(|candidate| *candidate == host);
    probes.sort_by(|left, right| {
        (!left.ok)
            .cmp(&!right.ok)
            .then(left.latency_ms.total_cmp(&right.latency_ms))
            .then(order(&left.host).cmp(&order(&right.host)))
    });
    probes
}

/// 并发探测全部主站，按“可用优先、延迟升序”排序，并刷新主站池。
pub(crate) fn benchmark(hosts: &[&str]) -> Vec<HostProbe> {
    let probes = thread::scope(|scope| {
        let handles = hosts
            .iter()
            .map(|host| scope.spawn(move || probe_host(host)))
            .collect::<Vec<_>>();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("host probe thread panicked"))
            .collect::<Vec<_>>()
    });
    let probes = rank_probes(probes, hosts);
    let preferred = probes
        .iter()
        .find(|probe| probe.ok)
        .map(|probe| probe.host.as_str());
    let mut state = pool();
    state.ranked = probes.iter().map(|probe| probe.host.clone()).collect();
    for probe in &probes {
        if probe.ok {
            state.cooldown_until.remove(&probe.host);
        } else {
            state
                .cooldown_until
                .insert(probe.host.clone(), Instant::now() + HOST_COOLDOWN);
        }
    }
    drop(state);
    let mut connection = active_connection();
    if connection
        .as_ref()
        .is_some_and(|connection| Some(connection.host.as_str()) != preferred)
    {
        eprintln!(
            "market.connection.reset host={} reason=benchmark_reranked",
            connection.as_ref().expect("checked active connection").host
        );
        *connection = None;
    }
    probes
}

/// 当前应尝试的主站顺序。首次调用会先测速；冷却中的主站排除在外，全部冷却时全部重试。
pub(crate) fn ordered_hosts() -> Vec<String> {
    if crate::market_query::is_independent() {
        let state = pool();
        return if state.ranked.is_empty() { DEFAULT_HOSTS.iter().map(|host| host.to_string()).collect() }
            else { filter_available_hosts(&state.ranked, &state.cooldown_until, Instant::now()) };
    }
    let needs_benchmark = pool().ranked.is_empty();
    if needs_benchmark {
        let probes = benchmark(&DEFAULT_HOSTS);
        eprintln!(
            "market.hosts.ready healthy={} total={} fastest={}",
            probes.iter().filter(|probe| probe.ok).count(),
            probes.len(),
            probes
                .iter()
                .find(|probe| probe.ok)
                .map(|probe| probe.host.as_str())
                .unwrap_or("none")
        );
    }
    let state = pool();
    filter_available_hosts(&state.ranked, &state.cooldown_until, Instant::now())
}

fn filter_available_hosts(
    ranked: &[String],
    cooldown_until: &HashMap<String, Instant>,
    now: Instant,
) -> Vec<String> {
    let available = ranked
        .iter()
        .filter(|host| cooldown_until.get(*host).is_none_or(|until| *until <= now))
        .cloned()
        .collect::<Vec<_>>();
    if available.is_empty() {
        ranked.to_vec()
    } else {
        available
    }
}

/// 记录一次请求的结果：成功的主站解除冷却，失败的主站进入冷却。
pub(crate) fn record_attempts(selected: Option<&str>, attempts: &[HostAttempt]) {
    if crate::market_query::is_independent() { return; }
    let mut state = pool();
    let now = Instant::now();
    if let Some(selected) = selected {
        state.cooldown_until.remove(selected);
    }
    for attempt in attempts {
        eprintln!(
            "market.host.failed host={} error={}",
            attempt.host, attempt.error
        );
        state
            .cooldown_until
            .insert(attempt.host.clone(), now + HOST_COOLDOWN);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    use super::{
        DEFAULT_HOSTS, HostAttempt, HostProbe, filter_available_hosts, rank_probes,
        run_reusing_connection, run_with_failover,
    };

    #[test]
    fn connection_is_reused_for_the_same_host_and_discarded_after_failure() {
        let mut slot = None;
        let mut connections = 0;

        for expected in [1, 2] {
            let value = run_reusing_connection(
                &mut slot,
                "fast:7709",
                || {
                    connections += 1;
                    Ok::<_, &'static str>(40)
                },
                |client| Ok::<_, &'static str>(*client + expected),
            )
            .unwrap();
            assert_eq!(value, 40 + expected);
        }
        assert_eq!(connections, 1, "same host should keep one connection");

        let failure = run_reusing_connection(
            &mut slot,
            "fast:7709",
            || unreachable!("existing connection should be reused"),
            |_| Err::<(), _>("connection lost"),
        );
        assert_eq!(failure, Err("connection lost"));
        assert!(slot.is_none(), "failed connection must be discarded");

        run_reusing_connection(
            &mut slot,
            "fast:7709",
            || {
                connections += 1;
                Ok::<_, &'static str>(50)
            },
            |_| Ok::<_, &'static str>(()),
        )
        .unwrap();
        assert_eq!(connections, 2, "next request should reconnect");

        run_reusing_connection(
            &mut slot,
            "backup:7709",
            || {
                connections += 1;
                Ok::<_, &'static str>(60)
            },
            |_| Ok::<_, &'static str>(()),
        )
        .unwrap();
        assert_eq!(
            connections, 3,
            "changing host should replace the connection"
        );
        assert_eq!(slot.as_ref().unwrap().host, "backup:7709");
    }

    #[test]
    fn independent_query_does_not_lock_foreground_connection() {
        let held = super::active_connection();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || crate::market_query::test_scope(|| {
            // Port zero refuses locally; no request is sent to a market server.
            let _ = super::connect_and_run("127.0.0.1:0", |_| Ok(()));
            tx.send(()).unwrap();
        }));
        let independent = rx.recv_timeout(Duration::from_secs(3)).is_ok();
        drop(held); worker.join().unwrap();
        assert!(independent, "background TDX must not wait for the foreground connection lock");
    }

    #[test]
    fn default_pool_covers_independent_regions_and_networks() {
        assert_eq!(DEFAULT_HOSTS.len(), 19);
        for host in [
            "180.153.18.170:7709",
            "202.108.253.139:80",
            "115.238.56.198:7709",
            "60.12.136.250:7709",
            "119.97.185.59:7709",
            "110.41.2.72:7709",
            "101.33.225.16:7709",
            "150.158.160.2:7709",
            "123.60.164.122:7709",
            "49.232.15.141:7709",
            "43.139.18.171:7709",
            "116.205.183.150:7709",
        ] {
            assert!(DEFAULT_HOSTS.contains(&host), "missing host {host}");
        }
        for rejected in [
            "59.36.5.11:7709",
            "110.41.147.114:7709",
            "124.70.133.119:7709",
        ] {
            assert!(!DEFAULT_HOSTS.contains(&rejected));
        }
    }

    #[test]
    fn cooling_hosts_are_skipped_but_all_hosts_get_a_recovery_attempt() {
        let ranked = vec!["fast:7709".to_string(), "backup:7709".to_string()];
        let now = Instant::now();
        let mut cooldowns = HashMap::new();
        cooldowns.insert(ranked[0].clone(), now + Duration::from_secs(30));
        assert_eq!(
            filter_available_hosts(&ranked, &cooldowns, now),
            vec![ranked[1].clone()]
        );

        cooldowns.insert(ranked[1].clone(), now + Duration::from_secs(30));
        assert_eq!(filter_available_hosts(&ranked, &cooldowns, now), ranked);
    }

    #[test]
    fn failover_discards_failed_host_and_returns_one_complete_host() {
        let hosts = vec!["first:7709".to_string(), "second:7709".to_string()];
        let mut tried = Vec::new();
        let success = run_with_failover(&hosts, |host| {
            tried.push(host.to_string());
            if host == "first:7709" {
                Err("empty 1D response".to_string())
            } else {
                Ok(42)
            }
        })
        .unwrap();
        assert_eq!(tried, hosts);
        assert_eq!((success.host.as_str(), success.value), ("second:7709", 42));
        assert_eq!(
            success.attempts,
            [HostAttempt {
                host: "first:7709".to_string(),
                error: "empty 1D response".to_string()
            }]
        );

        let failures = run_with_failover(&hosts, |_| Err::<(), _>("down".to_string())).unwrap_err();
        assert_eq!(failures.len(), 2);
    }

    #[test]
    fn benchmark_sorts_healthy_hosts_by_protocol_latency() {
        let probe = |host: &str, ok: bool, latency_ms: f64| HostProbe {
            host: host.to_string(),
            ok,
            latency_ms,
            error: None,
        };
        let ranked = rank_probes(
            vec![
                probe("slow:7709", true, 90.0),
                probe("bad:7709", false, 5.0),
                probe("tie-b:7709", true, 20.0),
                probe("fast:7709", true, 20.0),
            ],
            &["fast:7709", "slow:7709", "bad:7709", "tie-b:7709"],
        );
        assert_eq!(
            ranked
                .iter()
                .map(|probe| probe.host.as_str())
                .collect::<Vec<_>>(),
            ["fast:7709", "tie-b:7709", "slow:7709", "bad:7709"]
        );
    }
}
