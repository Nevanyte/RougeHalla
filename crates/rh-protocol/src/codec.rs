//! Little-endian writer and a bounds-checked reader for untrusted bytes.
//!
//! Every message has an exact `encoded_len()` (the layout is fixed-width per element), so an encoder sizes its buffer once
//! and never regrows it: [`Writer::with_capacity`] for a fresh frame, [`Writer::from_vec`] to append to a reused buffer.

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
    /// A LEB128 varint that is longer than its canonical form, or does not fit its type.
    BadVarint,
    /// A field mask with a reserved bit set, or a value outside its documented range (named).
    BadField(&'static str),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for DecodeError {}

/// Why a message cannot be encoded into a frame that every decoder accepts. The encoder never repairs a message (no
/// clamping, no dropping): what a client sees is decided by the observation, not by the codec (docs/CONTRACTS.md C-OBS).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EncodeError {
    /// A list longer than the decoders accept (`what`: "actors", "commands", "events" or "fx").
    TooMany {
        what: &'static str,
        n: usize,
        max: usize,
    },
    /// The frame would exceed the decoders' size limit ([`crate::MAX_SERVER_FRAME`] or [`crate::MAX_CLIENT_FRAME`]).
    TooLarge { len: usize, max: usize },
    /// A map the decoders reject; the reason is the one [`DecodeError::BadMap`] would name ("size", "length", "run",
    /// "hash").
    BadMap(&'static str),
    /// A value a decoder rejects as out of range (`hp_pct` over 100).
    BadValue(&'static str),
    /// An [`crate::SnapshotData::build`] iterator that yielded a different number of actors than its `len()` announced.
    CountMismatch { declared: usize, written: usize },
    /// A string longer than the 255 bytes a `u8` length can carry (`what`: "build", "profile", "reason" or "killed_by"), or
    /// an admission ticket over [`crate::MAX_TICKET`] (`what`: "ticket"). The encoder never truncates: a cut ticket would
    /// fail as a bad credential with no hint why.
    StringTooLong { what: &'static str, len: usize },
    /// A NaN or infinite float in a client message (client decoders reject them).
    NonFinite,
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for EncodeError {}

/// Encoded size of [`Writer::varint`]: 1 byte below 128, 2 below 16384, 3 below 2^21, 4 below 2^28, else 5.
#[inline]
pub const fn varint_len(v: u32) -> usize {
    // 32 - leading_zeros = bit length; 7 bits per byte, at least one byte.
    (38 - (v | 1).leading_zeros() as usize) / 7
}

/// Longest string the wire carries (a `u8` length).
pub const MAX_STR: usize = 255;

/// Encoded size of [`Writer::str`]: the u8 length plus the bytes.
pub fn str_len(s: &str) -> usize {
    1 + s.len()
}

/// Encoded size of [`Writer::blob`]: the u16 length plus the bytes.
pub fn blob_len(b: &[u8]) -> usize {
    2 + b.len()
}

/// The encoders' check that `s` fits [`Writer::str`].
pub(crate) fn str_fits(what: &'static str, s: &str) -> Result<(), EncodeError> {
    if s.len() > MAX_STR {
        return Err(EncodeError::StringTooLong { what, len: s.len() });
    }
    Ok(())
}

#[derive(Default)]
pub struct Writer {
    buf: Vec<u8>,
}

impl Writer {
    /// A writer whose buffer holds `n` bytes before it has to grow (pass the message's exact `encoded_len()`).
    pub fn with_capacity(n: usize) -> Self {
        Self {
            buf: Vec::with_capacity(n),
        }
    }
    /// A writer that appends to `buf`, keeping its contents and capacity; [`Writer::finish`] hands the buffer back.
    pub fn from_vec(buf: Vec<u8>) -> Self {
        Self { buf }
    }
    /// Bytes in the buffer, including any it was created with.
    pub fn len(&self) -> usize {
        self.buf.len()
    }
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }
    /// Makes room for `n` more bytes (one allocation at most when `n` is the exact remaining size).
    pub fn reserve(&mut self, n: usize) {
        self.buf.reserve(n);
    }
    #[inline]
    pub fn u8(&mut self, v: u8) {
        self.buf.push(v);
    }
    #[inline]
    pub fn u16(&mut self, v: u16) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    #[inline]
    pub fn u32(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    #[inline]
    pub fn u64(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    /// Unsigned LEB128 (7 bits per byte, low group first, high bit = more): 1 to 5 bytes for a u32. Always the canonical
    /// (shortest) form; [`Reader::varint`] rejects anything else, so decode then encode is byte-identical.
    #[inline]
    pub fn varint(&mut self, mut v: u32) {
        while v >= 0x80 {
            self.buf.push((v as u8) | 0x80);
            v >>= 7;
        }
        self.buf.push(v as u8);
    }
    #[inline]
    pub fn f32(&mut self, v: f32) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    #[inline]
    pub fn f64(&mut self, v: f64) {
        self.buf.extend_from_slice(&v.to_le_bytes());
    }
    #[inline]
    pub fn bytes(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }
    /// `u8 length + UTF-8`. Never truncates: a string over [`MAX_STR`] bytes is a caller bug (the message encoders refuse it
    /// first with [`EncodeError::StringTooLong`], via `try_encode` / `encode_into`), so it panics rather than write a wrong frame.
    pub fn str(&mut self, s: &str) {
        assert!(
            s.len() <= MAX_STR,
            "string of {} bytes does not fit the wire (max {MAX_STR})",
            s.len()
        );
        self.u8(s.len() as u8);
        self.bytes(s.as_bytes());
    }
    /// `u16 length + bytes` (opaque, e.g. the admission ticket). The message encoders check the bound first; a blob a `u16`
    /// cannot count is a caller bug and panics rather than write a wrong frame.
    pub fn blob(&mut self, b: &[u8]) {
        assert!(
            b.len() <= u16::MAX as usize,
            "blob of {} bytes does not fit the wire",
            b.len()
        );
        self.u16(b.len() as u16);
        self.bytes(b);
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
    /// Appends the first `n` bytes of the fixed-size record `b` (`n <= N`) with a constant-size copy (inline moves, no
    /// `memcpy` call for a length only known at run time), then drops the unused tail.
    #[inline]
    pub(crate) fn append_record<const N: usize>(&mut self, b: &[u8; N], n: usize) {
        debug_assert!(n <= N);
        let len = self.buf.len();
        self.buf.extend_from_slice(b);
        self.buf.truncate(len + n);
    }
    pub fn finish(self) -> Vec<u8> {
        self.buf
    }
}

#[derive(Clone)]
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
    /// Reject NaN and infinities (client frames).
    pub finite_only: bool,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self {
            buf,
            pos: 0,
            finite_only: false,
        }
    }
    pub(crate) fn position(&self) -> usize {
        self.pos
    }
    pub(crate) fn remaining(&self) -> usize {
        self.buf.len() - self.pos
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
    /// Unsigned LEB128 into a u32. Rejects a value past 5 bytes or past `u32::MAX`, and any non-canonical form (a final
    /// zero group after the first byte), so every value has exactly one encoding.
    #[inline]
    pub fn varint(&mut self) -> Result<u32, DecodeError> {
        let mut v: u32 = 0;
        for i in 0..5 {
            let b = self.u8()?;
            let g = (b & 0x7f) as u32;
            if i == 4 && g > 0x0f {
                return Err(DecodeError::BadVarint);
            }
            v |= g << (7 * i);
            if b & 0x80 == 0 {
                if i > 0 && g == 0 {
                    return Err(DecodeError::BadVarint);
                }
                return Ok(v);
            }
        }
        Err(DecodeError::BadVarint)
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
    /// `u16 length + bytes`, at most `max` bytes (checked before anything is copied).
    pub fn blob(&mut self, max: usize) -> Result<Vec<u8>, DecodeError> {
        let n = self.u16()? as usize;
        if n > max {
            return Err(DecodeError::TooMany(n));
        }
        Ok(self.take(n)?.to_vec())
    }
    pub fn opt<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, DecodeError>,
    ) -> Result<Option<T>, DecodeError> {
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
