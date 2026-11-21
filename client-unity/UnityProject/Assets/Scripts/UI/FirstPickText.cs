using System;
using System.Globalization;
using Roguehalla.Net.Protocol;

namespace Roguehalla.Client
{
    /// <summary>The chest panel's first-pick countdown text, from the server's window and clock.</summary>
    public static class FirstPickText
    {
        public static string Label(WireFirstPick? window, double serverMs)
        {
            if (!window.HasValue || window.Value.Until <= serverMs) return "";
            string s = Math.Ceiling((window.Value.Until - serverMs) / 1000d).ToString("0", CultureInfo.InvariantCulture);
            return (window.Value.Mine ? "Your first pick " : "First pick ") + s + " s";
        }
    }
}
