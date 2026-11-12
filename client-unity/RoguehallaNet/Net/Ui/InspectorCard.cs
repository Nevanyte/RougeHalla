using System.Collections.Generic;

namespace Roguehalla.Net.Ui
{
    /// <summary>
    /// The legacy opponent inspector card (packages/client/src/ui/opponentInspector.ts) as a pure function of the hovered actor's
    /// delivered row (docs/backlog/packets/P-UNITY-INSPECTOR-1.md). Only facts the row carries; a legacy line whose fact is not on
    /// the wire is left out. No allocation beyond growing the caller's list.
    /// </summary>
    public static class InspectorCard
    {
        /// <summary>
        /// Clears <paramref name="lines"/> and, when the card shows for <paramref name="row"/>, fills it in legacy order: the kit line,
        /// the health line, then one entry per delivered invested-stat chip. Returns whether the card shows (false leaves the list empty).
        /// </summary>
        public static bool Build(in InterpActor row, uint selfId, List<string> lines)
        {
            return false;   // stub: replaced by the implementer
        }
    }
}
