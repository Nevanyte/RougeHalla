using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>One decoration kind the server may send (a rule kind of crates/rh-mapdress/rules/zones.json).</summary>
    public readonly struct DecorationKind
    {
        /// <summary>The rule file's name, e.g. "fire.spire".</summary>
        public readonly string Name;
        public readonly byte Code;
        /// <summary>The rule file's tall flag (the flag on the wire row is what the client obeys).</summary>
        public readonly bool Tall;
        /// <summary>Key of the sprite drawn for this kind in RegionPropArt: the kind's own name when art exists, else the nearest existing prop.</summary>
        public readonly string Art;
        public DecorationKind(string name, byte code, bool tall, string art) { Name = name; Code = code; Tall = tall; Art = art; }
    }

    /// <summary>Kind code (MapProp.Kind of a rule prop) to sprite. P-UNITY-DRESS-1 fills it and checks it against zones.json.</summary>
    public static class DecorationKinds
    {
        /// <summary>The sprite key drawn for a kind the table does not know (and for a legacy prop): visible, never nothing.</summary>
        public const string Placeholder = "dress.unknown";

        public static IReadOnlyList<DecorationKind> All { get { return new DecorationKind[0]; } }

        public static bool TryGet(byte code, out DecorationKind kind) { kind = default(DecorationKind); return false; }

        /// <summary>The sprite key for a prop row: <see cref="Placeholder"/> for a legacy prop (flag 2) or an unknown code, else the kind's art, or its variant's art when it has one (variant 1 of frost.drift is frost.drift2).</summary>
        public static string ArtKey(byte kind, byte variant, byte flags) { return null; }
    }
}
