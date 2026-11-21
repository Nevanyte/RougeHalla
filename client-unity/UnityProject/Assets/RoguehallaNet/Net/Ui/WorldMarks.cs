using System.Collections.Generic;
using Roguehalla.Net.Protocol;

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

    /// <summary>P-AUG-UI-3: one Marked Man holder's dot on a map (world position from the public State key 15 row).</summary>
    public struct MarkedMark
    {
        public uint Id;
        public float X, Y;
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
            if (!tabMapOpen) return;
            bool hunting = selfFaction == FactionId.Sentenced && selfStatus == ActorStatus.Alive && huntTarget.HasValue;
            for (int i = 0; i < actors.Count; i++)
            {
                var a = actors[i];
                if (a.Id == selfId || a.Kind != ActorKind.Player || a.Status != ActorStatus.Alive) continue;
                bool hunt = hunting && a.Id == huntTarget.Value;
                into.Add(new ContactMark { Id = a.Id, Label = hunt ? ContactLabel.Hunt : ContactLabel.Enemy, Text = hunt ? HuntText : EnemyText });
            }
        }

        /// <summary>P-AUG-UI-3 clears <paramref name="into"/> and fills one mark per Marked Man holder row, ascending id.</summary>
        public static void MarkedHolders(IReadOnlyList<WireMarked> rows, uint selfId, List<MarkedMark> into)
        {
            into.Clear();
            if (rows == null) return;
            for (int i = 0; i < rows.Count; i++)
            {
                if (rows[i].Id == selfId) continue;
                var m = new MarkedMark { Id = rows[i].Id, X = rows[i].X, Y = rows[i].Y };
                into.Add(m);
                int j = into.Count - 1;
                while (j > 0 && into[j - 1].Id > m.Id) { into[j] = into[j - 1]; j--; }
                into[j] = m;
            }
        }
    }
}
