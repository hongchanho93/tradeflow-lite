use super::*;
use ::parquet::{basic::Compression, data_type::{Int64Type, DoubleType, ByteArrayType, ByteArray}, file::{properties::WriterProperties, writer::SerializedFileWriter}, schema::parser::parse_message_type};
use rusqlite::Connection;
use std::{fs, path::{Path,PathBuf}};

pub(crate) fn write_examples(path:&Path) {
    fs::create_dir_all(path).unwrap();
    let db=Connection::open(path.join("market.db")).unwrap();
    db.execute_batch("CREATE TABLE daily_bars(symbol TEXT, time INTEGER, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(symbol,time));").unwrap();
    for symbol in ["SH:600000","SZ:000001"] {
        for i in 0..5 {let close=10.0+i as f64;
            db.execute("INSERT INTO daily_bars VALUES(?1,?2,?3,?4,?5,?6,?7)",rusqlite::params![symbol,1_700_000_000i64+i*86400,close,close+1.0,close-1.0,close,100.0]).unwrap();}
    }
    drop(db);
    for (name,codec) in [("SH_600000.parquet",Compression::SNAPPY),("SZ_000001.parquet",Compression::ZSTD(Default::default()))] {
        write_parquet(&path.join(name),codec);
    }
}
fn write_parquet(path:&Path,codec:Compression) {
    let schema=Arc::new(parse_message_type("message bars { REQUIRED INT64 time (TIMESTAMP(NANOS,true)); REQUIRED DOUBLE open; REQUIRED DOUBLE high; REQUIRED DOUBLE low; REQUIRED DOUBLE close; OPTIONAL DOUBLE volume; OPTIONAL BINARY note (UTF8); REQUIRED INT64 exact; }").unwrap());
    let props=Arc::new(WriterProperties::builder().set_compression(codec).build());
    let mut writer=SerializedFileWriter::new(fs::File::create(path).unwrap(),schema,props).unwrap();
    for range in [0..3,3..5] {
        let indices:Vec<_>=range.collect();let mut group=writer.next_row_group().unwrap();
        let mut column=group.next_column().unwrap().unwrap();
        column.typed::<Int64Type>().write_batch(&indices.iter().map(|i|(1_700_000_000i64+i*86400)*1_000_000_000+123).collect::<Vec<_>>(),None,None).unwrap();column.close().unwrap();
        for delta in [0.0,1.0,-1.0,0.0] {
            let mut column=group.next_column().unwrap().unwrap();column.typed::<DoubleType>().write_batch(&indices.iter().map(|i|10.0+*i as f64+delta).collect::<Vec<_>>(),None,None).unwrap();column.close().unwrap();
        }
        let mut column=group.next_column().unwrap().unwrap();column.typed::<DoubleType>().write_batch(&indices.iter().map(|_|100.0).collect::<Vec<_>>(),Some(&vec![1;indices.len()]),None).unwrap();column.close().unwrap();
        let mut column=group.next_column().unwrap().unwrap();
        let defs:Vec<_>=indices.iter().map(|i|if *i==1{0}else{1}).collect();
        let notes:Vec<ByteArray>=indices.iter().filter(|i|**i!=1).map(|_|ByteArray::from("中文,\"样本\"\n第二行")).collect();
        column.typed::<ByteArrayType>().write_batch(&notes,Some(&defs),None).unwrap();column.close().unwrap();
        let mut column=group.next_column().unwrap().unwrap();column.typed::<Int64Type>().write_batch(&indices.iter().map(|i|9_007_199_254_740_993i64+i).collect::<Vec<_>>(),None,None).unwrap();column.close().unwrap();
        group.close().unwrap();
    }
    writer.close().unwrap();
}
struct Fixture{path:PathBuf,root:RootGrant}
impl Fixture{
    fn new()->Self{let path=std::env::temp_dir().join(format!("tf-formats-{}",crate::user_data::library::token().unwrap()));write_examples(&path);let root=RootGrant::select(&path).unwrap();Self{path,root}}
    fn run(&self,request:Value)->Result<Value,String>{let request:FileOperation=serde_json::from_value(request).unwrap();execute(&self.root,&request,Arc::new(||Ok(())))}
    fn sql(&self,sql:&str,parameters:Value,limit:usize)->Result<Value,String>{self.run(json!({"operation":"sqlite","path":"market.db","sql":sql,"parameters":parameters,"limit":limit}))}
    fn page(&self,path:&str,offset:usize,limit:usize)->Result<Value,String>{self.run(json!({"operation":"parquet","path":path,"offset":offset,"limit":limit}))}
}
impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.path);}}

#[test]fn sqlite_real_database_bounded_query_parameters_schema_and_original_bytes(){
    let f=Fixture::new();let before=fs::read(f.path.join("market.db")).unwrap();
    let result=f.sql("SELECT time,close FROM daily_bars WHERE symbol=?1 ORDER BY time",json!(["SH:600000"]),2).unwrap();
    assert_eq!(result["columns"],json!(["time","close"]));assert_eq!(result["rows"],json!([[1700000000,10.0],[1700086400,11.0]]));assert_eq!(result["truncated"],true);
    let page=f.run(json!({"operation":"sqlite","path":"market.db","sql":"SELECT close FROM daily_bars WHERE symbol=?1 AND time>?2 ORDER BY time","parameters":["SH:600000",1700086400],"limit":3,"fileRevision":result["revision"]})).unwrap();
    assert_eq!(page["rows"],json!([[12.0],[13.0],[14.0]]));assert_eq!(page["truncated"],false);
    assert_eq!(f.sql("SELECT name FROM sqlite_schema WHERE type='table'",json!([]),5).unwrap()["rows"],json!([["daily_bars"]]));
    assert_eq!(f.sql("PRAGMA table_info('daily_bars')",json!([]),20).unwrap()["rows"].as_array().unwrap().len(),7);
    assert!(f.sql("SELECT * FROM daily_bars WHERE symbol=?1",json!(["SH:600000' OR 1=1 --"]),10).unwrap()["rows"].as_array().unwrap().is_empty());
    assert_eq!(fs::read(f.path.join("market.db")).unwrap(),before);
    assert_eq!(fs::read_dir(&f.path).unwrap().count(),3);
}
#[test]fn sqlite_denies_mutation_attach_extension_configuration_and_multiple_statements(){
    let f=Fixture::new();let before=fs::read(f.path.join("market.db")).unwrap();
    for sql in ["DELETE FROM daily_bars","CREATE TABLE injected(x)","ATTACH DATABASE 'outside.db' AS other","VACUUM INTO 'copy.db'","SELECT load_extension('x')","SELECT readfile('x')","PRAGMA writable_schema=ON","PRAGMA journal_mode=WAL","SELECT 1; SELECT 2"] {
        assert!(f.sql(sql,json!([]),10).is_err(),"{sql}");
    }
    assert_eq!(fs::read(f.path.join("market.db")).unwrap(),before);assert_eq!(fs::read_dir(&f.path).unwrap().count(),3);
}
#[test]fn sqlite_precision_null_binary_and_output_limits(){
    let f=Fixture::new();let r=f.sql("SELECT 9007199254740993, NULL, x'0041ff'",json!([]),1).unwrap();
    assert_eq!(r["rows"][0],json!([{"type":"integer","value":"9007199254740993"},null,{"type":"binary","value":"0041ff"}]));
    assert!(f.sql("SELECT randomblob(1000000000)",json!([]),1).is_err());
    assert!(f.sql("SELECT 1",json!([2]),1).is_err());
}
#[test]fn sqlite_schema_initialization_uses_the_same_limits_as_queries(){
    let f=Fixture::new();
    let db=Connection::open(f.path.join("market.db")).unwrap();
    let columns=(0..200).map(|n|format!("c{n} INTEGER")).collect::<Vec<_>>().join(",");
    db.execute_batch(&format!("CREATE TABLE oversized({columns});")).unwrap();drop(db);
    // Bootstrap PRAGMAs can load schema before the user's SELECT. The same
    // column/parser budgets must already be active at that first SQL boundary.
    assert!(f.sql("SELECT c0 FROM oversized",json!([]),1).is_err());
}
#[test]fn sqlite_active_wal_and_journal_are_not_silently_ignored(){
    let f=Fixture::new();let db=Connection::open(f.path.join("market.db")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; INSERT INTO daily_bars VALUES('SH:600002',1,1,1,1,1,1);").unwrap();
    assert_eq!(f.sql("SELECT count(*) FROM daily_bars",json!([]),1).unwrap_err(),"data_sqlite_snapshot_required");drop(db);
    // WAL mode remains declared after clean close, even without a sidecar.
    assert_eq!(f.sql("SELECT 1",json!([]),1).unwrap_err(),"data_sqlite_snapshot_required");
}
#[test]fn format_revision_cancel_revoke_and_corruption_are_isolated(){
    let f=Fixture::new();let first=f.page("SH_600000.parquet",0,1).unwrap();
    let request:FileOperation=serde_json::from_value(json!({"operation":"parquet","path":"SH_600000.parquet","offset":0,"limit":1})).unwrap();
    assert_eq!(execute(&f.root,&request,Arc::new(||Err("data_cancelled".into()))).unwrap_err(),"data_cancelled");
    fs::write(f.path.join("SH_600000.parquet"),b"corrupt").unwrap();
    assert_eq!(f.run(json!({"operation":"parquet","path":"SH_600000.parquet","offset":1,"limit":1,"fileRevision":first["revision"]})).unwrap_err(),"data_file_changed");
    assert_eq!(f.page("SH_600000.parquet",0,1).unwrap_err(),"data_invalid_parquet");
    f.root.revoke();assert_eq!(f.sql("SELECT 1",json!([]),1).unwrap_err(),"data_revoked");
}
#[test]fn sqlite_compute_is_interruptible_and_does_not_return_partial_rows(){
    let f=Fixture::new();let ticks=Arc::new(AtomicUsize::new(0));let active=ticks.clone();
    let request=serde_json::from_value(json!({"operation":"sqlite","path":"market.db","sql":"WITH RECURSIVE n(v) AS (VALUES(1) UNION ALL SELECT v+1 FROM n WHERE v<1000000000) SELECT sum(v) FROM n","parameters":[],"limit":1})).unwrap();
    let result=execute(&f.root,&request,Arc::new(move||if active.fetch_add(1,Ordering::Relaxed)>30{Err("data_cancelled".into())}else{Ok(())}));
    assert_eq!(result.unwrap_err(),"data_cancelled");assert!(ticks.load(Ordering::Relaxed)<100);
}
#[test]fn parquet_multiple_row_groups_projection_null_unicode_and_exact_nanoseconds(){
    let f=Fixture::new();let before=fs::read(f.path.join("SH_600000.parquet")).unwrap();
    let r=f.run(json!({"operation":"parquet","path":"SH_600000.parquet","offset":1,"limit":3,"columns":["note","time","close","exact"]})).unwrap();
    assert_eq!(r["columns"],json!(["note","time","close","exact"]));assert_eq!(r["totalRows"],5);assert_eq!(r["nextOffset"],4);
    assert_eq!(r["rows"][0][0],Value::Null);assert!(r["rows"][1][0].as_str().unwrap().contains("中文"));
    assert_eq!(r["rows"][0][1],json!({"type":"integer","value":"1700086400000000123"}));
    assert_eq!(r["rows"][0][3],json!({"type":"integer","value":"9007199254740994"}));
    assert!(r["types"][1].as_str().unwrap().to_ascii_lowercase().contains("nanos"));
    assert_eq!(fs::read(f.path.join("SH_600000.parquet")).unwrap(),before);
}
#[test]fn parquet_metadata_only_eof_and_missing_column(){
    let f=Fixture::new();let m=f.page("SH_600000.parquet",0,0).unwrap();assert_eq!(m["rows"],json!([]));assert_eq!(m["totalRows"],5);assert!(m.get("nextOffset").is_none());
    let eof=f.page("SH_600000.parquet",5,10).unwrap();assert_eq!(eof["rows"],json!([]));assert_eq!(eof["truncated"],false);
    assert!(f.run(json!({"operation":"parquet","path":"SH_600000.parquet","offset":0,"limit":2,"columns":["missing"]})).is_err());
}
#[test]fn parquet_common_codecs_decode_same_rows(){
    let f=Fixture::new();let expected=f.page("SH_600000.parquet",0,10).unwrap()["rows"].clone();
    for (index,codec) in [Compression::UNCOMPRESSED,Compression::GZIP(Default::default()),Compression::ZSTD(Default::default()),Compression::BROTLI(Default::default()),Compression::LZ4_RAW].into_iter().enumerate(){
        let name=format!("codec{index}.parquet");write_parquet(&f.path.join(&name),codec);
        assert_eq!(f.page(&name,0,10).unwrap()["rows"],expected,"{codec:?}");
    }
}
#[cfg(unix)]
#[test]fn format_paths_and_external_symlinks_never_escape_grant(){
    let f=Fixture::new();let other=Fixture::new();std::os::unix::fs::symlink(other.path.join("market.db"),f.path.join("outside.db")).unwrap();
    for path in ["../market.db","/etc/passwd","outside.db"]{assert!(f.run(json!({"operation":"sqlite","path":path,"sql":"SELECT 1","parameters":[],"limit":1})).is_err());}
    std::os::unix::fs::symlink("market.db",f.path.join("alias.db")).unwrap();
    assert_eq!(f.run(json!({"operation":"sqlite","path":"alias.db","sql":"SELECT 1","parameters":[],"limit":1})).unwrap_err(),"data_sqlite_snapshot_required");
}
