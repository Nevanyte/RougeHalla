// The glue between what a Session delivers (protocol 16, ADR0026: weapon table, roster, indicator flags) and the presenters: feeds
// WeaponShapes from the Welcome weapon table and hands each fighter's indicator facts to its overhead cluster. Presentation only.
using System.Collections.Generic;
using Roguehalla.Net;
using Roguehalla.Net.Protocol;
using Roguehalla.Net.Ui;

namespace Roguehalla.Client
{
    public static class LegacyFacts
    {
        static WireWeapon[] _lastWeapons;
        /// <summary>Gives the hit-zone provider the server's weapon table (once per Welcome). An empty table leaves the provider as it is.</summary>
        public static void SyncWeapons(WireWeapon[] table)
        {
            if (table == null || table.Length == 0 || ReferenceEquals(table, _lastWeapons)) return;
            _lastWeapons = table;                  // the full rows stay available (Speed and Radius too) for the range guide
            var rows = new List<WeaponShape>(table.Length);
            foreach (var w in table) rows.Add(new WeaponShape { Weapon = w.Id, Kind = w.Kind, Reach = (float)w.Reach, HalfArc = (float)w.HalfArc });
            WeaponShapes.Set(rows);
        }

        /// <summary>The Welcome table row of a weapon (every field, including projectile Speed and Radius), or null when the table does not list it.</summary>
        public static WireWeapon WeaponRow(WeaponId weapon)
        {
            if (_lastWeapons == null) return null;
            foreach (var w in _lastWeapons) if (w.Id == (byte)weapon) return w;
            return null;
        }

        /// <summary>Whether a projectile weapon is drawn as a ball (a circle of its range) rather than an arrow lane. The wire row does not say, so this is
        /// the one place the weapon id decides it (legacy: the wand). Replace this body if the wire gains a flag.</summary>
        public static bool IsBallWeapon(WeaponId weapon) { return weapon == WeaponId.Wand; }

        static readonly Dictionary<uint, string> Names = new Dictionary<uint, string>(); static Session _namesFor; static int _namesCount = -1;
        /// <summary>The overhead name of a fighter: the roster name, "[BOT] name" for a bot, null when the roster does not know it. Cached per id.</summary>
        /// <summary>DIAGNOSTICS (UI lab, ?uilab=1): answers names where there is no Session.</summary>
        public static System.Func<uint, string> NameOverride;
        public static string NameOf(Session session, uint id)
        {
            if (NameOverride != null) return NameOverride(id);
            if (session == null) return null;
            var roster = session.Roster; int count = roster == null ? 0 : roster.Count;
            if (!ReferenceEquals(session, _namesFor) || count != _namesCount) { Names.Clear(); _namesFor = session; _namesCount = count; }
            if (Names.TryGetValue(id, out var cached)) return cached;
            string display = null;
            if (roster != null) foreach (var e in roster) if (e.Id == id) { display = Indicators.DisplayName(e.Name, e.Bot); break; }
            Names[id] = display; return display;
        }

        public static OverheadIndicators.Marks Of(in InterpActor a, string name)
        {
            return new OverheadIndicators.Marks { Name = name, Immune = a.TeleportImmune, Roam = a.RoamReady, Engaged = a.Engaged,
                Top1 = a.TopStat1.HasValue ? (byte)a.TopStat1.Value : (byte)0, Top2 = a.TopStat2.HasValue ? (byte)a.TopStat2.Value : (byte)0, Tier = a.MarkTier, Brand = a.Brand, Tax = a.MarkTax };
        }

        public static OverheadIndicators.Marks Of(SelfView me, string name)
        {
            return new OverheadIndicators.Marks { Name = name, Immune = me.TeleportImmune, Roam = me.RoamReady,
                Top1 = me.TopStat1.HasValue ? (byte)me.TopStat1.Value : (byte)0, Top2 = me.TopStat2.HasValue ? (byte)me.TopStat2.Value : (byte)0, Tier = me.MarkTier, Brand = me.Brand, Tax = me.MarkTax };
        }

        /// <summary>The Wish state beside a remote player's name: 0 none (not a player, or no faction), 1 ready, 2 recharging (the wire carries only ready or not).</summary>
        public static int RemoteWish(in InterpActor a) { return a.Kind != ActorKind.Player || !a.Faction.HasValue || a.Status == ActorStatus.Lobby ? 0 : a.WishReady ? 1 : 2; }
    }
}
