use super::*;
use crate::market_data;
fn input() -> QueryInput { QueryInput::History { provider_id: "tdx".into(), symbol: "SH:600000".into(), kind: SymbolKind::Stock, resolution: Resolution::Day, adjustment: Adjustment::None, count: 10 } }

#[test]
fn foreground_changes_never_cancel_independent_queries_or_vice_versa() {
    let state = MarketQueryState::default();
    let id = state.reserve(input()).unwrap(); let lease = state.start(&id).unwrap();
    // A deliberately stale foreground incarnation must not govern the independent scope.
    market_data::activate_history_incarnation(2);
    market_data::with_history_incarnation(1, || {
        assert!(!market_data::history_request_is_active());
        with_scope(lease.job.clone(), || {
            assert!(market_data::history_request_is_active());
            state.cancel(&id);
            assert!(!market_data::history_request_is_active());
        });
        assert!(!is_independent());
    });
    drop(lease);
    assert!(market_data::history_request_is_active());
}
#[test]
fn cancellation_before_execution_cannot_be_revived() {
    let state = MarketQueryState::default(); let id = state.reserve(input()).unwrap();
    state.cancel(&id); assert!(state.start(&id).is_err());
    assert!(state.jobs.lock().unwrap().is_empty());
}
#[test]
fn cancelled_running_jobs_keep_slots_until_they_really_exit() {
    let state = MarketQueryState::default(); let mut leases = Vec::new();
    for _ in 0..QUERY_SLOTS { let id = state.reserve(input()).unwrap(); leases.push(state.start(&id).unwrap()); state.cancel(&id); }
    state.reset(); assert_eq!(state.reserve(input()).unwrap_err(), "busy");
    leases.pop(); assert!(state.reserve(input()).is_ok());
    drop(leases); state.reset(); assert!(state.jobs.lock().unwrap().is_empty());
}
#[test]
fn duplicate_execution_and_stale_tickets_are_rejected() {
    let state = MarketQueryState::default(); let id = state.reserve(input()).unwrap(); let lease = state.start(&id).unwrap();
    assert!(state.start(&id).is_err()); drop(lease); assert!(state.start(&id).is_err());
}
#[test]
fn panic_restores_thread_scope_and_releases_lease() {
    let state = MarketQueryState::default(); let id = state.reserve(input()).unwrap(); let lease = state.start(&id).unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _lease = lease; with_scope(_lease.job.clone(), || panic!("fixture")); }));
    assert!(result.is_err()); assert!(!is_independent()); assert!(state.jobs.lock().unwrap().is_empty());
}
#[test]
fn request_shape_and_budget_are_checked_before_reservation() {
    let old = MarketQueryState::default(); let id = old.reserve(input()).unwrap(); let lease = old.start(&id).unwrap();
    let job = lease.job.clone(); drop(lease); old.reset(); assert_eq!(job.check().unwrap_err(), "cancelled");
    let state = MarketQueryState::default();
    for symbol in ["no-colon", "sh:600000", "SH:600000:extra", "../../file"] {
        assert!(state.reserve(QueryInput::Quote { provider_id: "tdx".into(), symbol: symbol.into(), kind: SymbolKind::Stock }).is_err());
    }
    let mut value = serde_json::json!({"operation":"history","providerId":"tdx","symbol":"SH:600000","kind":"stock","resolution":"1D","adjustment":"none","count":12001});
    assert!(state.reserve(serde_json::from_value(value.clone()).unwrap()).is_err());
    value["count"] = 12000.into(); value["sourcePath"] = "/fixture".into();
    assert!(serde_json::from_value::<QueryInput>(value).is_err());
    assert!(state.jobs.lock().unwrap().is_empty());
}
#[test]
fn expired_reservations_are_pruned_but_expired_workers_are_not() {
    let state = MarketQueryState::default(); let id = state.reserve(input()).unwrap();
    { let mut jobs = state.jobs.lock().unwrap(); Arc::get_mut(jobs.get_mut(&id).unwrap()).unwrap().deadline = Instant::now(); }
    assert!(state.start(&id).is_err()); state.reserve(input()).unwrap();
    assert!(!state.jobs.lock().unwrap().contains_key(&id));
}

struct FixtureAdapter;
static FIXTURE: FixtureAdapter = FixtureAdapter;
static DESCRIPTOR: crate::market_adapter::ProviderDescriptor = crate::market_adapter::ProviderDescriptor {
    id: "fixture",
    display_name: "Fixture",
    version: "1",
    contract_version: crate::market_adapter::ADAPTER_CONTRACT_VERSION,
    enabled: true,
    capabilities: crate::market_adapter::ProviderCapabilities {
        catalog: false,
        history: true,
        quote: false,
        realtime: false,
        venues: &["SH"],
        kinds: &[crate::contracts::SymbolKind::Stock],
        resolutions: &[crate::contracts::Resolution::Day],
        adjustments: &[crate::contracts::Adjustment::None],
    },
};
impl crate::market_adapter::MarketDataAdapter for FixtureAdapter {
    fn descriptor(&self) -> &'static crate::market_adapter::ProviderDescriptor { &DESCRIPTOR }
    fn fetch_history(&self, r: HistoryRequest) -> Result<crate::market_adapter::HistoryResponse, crate::contracts::AppError> {
        assert!(is_independent()); assert!(!r.include_quote);
        Ok(crate::market_adapter::HistoryResponse { symbol:r.symbol, series_kind:crate::contracts::MarketSeriesKind::Ohlcv,
            bars: vec![crate::contracts::Bar::new(1,10.,12.,9.,11.,100.,None)],points:vec![],quote:None,
            diagnostics:crate::market_adapter::HistoryDiagnostics {source:"fixture",host:"local".into(),latency_ms:1.} })
    }
}
#[test]
fn independent_execute_reuses_router_validation_and_serialization() {
    let state=MarketQueryState::default();
    let router=MarketRouter::new([crate::market_adapter::AdapterRegistration::new(&FIXTURE)]).unwrap();
    let q=QueryInput::History {provider_id:"fixture".into(),symbol:"SH:600000".into(),kind:SymbolKind::Stock,resolution:Resolution::Day,adjustment:Adjustment::None,count:10};
    let id=state.reserve(q).unwrap();let result=execute(state.start(&id).unwrap(),router).unwrap();
    assert_eq!(result["bars"][0]["close"],11.);assert_eq!(result["symbol"],"SH:600000");
    assert!(state.jobs.lock().unwrap().is_empty());assert!(!is_independent());
}
#[test]
fn cancelled_request_never_enters_provider_code() {
    let state=MarketQueryState::default();let id=state.reserve(input()).unwrap();let lease=state.start(&id).unwrap();
    state.cancel(&id);assert_eq!(execute(lease,MarketRouter::builtin().unwrap()).unwrap_err(),"cancelled");
    assert!(state.jobs.lock().unwrap().is_empty());
}
