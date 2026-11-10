//! Strict source-corpus reader for the frozen private strategy witness. Test-only: the corpus is an offline declared
//! method witness, not a public intake path. Every consumed object/enum/tag is checked before any native state mutation.

use serde_json::Value;

#[derive(Clone, Debug)]
pub(crate) enum SVal {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<SVal>),
    Map(Vec<(SVal, SVal)>),
    Set(Vec<SVal>),
    Obj(Vec<(String, SVal)>),
    U8(Vec<u8>),
    Instance {
        name: String,
        entries: Vec<(String, SVal)>,
    },
    Callable,
}

pub(crate) type R<T> = Result<T, String>;

fn err(path: &str, msg: impl Into<String>) -> String {
    format!("{path}: {}", msg.into())
}

fn tag_parts<'a>(value: &'a Value, path: &str) -> R<(&'a str, &'a serde_json::Map<String, Value>)> {
    let obj = value
        .as_object()
        .ok_or_else(|| err(path, "expected tagged object"))?;
    let tag = obj
        .get("$")
        .and_then(Value::as_str)
        .ok_or_else(|| err(path, "missing $ tag"))?;
    Ok((tag, obj))
}

fn exact_keys(obj: &serde_json::Map<String, Value>, allowed: &[&str], path: &str) -> R<()> {
    for key in obj.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(err(path, format!("unknown tag field {key}")));
        }
    }
    Ok(())
}

pub(crate) fn parse(value: &Value, path: &str) -> R<SVal> {
    match value {
        Value::Null => Ok(SVal::Null),
        Value::Bool(v) => Ok(SVal::Bool(*v)),
        Value::Number(n) => n
            .as_f64()
            .map(SVal::Num)
            .ok_or_else(|| err(path, "non-f64 number")),
        Value::String(s) => Ok(SVal::Str(s.clone())),
        Value::Array(a) => Err(err(path, format!("untagged array with {} values", a.len()))),
        Value::Object(_) => {
            let (tag, obj) = tag_parts(value, path)?;
            match tag {
                "undefined" => {
                    exact_keys(obj, &["$"], path)?;
                    Ok(SVal::Undefined)
                }
                "number" => {
                    exact_keys(obj, &["$", "value"], path)?;
                    let raw = obj
                        .get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| err(path, "number tag value must be a string"))?;
                    let number = match raw {
                        "-0" => -0.0,
                        "NaN" => f64::NAN,
                        "+Infinity" => f64::INFINITY,
                        "-Infinity" => f64::NEG_INFINITY,
                        _ => return Err(err(path, format!("unsupported number tag {raw}"))),
                    };
                    Ok(SVal::Num(number))
                }
                "array" => {
                    exact_keys(obj, &["$", "values"], path)?;
                    let values = obj
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "array tag values must be an array"))?;
                    Ok(SVal::Arr(
                        values
                            .iter()
                            .enumerate()
                            .map(|(i, v)| parse(v, &format!("{path}[{i}]")))
                            .collect::<R<Vec<_>>>()?,
                    ))
                }
                "u8" => {
                    exact_keys(obj, &["$", "values"], path)?;
                    let values = obj
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "u8 tag values must be an array"))?;
                    let mut out = Vec::with_capacity(values.len());
                    for (i, v) in values.iter().enumerate() {
                        let n = v.as_u64().ok_or_else(|| {
                            err(
                                &format!("{path}[{i}]"),
                                "u8 value must be a non-negative integer",
                            )
                        })?;
                        if n > u64::from(u8::MAX) {
                            return Err(err(&format!("{path}[{i}]"), "u8 value out of range"));
                        }
                        out.push(n as u8);
                    }
                    Ok(SVal::U8(out))
                }
                "map" => {
                    exact_keys(obj, &["$", "entries"], path)?;
                    let entries = obj
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "map tag entries must be an array"))?;
                    let mut out: Vec<(SVal, SVal)> = Vec::with_capacity(entries.len());
                    for (i, entry) in entries.iter().enumerate() {
                        let pair = entry.as_array().filter(|p| p.len() == 2).ok_or_else(|| {
                            err(
                                &format!("{path}.entries[{i}]"),
                                "map entry must be [key,value]",
                            )
                        })?;
                        let key = parse(&pair[0], &format!("{path}.entries[{i}].key"))?;
                        if out.iter().any(|(k, _)| same(k, &key)) {
                            return Err(err(&format!("{path}.entries[{i}]"), "duplicate Map key"));
                        }
                        let value = parse(&pair[1], &format!("{path}.entries[{i}].value"))?;
                        out.push((key, value));
                    }
                    Ok(SVal::Map(out))
                }
                "set" => {
                    exact_keys(obj, &["$", "values"], path)?;
                    let values = obj
                        .get("values")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "set tag values must be an array"))?;
                    let mut out: Vec<SVal> = Vec::with_capacity(values.len());
                    for (i, v) in values.iter().enumerate() {
                        let value = parse(v, &format!("{path}[{i}]"))?;
                        if out.iter().any(|x| same(x, &value)) {
                            return Err(err(&format!("{path}[{i}]"), "duplicate Set value"));
                        }
                        out.push(value);
                    }
                    Ok(SVal::Set(out))
                }
                "object" => {
                    exact_keys(obj, &["$", "entries"], path)?;
                    let entries = obj
                        .get("entries")
                        .and_then(Value::as_array)
                        .ok_or_else(|| err(path, "object tag entries must be an array"))?;
                    let mut out: Vec<(String, SVal)> = Vec::with_capacity(entries.len());
                    for (i, entry) in entries.iter().enumerate() {
                        let pair = entry.as_array().filter(|p| p.len() == 2).ok_or_else(|| {
                            err(
                                &format!("{path}.entries[{i}]"),
                                "object entry must be [key,value]",
                            )
                        })?;
                        let key = pair[0]
                            .as_str()
                            .ok_or_else(|| {
                                err(
                                    &format!("{path}.entries[{i}].key"),
                                    "object key must be a string",
                                )
                            })?
                            .to_string();
                        if out.iter().any(|(k, _)| k == &key) {
                            return Err(err(
                                &format!("{path}.entries[{i}]"),
                                "duplicate object key",
                            ));
                        }
                        let value = parse(&pair[1], &format!("{path}.entries[{i}].value"))?;
                        out.push((key, value));
                    }
                    Ok(SVal::Obj(out))
                }
                "instance" => {
                    exact_keys(obj, &["$", "name", "entries"], path)?;
                    let name = obj
                        .get("name")
                        .and_then(Value::as_str)
                        .ok_or_else(|| err(path, "instance name must be a string"))?
                        .to_string();
                    let entries_value = obj
                        .get("entries")
                        .ok_or_else(|| err(path, "missing instance entries"))?;
                    let entries = match parse(entries_value, &format!("{path}.entries"))? {
                        SVal::Obj(entries) => entries,
                        other => {
                            return Err(err(
                                &format!("{path}.entries"),
                                format!("expected object, got {other:?}"),
                            ))
                        }
                    };
                    Ok(SVal::Instance { name, entries })
                }
                "callable" => {
                    exact_keys(obj, &["$"], path)?;
                    Ok(SVal::Callable)
                }
                other => Err(err(path, format!("unsupported tag {other}"))),
            }
        }
    }
}

/// Exact source-value equality: binary64 bits (preserving -0/NaN payload), tag and ordered collection identity.
pub(crate) fn same(a: &SVal, b: &SVal) -> bool {
    match (a, b) {
        (SVal::Undefined, SVal::Undefined)
        | (SVal::Null, SVal::Null)
        | (SVal::Callable, SVal::Callable) => true,
        (SVal::Bool(x), SVal::Bool(y)) => x == y,
        (SVal::Num(x), SVal::Num(y)) => x.to_bits() == y.to_bits(),
        (SVal::Str(x), SVal::Str(y)) => x == y,
        (SVal::Arr(x), SVal::Arr(y)) => same_seq(x, y),
        (SVal::Set(x), SVal::Set(y)) => same_seq(x, y),
        (SVal::U8(x), SVal::U8(y)) => x == y,
        (SVal::Map(x), SVal::Map(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((ka, va), (kb, vb))| same(ka, kb) && same(va, vb))
        }
        (SVal::Obj(x), SVal::Obj(y)) => {
            x.len() == y.len()
                && x.iter().all(|(ka, va)| {
                    y.iter()
                        .find(|(kb, _)| kb == ka)
                        .is_some_and(|(_, vb)| same(va, vb))
                })
        }
        (
            SVal::Instance {
                name: n1,
                entries: e1,
            },
            SVal::Instance {
                name: n2,
                entries: e2,
            },
        ) => {
            n1 == n2
                && e1.len() == e2.len()
                && e1
                    .iter()
                    .zip(e2)
                    .all(|((ka, va), (kb, vb))| ka == kb && same(va, vb))
        }
        _ => false,
    }
}
fn same_seq(a: &[SVal], b: &[SVal]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same(x, y))
}
impl SVal {
    pub(crate) fn field(&self, name: &str, path: &str) -> R<&SVal> {
        match self {
            SVal::Obj(entries) => entries
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v)
                .ok_or_else(|| err(path, format!("missing field {name}"))),
            _ => Err(err(path, "expected object")),
        }
    }
    pub(crate) fn optional(&self, name: &str) -> Option<&SVal> {
        match self {
            SVal::Obj(entries) => entries.iter().find(|(k, _)| k == name).map(|(_, v)| v),
            _ => None,
        }
    }
    pub(crate) fn obj(&self, path: &str) -> R<&[(String, SVal)]> {
        match self {
            SVal::Obj(entries) => Ok(entries),
            _ => Err(err(path, "expected object")),
        }
    }
    pub(crate) fn arr(&self, path: &str) -> R<&[SVal]> {
        match self {
            SVal::Arr(values) => Ok(values),
            _ => Err(err(path, "expected array")),
        }
    }
    pub(crate) fn map(&self, path: &str) -> R<&[(SVal, SVal)]> {
        match self {
            SVal::Map(entries) => Ok(entries),
            _ => Err(err(path, "expected map")),
        }
    }
    pub(crate) fn string(&self, path: &str) -> R<&str> {
        match self {
            SVal::Str(v) => Ok(v),
            _ => Err(err(path, "expected string")),
        }
    }
    pub(crate) fn num(&self, path: &str) -> R<f64> {
        match self {
            SVal::Num(v) => Ok(*v),
            _ => Err(err(path, "expected number")),
        }
    }
    pub(crate) fn bool(&self, path: &str) -> R<bool> {
        match self {
            SVal::Bool(v) => Ok(*v),
            _ => Err(err(path, "expected bool")),
        }
    }
    pub(crate) fn undefined(&self, path: &str) -> R<()> {
        match self {
            SVal::Undefined => Ok(()),
            _ => Err(err(path, "expected undefined")),
        }
    }
    pub(crate) fn null(&self, path: &str) -> R<()> {
        match self {
            SVal::Null => Ok(()),
            _ => Err(err(path, "expected null")),
        }
    }
    pub(crate) fn opt_string(&self, name: &str, path: &str) -> R<Option<String>> {
        match self.optional(name) {
            None | Some(SVal::Null) => Ok(None),
            Some(SVal::Str(s)) => Ok(Some(s.clone())),
            Some(SVal::Undefined) => Err(err(
                &format!("{path}.{name}"),
                "undefined where string|null required",
            )),
            Some(_) => Err(err(&format!("{path}.{name}"), "expected string|null")),
        }
    }
    pub(crate) fn opt_num(&self, name: &str, path: &str) -> R<Option<f64>> {
        match self.optional(name) {
            None | Some(SVal::Null) => Ok(None),
            Some(SVal::Num(v)) => Ok(Some(*v)),
            Some(_) => Err(err(&format!("{path}.{name}"), "expected number|null")),
        }
    }
}

pub(crate) fn obj(fields: Vec<(&str, SVal)>) -> SVal {
    SVal::Obj(
        fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}
pub(crate) fn arr(values: Vec<SVal>) -> SVal {
    SVal::Arr(values)
}
pub(crate) fn map(entries: Vec<(SVal, SVal)>) -> SVal {
    SVal::Map(entries)
}
pub(crate) fn s(v: &str) -> SVal {
    SVal::Str(v.to_string())
}
pub(crate) fn n(v: f64) -> SVal {
    SVal::Num(v)
}
pub(crate) fn b(v: bool) -> SVal {
    SVal::Bool(v)
}
pub(crate) fn null() -> SVal {
    SVal::Null
}
pub(crate) fn undefined() -> SVal {
    SVal::Undefined
}
