using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// Pointer-to-actor picking maths (UI hit geometry only; the server decides every targeting rule). Before ADR0024 an actor was picked
    /// within <see cref="FeetPixels"/> of its feet. A drawn body stands above the feet, so with a delivered body box a pointer anywhere
    /// inside the box's screen rectangle (the sprite's torso) also picks it, and the feet radius still works.
    /// </summary>
    public static class ActorPick
    {
        public const float FeetPixels = 22f;

        /// <summary>
        /// Squared pixel distance that ranks a hit (smaller wins), or a negative number when <paramref name="pointer"/> does not pick the
        /// actor. The distance is to the nearer of the feet and, with a body box, the box centre.
        /// </summary>
        public static float Score(Vector2 pointer, Vector2 feet, bool hasBody, Vector2 bodyCornerA, Vector2 bodyCornerB)
        {
            float best = (pointer - feet).sqrMagnitude;
            bool hit = best < FeetPixels * FeetPixels;
            if (hasBody)
            {
                Vector2 lo = Vector2.Min(bodyCornerA, bodyCornerB), hi = Vector2.Max(bodyCornerA, bodyCornerB);
                if (pointer.x >= lo.x && pointer.x <= hi.x && pointer.y >= lo.y && pointer.y <= hi.y)
                {
                    hit = true;
                    float c = (pointer - (lo + hi) * .5f).sqrMagnitude;
                    if (c < best) best = c;
                }
            }
            return hit ? best : -1f;
        }
    }
}
