//! Little-endian writer and a bounds-checked reader for untrusted bytes.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeError {
    Truncated,
    TooLarge(usize),
    TooMany(usize),
    BadTag(u8),
    BadUtf8,
    NonFinite,
    Trailing(usize),
    BadMap(&'static str),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for DecodeError {}

#[derive(Default)]
pub struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    pub fn u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn u64(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn f64(&mut self, v: f64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    pub fn bytes(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }
    /// `u8 length + UTF-8`; longer strings are truncated at a char boundary to 255 bytes.
    pub fn str(&mut self, s: &str) {
        let mut end = s.len().min(255);
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        self.u8(end as u8);
        self.bytes(&s.as_bytes()[..end]);
    }
    pub fn opt<T>(&mut self, v: Option<&T>, f: impl FnOnce(&mut Self, &T)) {
        match v {
            None => self.u8(0),
            Some(x) => {
                self.u8(1);
                f(self, x);
            }
        }
    }
    pub fn finish(self) -> Vec<u8> {
        self.buf
    }
}

pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
    /// Reject NaN and infinities (client frames).
    pub finite_only: bool,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0, finite_only: false }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], DecodeError> {
        let end = self.pos.checked_add(n).ok_or(DecodeError::Truncated)?;
        if end > self.buf.len() {
            return Err(DecodeError::Truncated);
        }
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    pub fn u8(&mut self) -> Result<u8, DecodeError> {
        Ok(self.take(1)?[0])
    }
    pub fn u16(&mut self) -> Result<u16, DecodeError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    pub fn u32(&mut self) -> Result<u32, DecodeError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub fn u64(&mut self) -> Result<u64, DecodeError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub fn f32(&mut self) -> Result<f32, DecodeError> {
        let v = f32::from_le_bytes(self.take(4)?.try_into().unwrap());
        if self.finite_only && !v.is_finite() {
            return Err(DecodeError::NonFinite);
        }
        Ok(v)
    }
    pub fn f64(&mut self) -> Result<f64, DecodeError> {
        let v = f64::from_le_bytes(self.take(8)?.try_into().unwrap());
        if self.finite_only && !v.is_finite() {
            return Err(DecodeError::NonFinite);
        }
        Ok(v)
    }
    pub fn array16(&mut self) -> Result<[u8; 16], DecodeError> {
        Ok(self.take(16)?.try_into().unwrap())
    }
    pub fn bytes(&mut self, n: usize) -> Result<&'a [u8], DecodeError> {
        self.take(n)
    }
    pub fn str(&mut self) -> Result<String, DecodeError> {
        let n = self.u8()? as usize;
        let b = self.take(n)?;
        String::from_utf8(b.to_vec()).map_err(|_| DecodeError::BadUtf8)
    }
    pub fn opt<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, DecodeError>) -> Result<Option<T>, DecodeError> {
        match self.u8()? {
            0 => Ok(None),
            1 => f(self).map(Some),
            t => Err(DecodeError::BadTag(t)),
        }
    }
    pub fn end(&self) -> Result<(), DecodeError> {
        if self.pos == self.buf.len() {
            Ok(())
        } else {
            Err(DecodeError::Trailing(self.buf.len() - self.pos))
        }
    }
}
