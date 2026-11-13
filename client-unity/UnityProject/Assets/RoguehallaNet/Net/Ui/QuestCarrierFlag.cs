using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>One quest whose carrier this viewer can see: the carrier's public actor id and the quest giver's sim position (legacy fogs the flag
    /// with the giver, QuestView.ts:57).</summary>
    public struct CarrierFlagRow
    {
        public uint Actor;
        public double GiverX, GiverY;
    }

    /// <summary>The quest carrier's flag (W7). Pure; presentation only. Legacy: packages/client/src/render/QuestView.ts.</summary>
    public static class QuestCarrierFlag
    {
        /// <summary>The flag is 14 x 12 px (QuestView.ts:167), its top edge 62 px (BODY_LIFT 14 + 48) above the carrier's ground point, so its centre
        /// is 56 px above it.</summary>
        public const float WidthPx = 14f, HeightPx = 12f, TopPx = 62f, CentrePx = 56f;
        /// <summary>Fill: the quest kind's colour. Only a fetch quest has a carrier (server/src/sim/quests.ts:154), and fetch is ffd54f
        /// (questModel.ts:185). Outline 2 px 101318 (QuestView.ts:166).</summary>
        public const uint FillRgb = 0xffd54f, OutlineRgb = 0x101318;
        public const float OutlineWidthPx = 2f;

        /// <summary>Clears <paramref name="into"/> and fills one row per quest that is open (State Open), not expired (ExpiresAt &gt; 0 and
        /// <paramref name="serverMs"/> &gt;= ExpiresAt is expired, questModel.ts:38-40) and whose row carries a carrier actor id, in row order.
        /// A null or unavailable view gives none.</summary>
        public static void Rows(QuestView quests, double serverMs, List<CarrierFlagRow> into)
        {
            into.Clear();
            // stub: the implementer fills the rows.
        }
    }
}
