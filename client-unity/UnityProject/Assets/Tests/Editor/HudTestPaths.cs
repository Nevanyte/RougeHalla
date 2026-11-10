using UnityEngine;

namespace Roguehalla.Client.Tests
{
    /// <summary>
    /// Finds HUD nodes by their canvas-relative path. The legacy HUD lives under a HudStage and a ChromeStage child of MatchUI, so the
    /// old "MatchUI/Rewards" style paths are resolved against those stages, falling back to a search for the last path segment.
    /// </summary>
    public static class HudTestPaths
    {
        public static Transform Find(Transform from, string path)
        {
            var direct = from.Find(path);
            if (direct != null) return direct;
            if (path.StartsWith("MatchUI/"))
            {
                string rest = path.Substring("MatchUI/".Length);
                foreach (string stage in new[] { "HudStage", "ChromeStage" })
                {
                    var t = from.Find("MatchUI/" + stage + "/" + rest);
                    if (t != null) return t;
                }
            }
            string leaf = path.Substring(path.LastIndexOf('/') + 1);
            var matchUi = from.Find("MatchUI") ?? from;
            return FindDeep(matchUi, leaf);
        }

        public static Transform FindDeep(Transform root, string name)
        {
            foreach (Transform child in root)
            {
                if (child.name == name) return child;
                var nested = FindDeep(child, name);
                if (nested != null) return nested;
            }
            return null;
        }
    }
}
