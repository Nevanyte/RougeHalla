using System;
using System.Globalization;
using System.Numerics;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>Formats delivered Trophy facts. Does not calculate investment, grant values or eligibility.</summary>
    public static class TrophyText
    {
        public static string Title(TrophyStatKey key, double gain) { return Amount(key, gain) + " " + Name(key); }

        public static string Description(TrophyStatKey key, double gain)
        {
            return "Take 50% of your victim's " + Name(key) + ": " + Amount(key, gain) + " for the rest of the run.";
        }

        static string Name(TrophyStatKey key)
        {
            switch (key)
            {
                case TrophyStatKey.Ad: return "Offense";
                case TrophyStatKey.Ap: return "Soul Offence";
                case TrophyStatKey.Damage: return "damage";
                case TrophyStatKey.Health: return "max health";
                case TrophyStatKey.AttackSpeed: return "attack speed";
                case TrophyStatKey.Armor: return "Defense";
                case TrophyStatKey.Mr: return "Soul Defense";
                case TrophyStatKey.Speed: return "movement speed";
                case TrophyStatKey.Leech: return "leech";
                default: throw new ArgumentOutOfRangeException(nameof(key));
            }
        }

        static string Amount(TrophyStatKey key, double gain)
        {
            if (!(gain > 0) || double.IsNaN(gain) || double.IsInfinity(gain))
                throw new ArgumentOutOfRangeException(nameof(gain));
            bool flat = key == TrophyStatKey.Ad || key == TrophyStatKey.Ap || key == TrophyStatKey.Armor || key == TrophyStatKey.Mr;
            return "+" + FixedOne(flat ? gain : gain * 100) + (flat ? "" : "%");
        }

        // Source Number.toFixed(1) rounds the exact binary64 value. Multiplying by ten and Math.Round can
        // round a neighbour onto a midpoint first; decimal conversion also loses that original distinction.
        public static string FixedOne(double value)
        {
            if (double.IsNaN(value)) return "NaN";
            if (double.IsPositiveInfinity(value)) return "Infinity";
            if (double.IsNegativeInfinity(value)) return "-Infinity";
            bool negative = value < 0;
            double absolute = Math.Abs(value);
            if (absolute >= 1e21)
                return value.ToString("R", CultureInfo.InvariantCulture).Replace("E+", "e+").Replace("E-", "e-");
            ulong bits = unchecked((ulong)BitConverter.DoubleToInt64Bits(absolute));
            int exponent = (int)((bits >> 52) & 0x7ff);
            ulong fraction = bits & ((1UL << 52) - 1);
            ulong mantissa = exponent == 0 ? fraction : fraction | (1UL << 52);
            int shift = exponent == 0 ? -1074 : exponent - 1075;
            BigInteger numerator = new BigInteger(mantissa) * 10;
            BigInteger rounded;
            if (shift >= 0) rounded = numerator << shift;
            else
            {
                BigInteger denominator = BigInteger.One << -shift;
                rounded = BigInteger.DivRem(numerator, denominator, out var remainder);
                if (remainder * 2 >= denominator) rounded++;
            }
            string digits = rounded.ToString(CultureInfo.InvariantCulture).PadLeft(2, '0');
            return (negative ? "-" : "") + digits.Substring(0, digits.Length - 1) + "." + digits.Substring(digits.Length - 1);
        }
    }
}
