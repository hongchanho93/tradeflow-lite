//! Allocation-free bounds preflight for Thrift Compact structs, before the
//! Parquet library creates vectors from untrusted length declarations.
//! Encoding: Apache Thrift compact protocol / parquet-format parquet.thrift.
pub(super) struct Compact<'a> {
    data: &'a [u8], pub position: usize, nodes: usize, collect: bool,
    pub integers: Vec<(Vec<i16>, i64)>,
}
type Result<T> = std::result::Result<T, String>;
fn invalid<T>() -> Result<T> { Err("data_invalid_parquet".into()) }
impl<'a> Compact<'a> {
    pub fn parse(data: &'a [u8], collect: bool) -> Result<Self> {
        let mut parser=Self {data,position:0,nodes:0,collect,integers:Vec::new()};
        parser.structure(&mut Vec::new())?; Ok(parser)
    }
    fn byte(&mut self) -> Result<u8> {
        let value=*self.data.get(self.position).ok_or("data_invalid_parquet")?;self.position+=1;Ok(value)
    }
    fn advance(&mut self,n:usize)->Result<()> {
        if n>self.data.len().saturating_sub(self.position){return invalid();}self.position+=n;Ok(())
    }
    fn varint(&mut self)->Result<u64>{
        let mut value=0u64;
        for n in 0..10 {let b=self.byte()?;if n==9&&b>1{return invalid();}value|=((b&127)as u64)<<(n*7);if b<128{return Ok(value);}}
        invalid()
    }
    fn signed(&mut self)->Result<i64>{let v=self.varint()?;Ok(((v>>1)as i64)^-((v&1)as i64))}
    fn structure(&mut self,path:&mut Vec<i16>)->Result<()> {
        if path.len()>32{return Err("data_format_budget".into());}let mut previous=0i16;let mut seen=std::collections::HashSet::new();
        loop {let header=self.byte()?;if header==0{return Ok(());}let delta=header>>4;
            let id=if delta==0{i16::try_from(self.signed()?).map_err(|_|"data_invalid_parquet")?}else{previous.checked_add(delta as i16).ok_or("data_invalid_parquet")?};
            if id<=0||!seen.insert(id){return invalid();}previous=id;path.push(id);
            self.value(header&15,path,true)?;path.pop();
        }
    }
    fn value(&mut self,kind:u8,path:&mut Vec<i16>,field:bool)->Result<()> {
        self.nodes+=1;if self.nodes>250_000||path.len()>32{return Err("data_format_budget".into());}
        let integer=match kind {
            1|2=>{if !field&&!matches!(self.byte()?,1|2){return invalid();}Some(if kind==1{1}else{0})},
            3=>Some(self.byte()?as i8 as i64),4..=6=>Some(self.signed()?),
            7=>{self.advance(8)?;None},8=>{let n=usize::try_from(self.varint()?).map_err(|_|"data_format_budget")?;self.advance(n)?;None},
            9|10=>{let h=self.byte()?;let n=if h>>4==15{usize::try_from(self.varint()?).map_err(|_|"data_format_budget")?}else{(h>>4)as usize};
                if n>250_000||n>self.data.len().saturating_sub(self.position){return Err("data_format_budget".into());}
                path.push(0);for _ in 0..n{self.value(h&15,path,false)?;}path.pop();None},
            11=>{let n=usize::try_from(self.varint()?).map_err(|_|"data_format_budget")?;
                if n>125_000||n>self.data.len().saturating_sub(self.position)/2{return Err("data_format_budget".into());}
                if n>0{let h=self.byte()?;path.push(0);for _ in 0..n{self.value(h>>4,path,false)?;self.value(h&15,path,false)?;}path.pop();}None},
            12=>{self.structure(path)?;None},_=>return invalid(),
        };
        if self.collect {if let Some(value)=integer{if self.integers.len()>1024{return Err("data_format_budget".into());}self.integers.push((path.clone(),value));}}
        Ok(())
    }
    pub fn integer(&self,path:&[i16])->Option<i64>{self.integers.iter().find(|(p,_)|p==path).map(|(_,v)|*v)}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn compact_rejects_oversized_container_and_binary_before_allocation(){
        assert!(Compact::parse(&[0x19,0xf6,0xff,0xff,0xff,0xff,0x07,0],false).is_err());
        assert!(Compact::parse(&[0x18,0xff,0xff,0xff,0xff,0x07,0],false).is_err());
        assert!(Compact::parse(&[0x15,2,0x05,2,2,0],true).is_err());
    }
    #[test]fn compact_extracts_bounded_page_sizes(){let p=Compact::parse(&[0x15,0,0x15,20,0x15,10,0],true).unwrap();assert_eq!(p.integer(&[2]),Some(10));assert_eq!(p.position,7);}
}
