using UnityEngine;

namespace Roguehalla.Client
{
    /// <summary>
    /// The actors the client is drawing this frame (only server-delivered ones ever reach ArenaView.Present), as tile positions for the surface
    /// shaders: cloud shadows clear around them and grass parts around them. The nearest <see cref="Max"/> to the camera are uploaded. No allocation.
    /// </summary>
    public static class ActorField
    {
        public const int Capacity = 96, Max = 8;
        static readonly Vector2[] All = new Vector2[Capacity];
        static readonly Vector4[] Out = new Vector4[Max];
        static readonly float[] Dist = new float[Max];
        static int _n, _sent;
        static readonly int IdActors = Shader.PropertyToID("_RhActors");

        public static int Noted { get { return _n; } }
        /// <summary>Actors uploaded by the last <see cref="Push"/>.</summary>
        public static int Sent { get { return _sent; } }
        public static Vector4 SentAt(int i) { return Out[i]; }

        public static void Begin() { _n = 0; }

        /// <summary>Note one presented actor by its Unity world position.</summary>
        public static void Note(Vector3 world)
        {
            if (_n >= Capacity) return;
            All[_n++] = new Vector2(world.x, -world.y / ArenaView.GroundSquash);
        }

        /// <summary>Pick the nearest actors to the camera (tile space) and upload them. Returns how many.</summary>
        public static int Push(float camTx, float camTy)
        {
            int count = 0;
            for (int i = 0; i < _n; i++)
            {
                float dx = All[i].x - camTx, dy = All[i].y - camTy, d = dx * dx + dy * dy;
                int at = count < Max ? count : Max;
                while (at > 0 && Dist[at - 1] > d) { if (at < Max) { Dist[at] = Dist[at - 1]; Out[at] = Out[at - 1]; } at--; }
                if (at >= Max) continue;
                Dist[at] = d; Out[at] = new Vector4(All[i].x, All[i].y, 1f, 0f); if (count < Max) count++;
            }
            _sent = count;
            Shader.SetGlobalVectorArray(IdActors, Out);
            return count;
        }
    }
}
