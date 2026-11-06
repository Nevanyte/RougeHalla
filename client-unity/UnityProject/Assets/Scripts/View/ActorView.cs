using UnityEngine;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Appends only the actor facts supplied for this frame. No retained NPC identity or simulation.</summary>
    public static class ActorView
    {
        static readonly Color32[] FactionColors =
        {
            new Color32(255, 112, 67, 255), new Color32(149, 117, 205, 255), new Color32(156, 204, 101, 255),
            new Color32(79, 195, 247, 255), new Color32(255, 241, 118, 255),
        };
        static readonly Color32 Ink = new Color32(22, 26, 34, 255), White = new Color32(240, 247, 255, 255);
        public static Color32 FactionColor(FactionId faction)
        {
            int i = (int)faction;
            return i >= 0 && i < FactionColors.Length ? FactionColors[i] : new Color32(176, 176, 176, 255);
        }

        public static void Draw(MeshBuilder b, float x, float y, float facing, int hpPct, FactionId faction,
            ActorStatus status, WeaponId weapon, ActorKind kind, MobTypeId? mobType, ushort effects, byte signature, bool local)
        {
            var p = new Vector3(x * ArenaView.Scale, 0.08f, -y * ArenaView.Scale);
            const float radius = 0.375f;
            bool mob = kind == ActorKind.RegionalMob;
            bool fallen = status == ActorStatus.Dead || status == ActorStatus.Mia;
            Color32 color = fallen ? new Color32(105, 109, 121, 255) : FactionColor(faction);
            if (local) b.Ring(p, radius + 0.11f, 0.055f, White);
            // Players are round; all regional mobs have angular bodies and paired horns.
            b.DiscAt(p + Vector3.up * 0.01f, radius + 0.035f, mob ? 4 : 16, Ink);
            b.DiscAt(p + Vector3.up * 0.02f, radius, mob ? 4 : 16, color);
            if (mob)
            {
                b.Line(p + new Vector3(-0.24f, .03f, .13f), p + new Vector3(-.39f, .03f, .39f), .08f, White);
                b.Line(p + new Vector3(.24f, .03f, .13f), p + new Vector3(.39f, .03f, .39f), .08f, White);
                // A bounded 1–6 pip motif distinguishes the supplied type within each faction's palette.
                if (mobType.HasValue)
                    for (int i = 0; i <= (int)mobType.Value % 6; i++)
                        b.DiscAt(p + new Vector3(-.22f + i * .088f, .05f, 0), .025f, 4, Ink);
            }
            if (fallen)
            {
                b.Line(p + new Vector3(-.2f, .06f, -.2f), p + new Vector3(.2f, .06f, .2f), .08f, White);
                b.Line(p + new Vector3(.2f, .06f, -.2f), p + new Vector3(-.2f, .06f, .2f), .08f, White);
                return;
            }
            var forward = new Vector3(Mathf.Cos(facing), 0, -Mathf.Sin(facing));
            b.Line(p + Vector3.up * .04f, p + Vector3.up * .04f + forward * .43f, .07f, White);
            b.Weapon(p + forward * .61f + Vector3.up * .06f, weapon, facing, .7f, White);
            b.Rect(p + new Vector3(0, .08f, -.58f), .9f, .14f, Ink);
            float fill = Mathf.Clamp01(hpPct / 100f);
            b.Rect(p + new Vector3(-.45f + .45f * fill, .09f, -.58f), .9f * fill, .085f, new Color32(96, 227, 147, 255));
            // Exact public bit indicators. They never apply a status or infer an expiry.
            for (int bit = 0; bit < 13; bit++)
                if ((effects & (1 << bit)) != 0)
                    b.Rect(p + new Vector3(-.42f + bit * .07f, .10f, -.76f), .05f, .09f, EffectColor(bit));
            if (signature != 0)
                for (int bit = 0; bit < 8; bit++)
                    if ((signature & (1 << bit)) != 0)
                        b.DiscAt(p + new Vector3(-.32f + bit * .09f, .10f, .54f), .045f, 4,
                            bit == 0 ? FactionColors[3] : bit == 1 ? FactionColors[0] : bit == 2 ? FactionColors[2] : FactionColors[1]);
            if (status == ActorStatus.Lobby) b.Ring(p + Vector3.up * .04f, .22f, .035f, White);
        }

        static Color32 EffectColor(int bit)
        {
            if (bit <= 2) return new Color32(255, 208, 89, 255); // stun/root/silence
            if (bit <= 4) return new Color32(102, 204, 255, 255); // slows
            if (bit <= 6) return new Color32(241, 117, 103, 255); // antiheal/dot
            if (bit == 12) return new Color32(207, 157, 255, 255); // casting
            return new Color32(216, 230, 243, 255);
        }
    }
}
