using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>Which word legacy prints beside an enemy dot on the Tab map.</summary>
    public enum ContactLabel : byte { Enemy = 0, Hunt = 1 }

    /// <summary>One labelled enemy dot on the Tab map: the actor it sits on and its word.</summary>
    public struct ContactMark
    {
        public uint Id;
        public ContactLabel Label;
        public string Text;
    }

    /// <summary>Pure map-contact labelling (presentation only). Legacy labels an enemy fighter's dot on the held-Tab map "ENEMY",
    /// and "HUNT" when it is the local Sentenced player's living hunt target (planning.ts:1117); the minimap labels nothing.</summary>
    public static class WorldMarks
    {
        public const string EnemyText = "ENEMY", HuntText = "HUNT";

        /// <summary>Clears <paramref name="into"/> and fills one mark per labelled contact, in <paramref name="actors"/> order.
        /// Only the delivered actors are considered; nothing is invented for an actor that is not in the list.</summary>
        public static void TabMapContacts(IReadOnlyList<InterpActor> actors, uint selfId, FactionId selfFaction,
            ActorStatus selfStatus, uint? huntTarget, bool tabMapOpen, List<ContactMark> into)
        {
            into.Clear();
        }
    }
}
