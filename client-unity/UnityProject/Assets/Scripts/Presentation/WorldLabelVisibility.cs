namespace Roguehalla.Client
{
    /// <summary>
    /// Whether world name labels (the overhead names of mobs and fighters) may be drawn (P-UNITY-HUD-VISUAL-FIX-4). The Tab map sets
    /// <see cref="Hidden"/> while it is open; the actor presenter hides every name while it is true. Stub: nothing sets or reads it yet.
    /// </summary>
    public static class WorldLabelVisibility
    {
        public static bool Hidden;
    }
}
