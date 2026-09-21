use super::{compact::Compact, FormatFile, MAX_CELL, MAX_COLUMNS, add_row, binary, float, integer};
use bytes::Bytes;
use parquet::{basic::{Compression, Type as Physical}, errors::ParquetError,
    file::{reader::{ChunkReader, FileReader, Length}, serialized_reader::SerializedFileReader, metadata::ColumnChunkMetaData},
    record::Field, schema::types::Type};
use serde_json::{Value, json};
use std::{io::{self,Read},sync::Arc};
const FOOTER:usize=4*1024*1024;
const PAGE:usize=16*1024*1024;
const DECODED:usize=64*1024*1024;
#[derive(Clone)]struct Reader(Arc<FormatFile>);
struct Stream{file:Arc<FormatFile>,offset:u64}
impl Read for Stream{fn read(&mut self,buffer:&mut[u8])->io::Result<usize>{let n=self.file.read_at(self.offset,buffer)?;self.offset+=n as u64;Ok(n)}}
impl Length for Reader{fn len(&self)->u64{self.0.file.size}}
impl ChunkReader for Reader{
    type T=std::io::BufReader<Stream>;
    fn get_read(&self,start:u64)->parquet::errors::Result<Self::T>{self.0.check().map_err(ParquetError::General)?;Ok(std::io::BufReader::new(Stream{file:self.0.clone(),offset:start}))}
    fn get_bytes(&self,start:u64,length:usize)->parquet::errors::Result<Bytes>{self.0.bytes(start,length).map(Bytes::from).map_err(ParquetError::General)}
}
fn bad(_:impl std::fmt::Display)->String{"data_invalid_parquet".into()}
fn count_decoded(mut reader:impl Read,expected:usize,file:&FormatFile)->Result<(),String>{
    let mut count=0usize;let mut buffer=[0u8;65536];
    loop{file.check()?;let n=reader.read(&mut buffer[..(expected+1-count).min(65536)]).map_err(bad)?;if n==0{break;}count+=n;
        if count>expected{return Err("data_format_budget".into());}}
    if count!=expected{return Err("data_invalid_parquet".into());}Ok(())
}
fn check_compression(codec:Compression,bytes:&[u8],expected:usize,file:&FormatFile)->Result<(),String>{
    file.check()?;
    match codec{
        Compression::UNCOMPRESSED=>if bytes.len()!=expected{return Err("data_invalid_parquet".into());},
        Compression::SNAPPY=>{if snap::raw::decompress_len(bytes).map_err(bad)?!=expected{return Err("data_format_budget".into());}
            let mut output=vec![0;expected];if snap::raw::Decoder::new().decompress(bytes,&mut output).map_err(bad)?!=expected{return Err("data_invalid_parquet".into());}},
        Compression::GZIP(_)=>count_decoded(flate2::read::MultiGzDecoder::new(bytes),expected,file)?,
        Compression::ZSTD(_)=>{let mut decoder=zstd::stream::read::Decoder::new(bytes).map_err(bad)?;decoder.window_log_max(24).map_err(bad)?;count_decoded(decoder,expected,file)?;},
        Compression::BROTLI(_)=>count_decoded(brotli::Decompressor::new(bytes,65536),expected,file)?,
        Compression::LZ4_RAW=>{let mut output=vec![0;expected];if lz4_flex::block::decompress_into(bytes,&mut output).map_err(bad)?!=expected{return Err("data_invalid_parquet".into());}},
        _=>return Err("data_parquet_codec_unsupported".into()),
    }Ok(())
}
// Check actual pages, not just optimistic footer sizes. Some codecs ignore the
// declared output size; bounded pre-decompression prevents native heap bombs.
fn preflight(file:&FormatFile,column:&ColumnChunkMetaData,decoded:&mut usize,values:&mut usize)->Result<(),String>{
    if column.file_path().is_some(){return Err("data_parquet_external_chunk".into());}
    let(start,length)=column.byte_range();let end=start.checked_add(length).ok_or("data_invalid_parquet")?;
    if start<4||end>file.file.size.saturating_sub(8){return Err("data_invalid_parquet".into());}
    let mut offset=start;let mut pages=0;
    while offset<end{
        file.check()?;pages+=1;if pages>16384{return Err("data_format_budget".into());}
        let raw=file.bytes(offset,(end-offset).min(65536)as usize)?;let header=Compact::parse(&raw,true)?;
        let size=|path:&[i16]|->Result<usize,String>{usize::try_from(header.integer(path).ok_or("data_invalid_parquet")?).map_err(bad)};
        let uncompressed=size(&[2])?;let compressed=size(&[3])?;
        if uncompressed>PAGE||compressed>PAGE{return Err("data_format_budget".into());}
        *decoded=decoded.checked_add(uncompressed).ok_or("data_format_budget")?;
        if *decoded>DECODED{return Err("data_format_budget".into());}
        for path in [&[5,1][..],&[7,1][..],&[8,1][..]]{if let Some(n)=header.integer(path){
            let n=usize::try_from(n).map_err(bad)?;*values=values.checked_add(n).ok_or("data_format_budget")?;
            if *values>2_000_000{return Err("data_format_budget".into());}
        }}
        offset=offset.checked_add(header.position as u64).ok_or("data_invalid_parquet")?;
        if offset.checked_add(compressed as u64).is_none_or(|n|n>end){return Err("data_invalid_parquet".into());}
        let data=file.bytes(offset,compressed)?;
        let kind=header.integer(&[1]).ok_or("data_invalid_parquet")?;
        let prefix=if kind==3{size(&[8,5])?.checked_add(size(&[8,6])?).ok_or("data_invalid_parquet")?}else{0};
        if prefix>compressed||prefix>uncompressed{return Err("data_invalid_parquet".into());}
        let codec=if kind==3&&header.integer(&[8,7])==Some(0){Compression::UNCOMPRESSED}else{column.compression()};
        check_compression(codec,&data[prefix..],uncompressed-prefix,file)?;
        offset+=compressed as u64;
    }Ok(())
}
fn cell(value:&Field)->Result<Value,String>{
    Ok(match value{
        Field::Null=>Value::Null,Field::Bool(b)=>json!(b),
        Field::Byte(v)=>integer(*v as i128),Field::Short(v)=>integer(*v as i128),Field::Int(v)|Field::Date(v)|Field::TimeMillis(v)=>integer(*v as i128),
        Field::Long(v)|Field::TimeMicros(v)|Field::TimestampMillis(v)|Field::TimestampMicros(v)=>integer(*v as i128),
        Field::UByte(v)=>integer(*v as i128),Field::UShort(v)=>integer(*v as i128),Field::UInt(v)=>integer(*v as i128),Field::ULong(v)=>integer(*v as i128),
        Field::Float(v)=>float(*v as f64)?,Field::Double(v)=>float(*v)?,Field::Float16(v)=>float(v.to_f64())?,
        Field::Str(s)=>{if s.len()>MAX_CELL{return Err("data_output_limit".into());}json!(s)},
        Field::Bytes(b)=>binary(b.data())?,Field::Decimal(_)=>json!({"type":"decimal","value":value.to_string()}),
        _=>return Err("data_parquet_type_unsupported".into()),
    })
}
pub(super) fn query(file:Arc<FormatFile>,offset:u64,limit:usize,requested:Option<&[String]>)->Result<Value,String>{
    if file.file.size<12{return Err("data_invalid_parquet".into());}
    let tail=file.bytes(file.file.size-8,8)?;
    if &tail[4..]!=b"PAR1"||file.bytes(0,4)?!=b"PAR1"{return Err("data_invalid_parquet".into());}
    let footer=u32::from_le_bytes(tail[..4].try_into().map_err(bad)?)as usize;
    if footer>FOOTER||footer as u64>file.file.size-12{return Err("data_format_budget".into());}
    let bytes=file.bytes(file.file.size-8-footer as u64,footer)?;
    let compact=Compact::parse(&bytes,false)?;
    if compact.position!=bytes.len(){return Err("data_invalid_parquet".into());}
    let reader=SerializedFileReader::new(Reader(file.clone())).map_err(bad)?;
    let metadata=reader.metadata();let total=metadata.file_metadata().num_rows();
    if total<0||total>9_007_199_254_740_991||offset>total as u64||reader.num_row_groups()>16384{return Err("data_format_budget".into());}
    let schema=metadata.file_metadata().schema_descr().root_schema();
    let fields=schema.get_fields();
    if fields.len()>MAX_COLUMNS||fields.iter().any(|f|f.name().len()>256)
        ||fields.iter().map(|f|f.name()).collect::<std::collections::HashSet<_>>().len()!=fields.len(){return Err("data_format_budget".into());}
    let names:Vec<String>=requested.map(|c|c.to_vec()).unwrap_or_else(||fields.iter().map(|f|f.name().to_string()).collect());
    let indices=names.iter().map(|n|fields.iter().position(|f|f.name()==n).ok_or_else(||"data_parquet_column_missing".to_string())).collect::<Result<Vec<_>,_>>()?;
    let types:Vec<String>=indices.iter().map(|i|format!("{:?}",fields[*i])).collect();
    if types.iter().any(|t|t.len()>2048){return Err("data_format_budget".into());}
    let mut rows=Vec::new();let mut output=0;let mut base=0u64;let mut decoded=0;let mut values=0;
    if limit>0{
        if fields.iter().any(|f|!f.is_primitive()||f.get_basic_info().repetition()==parquet::basic::Repetition::REPEATED){return Err("data_parquet_type_unsupported".into());}
        if indices.iter().any(|i|fields[*i].get_physical_type()==Physical::INT96){return Err("data_parquet_int96_precision".into());}
        let selected=fields.iter().enumerate().filter(|(i,_)|indices.contains(i)).map(|(_,f)|f.clone()).collect();
        let projection=Type::group_type_builder(schema.name()).with_fields(selected).build().map_err(bad)?;
        for group_index in 0..reader.num_row_groups(){
            file.check()?;let group=reader.get_row_group(group_index).map_err(bad)?;let count=group.metadata().num_rows();
            if count<0{return Err("data_invalid_parquet".into());}let end=base.checked_add(count as u64).ok_or("data_invalid_parquet")?;
            if end<=offset{base=end;continue;}if rows.len()==limit{break;}
            for i in &indices{preflight(&file,group.metadata().column(*i),&mut decoded,&mut values)?;}
            let iter=group.get_row_iter(Some(projection.clone())).map_err(bad)?.with_batch_size(128);
            for (index,row) in iter.enumerate(){
                file.check()?;if base+(index as u64)<offset{continue;}if rows.len()==limit{break;}
                let row=row.map_err(bad)?;let cells:std::collections::HashMap<_,_>=row.get_column_iter().collect();
                let row=names.iter().map(|n|cell(cells.get(n).ok_or_else(||"data_invalid_parquet".to_string())?)).collect::<Result<Vec<_>,_>>()?;
                add_row(&mut rows,row,&mut output)?;
            }base=end;
        }
    }
    let next=offset+rows.len()as u64;
    if next>total as u64{return Err("data_invalid_parquet".into());}
    if limit>0&&rows.len()<limit&&next<total as u64{return Err("data_invalid_parquet".into());}
    let more=limit>0&&next<total as u64;
    let mut result=json!({"columns":names,"types":types,"rows":rows,"revision":file.file.revision,"offset":offset,"totalRows":total,"truncated":more});
    if more{result["nextOffset"]=json!(next);}Ok(result)
}
