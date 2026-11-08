using UnityEngine;

namespace Roguehalla.Client
{
    public enum ShowcasePreviewAction { Idle, Walk, Attack, Block, Hit, Death, Cast, Shoot }

    /// <summary>Resolves staged catalog frames for the no-network animation preview only.</summary>
    public static class ShowcaseAnimationPreview
    {
        public const int ActionCount = 8;
        public const int DirectionCount = 8;
        const float FallbackFramesPerSecond = 10f;

        static readonly string[] DirectionNames = { "SW", "W", "NW", "N", "NE", "E", "SE", "S" };

        public static string DirectionName(int direction)
        {
            return DirectionNames[NormalizeDirection(direction)];
        }

        public static bool TryFrame(ShowcaseCatalog.Appearance appearance, ShowcasePreviewAction action,
            int direction, float elapsedSeconds, bool reducedMotion, out Sprite frame)
        {
            frame = null;
            if (appearance == null || !TryGetClip(appearance, action, out var frames, out float authoredFps))
                return false;
            if (frames == null || frames.Length < DirectionCount || frames.Length % DirectionCount != 0)
                return false;

            int framesPerDirection = frames.Length / DirectionCount;
            if (framesPerDirection <= 0) return false;

            int frameInDirection;
            if (reducedMotion)
            {
                frameInDirection = action == ShowcasePreviewAction.Death ? framesPerDirection - 1 : 0;
            }
            else
            {
                float elapsed = IsFinite(elapsedSeconds) && elapsedSeconds > 0f ? elapsedSeconds : 0f;
                float fps = IsPositiveFinite(authoredFps) ? authoredFps :
                    IsPositiveFinite(appearance.FramesPerSecond) ? appearance.FramesPerSecond : FallbackFramesPerSecond;
                double framePosition = System.Math.Floor((double)elapsed * fps);
                if (action == ShowcasePreviewAction.Death)
                    frameInDirection = framePosition >= framesPerDirection - 1 ? framesPerDirection - 1 : (int)framePosition;
                else
                    frameInDirection = (int)(framePosition % framesPerDirection);
            }

            int index = NormalizeDirection(direction) * framesPerDirection + frameInDirection;
            if (frames[index] == null) return false;
            frame = frames[index];
            return true;
        }

        static bool TryGetClip(ShowcaseCatalog.Appearance appearance, ShowcasePreviewAction action,
            out Sprite[] frames, out float fps)
        {
            fps = 0f;
            switch (action)
            {
                case ShowcasePreviewAction.Idle: frames = appearance.Idle; fps = appearance.IdleFPS; return true;
                case ShowcasePreviewAction.Walk: frames = appearance.Walk; fps = appearance.WalkFPS; return true;
                case ShowcasePreviewAction.Attack: frames = appearance.Attack; fps = appearance.AttackFPS; return true;
                case ShowcasePreviewAction.Block: frames = appearance.Block; fps = appearance.BlockFPS; return true;
                case ShowcasePreviewAction.Hit: frames = appearance.Hit; fps = appearance.HitFPS; return true;
                case ShowcasePreviewAction.Death: frames = appearance.Death; fps = appearance.DeathFPS; return true;
                case ShowcasePreviewAction.Cast: frames = appearance.Cast; fps = appearance.CastFPS; return true;
                case ShowcasePreviewAction.Shoot: frames = appearance.Shoot; fps = appearance.ShootFPS; return true;
                default: frames = null; return false;
            }
        }

        static int NormalizeDirection(int direction)
        {
            return ((direction % DirectionCount) + DirectionCount) % DirectionCount;
        }

        static bool IsPositiveFinite(float value)
        {
            return value > 0f && IsFinite(value);
        }

        static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }
}
