namespace Roguehalla.Net.Ui
{
    /// <summary>Where a landed melee swing zone is drawn this frame. Legacy FxView.advance re-places it at the attacker's drawn position and keeps the last one when that is unavailable.</summary>
    public static class HitZoneFollow
    {
        /// <summary>
        /// <paramref name="lastX"/>/<paramref name="lastY"/>: the zone's current origin. <paramref name="drawn"/>: the anchor actor has a drawn position this frame
        /// (the predicted one for the local player), at <paramref name="drawnX"/>/<paramref name="drawnY"/>. Returns the origin to draw at; a missing or non-finite anchor keeps the last origin.
        /// </summary>
        public static void Origin(float lastX, float lastY, bool drawn, float drawnX, float drawnY, out float x, out float y)
        {
            if (drawn && float.IsFinite(drawnX) && float.IsFinite(drawnY)) { x = drawnX; y = drawnY; return; }
            x = lastX; y = lastY;
        }
    }
}
