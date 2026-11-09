//! Owned declared public-method records. These are not delivery or identity capabilities.
use super::Error;
/// Exact owned JavaScript method values, private to the inactive temporal core.
/// Undefined is an explicitly present source value, distinct from null and an
/// absent object member. This is not the public message/wire representation.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum MethodValue {
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Self>),
    Obj(Vec<(String, Self)>),
}
use rh_sim::{FactionId, Vec2, WeaponId};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Object(pub(crate) Vec<(String, MethodValue)>);

impl Object {
    pub(crate) fn read(data: MethodValue) -> Result<Self, Error> {
        finite(&data)?;
        match data {
            MethodValue::Obj(fields) => Ok(Self(fields)),
            _ => Err(Error::Shape("object")),
        }
    }
    pub(crate) fn get(&self, key: &'static str) -> Result<&MethodValue, Error> {
        self.optional(key).ok_or(Error::Missing(key))
    }
    pub(crate) fn optional(&self, key: &str) -> Option<&MethodValue> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    pub(crate) fn string(&self, key: &'static str) -> Result<&str, Error> {
        match self.get(key)? {
            MethodValue::Str(v) => Ok(v),
            _ => Err(Error::Shape(key)),
        }
    }
    pub(crate) fn number(&self, key: &'static str) -> Result<f64, Error> {
        match self.get(key)? {
            MethodValue::Num(v) => Ok(*v),
            _ => Err(Error::Shape(key)),
        }
    }
    pub(crate) fn boolean(&self, key: &'static str) -> Result<bool, Error> {
        match self.get(key)? {
            MethodValue::Bool(v) => Ok(*v),
            _ => Err(Error::Shape(key)),
        }
    }
    pub(crate) fn nullable_string(&self, key: &'static str) -> Result<Option<String>, Error> {
        match self.get(key)? {
            MethodValue::Null => Ok(None),
            MethodValue::Str(v) => Ok(Some(v.clone())),
            _ => Err(Error::Shape(key)),
        }
    }
    pub(crate) fn object(&self, key: &'static str) -> Result<Self, Error> {
        Self::read(self.get(key)?.clone())
    }
    pub(crate) fn array(&self, key: &'static str) -> Result<&[MethodValue], Error> {
        match self.get(key)? {
            MethodValue::Arr(v) => Ok(v),
            _ => Err(Error::Shape(key)),
        }
    }
    pub(crate) fn at(&self) -> Result<Vec2, Error> {
        Ok(Vec2::new(self.number("x")?, self.number("y")?))
    }
    pub(crate) fn put(&mut self, key: &str, value: MethodValue) {
        if let Some((_, old)) = self.0.iter_mut().find(|(k, _)| k == key) {
            *old = value;
        } else {
            self.0.push((key.to_owned(), value));
        }
    }
    pub(crate) fn data(&self) -> MethodValue {
        MethodValue::Obj(self.0.clone())
    }
}

pub(crate) fn finite(data: &MethodValue) -> Result<(), Error> {
    match data {
        MethodValue::Num(v) if !v.is_finite() => Err(Error::Nonfinite),
        MethodValue::Arr(rows) => rows.iter().try_for_each(finite),
        MethodValue::Obj(rows) => rows.iter().try_for_each(|(_, v)| finite(v)),
        _ => Ok(()),
    }
}

pub(crate) fn weapon(value: &MethodValue) -> Result<Option<WeaponId>, Error> {
    Ok(match value {
        MethodValue::Null => None,
        MethodValue::Str(v) => Some(match v.as_str() {
            "sword" => WeaponId::Sword,
            "bow" => WeaponId::Bow,
            "wand" => WeaponId::Wand,
            "shield" => WeaponId::Shield,
            "axe" => WeaponId::Axe,
            "fists" => WeaponId::Fists,
            _ => return Err(Error::Shape("weapon")),
        }),
        _ => return Err(Error::Shape("weapon")),
    })
}

pub(crate) fn faction(value: &MethodValue) -> Result<Option<FactionId>, Error> {
    Ok(match value {
        MethodValue::Null => None,
        MethodValue::Str(v) => Some(match v.as_str() {
            "fire" => FactionId::Fire,
            "plague" => FactionId::Plague,
            "frost" => FactionId::Frost,
            "holy" => FactionId::Holy,
            "sentenced" => FactionId::Sentenced,
            _ => return Err(Error::Shape("faction")),
        }),
        _ => return Err(Error::Shape("faction")),
    })
}

pub(crate) fn num(value: f64) -> MethodValue {
    MethodValue::Num(value)
}
pub(crate) fn text(value: &str) -> MethodValue {
    MethodValue::Str(value.to_owned())
}
pub(crate) fn nullable(value: Option<&str>) -> MethodValue {
    value.map_or(MethodValue::Null, text)
}

pub(crate) fn object(fields: impl IntoIterator<Item = (&'static str, MethodValue)>) -> MethodValue {
    MethodValue::Obj(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
}
