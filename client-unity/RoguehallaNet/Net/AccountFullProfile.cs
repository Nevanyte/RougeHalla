using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace Roguehalla.Net
{
    internal static class AccountData
    {
        internal static long Count(long value)
        { if (value < 0) throw new ArgumentOutOfRangeException(nameof(value)); return value; }
        internal static IReadOnlyDictionary<string, T> Map<T>(IDictionary<string, T> source)
        { return new ReadOnlyDictionary<string, T>(new Dictionary<string, T>(source ?? throw new ArgumentNullException(nameof(source)), StringComparer.Ordinal)); }
        internal static IReadOnlyList<T> List<T>(IEnumerable<T> source)
        { return new List<T>(source ?? throw new ArgumentNullException(nameof(source))).AsReadOnly(); }
    }

    public sealed class AccountFullStats
    {
        public long Runs { get; }
        public long Wins { get; }
        public long Draws { get; }
        public long Deaths { get; }
        public long Kills { get; }
        public AccountFullStats(long runs, long wins, long draws, long deaths, long kills)
        { Runs = AccountData.Count(runs); Wins = AccountData.Count(wins); Draws = AccountData.Count(draws); Deaths = AccountData.Count(deaths); Kills = AccountData.Count(kills); }
    }

    public sealed class AccountFullProgress
    {
        public long QualifiedWins { get; }
        public long BountyRuns { get; }
        public long BestRunKills { get; }
        public IReadOnlyDictionary<string, long> WinsByFaction { get; }
        public IReadOnlyDictionary<string, long> WinsByWeapon { get; }
        public AccountFullProgress(long qualifiedWins, long bountyRuns, long bestRunKills,
            IDictionary<string, long> winsByFaction, IDictionary<string, long> winsByWeapon)
        {
            QualifiedWins = AccountData.Count(qualifiedWins); BountyRuns = AccountData.Count(bountyRuns); BestRunKills = AccountData.Count(bestRunKills);
            WinsByFaction = AccountData.Map(winsByFaction); WinsByWeapon = AccountData.Map(winsByWeapon);
        }
    }

    public sealed class AccountFullCosmetics
    {
        public IReadOnlyList<string> Owned { get; }
        public IReadOnlyDictionary<string, string> Equipped { get; }
        public AccountFullCosmetics(IEnumerable<string> owned, IDictionary<string, string> equipped)
        { Owned = AccountData.List(owned); Equipped = AccountData.Map(equipped); }
    }

    /// <summary>Complete known server profile DTO. This is a delivered fact, never local unlock, money or purchase authority.</summary>
    public sealed class AccountFullProfile
    {
        public string Name { get; }
        public long Gv { get; }
        public long GvLifetime { get; }
        public IReadOnlyDictionary<string, long> GvByMonth { get; }
        public AccountFullStats Stats { get; }
        public AccountFullCosmetics Cosmetics { get; }
        public IReadOnlyDictionary<string, long> Achievements { get; }
        public AccountFullProgress Progress { get; }
        public AccountFullProfile(string name, long gv, long gvLifetime, IDictionary<string, long> gvByMonth,
            AccountFullStats stats, AccountFullCosmetics cosmetics, IDictionary<string, long> achievements, AccountFullProgress progress)
        {
            AccountEndpoint.NormalizeName(name); Name = name;
            Gv = AccountData.Count(gv); GvLifetime = AccountData.Count(gvLifetime); GvByMonth = AccountData.Map(gvByMonth);
            Stats = stats ?? throw new ArgumentNullException(nameof(stats)); Cosmetics = cosmetics ?? throw new ArgumentNullException(nameof(cosmetics));
            Achievements = AccountData.Map(achievements); Progress = progress ?? throw new ArgumentNullException(nameof(progress));
        }
    }

    public sealed class AccountLeaderboardEntry
    {
        public string Name { get; }
        public long Gv { get; }
        public string Title { get; }
        public AccountLeaderboardEntry(string name, long gv, string title)
        { AccountEndpoint.NormalizeName(name); Name = name; Gv = AccountData.Count(gv); Title = title; }
    }

    public sealed class AccountLeaderboardRank
    {
        public long Rank { get; }
        public long Gv { get; }
        public AccountLeaderboardRank(long rank, long gv)
        { if (rank <= 0) throw new ArgumentOutOfRangeException(nameof(rank)); Rank = rank; Gv = AccountData.Count(gv); }
    }

    public sealed class AccountLeaderboard
    {
        public string Month { get; }
        public IReadOnlyList<AccountLeaderboardEntry> Entries { get; }
        public IReadOnlyList<string> Months { get; }
        public AccountLeaderboardRank You { get; }
        public AccountLeaderboard(string month, IEnumerable<AccountLeaderboardEntry> entries, IEnumerable<string> months, AccountLeaderboardRank you)
        { Month = month; Entries = AccountData.List(entries); Months = AccountData.List(months); You = you; }
    }

    /// <summary>Presentation metadata only. Server catalog lookup alone decides price, ownership and slot eligibility.</summary>
    public sealed class AccountCosmeticDefinition
    {
        public string Id { get; }
        public string Slot { get; }
        public string Name { get; }
        public uint Code { get; }
        public long? Price { get; }
        public uint? Color { get; }
        public double? Width { get; }
        public string Style { get; }
        public string Text { get; }
        public string Target { get; }
        public AccountCosmeticDefinition(string id, string slot, string name, uint code, long? price, uint? color,
            double? width, string style, string text, string target)
        { Id = id; Slot = slot; Name = name; Code = code; Price = price; Color = color; Width = width; Style = style; Text = text; Target = target; }
    }

    /// <summary>Labels and reward references only. Unlock evaluation and granting remain server-owned.</summary>
    public sealed class AccountAchievementDefinition
    {
        public string Id { get; }
        public string Name { get; }
        public string Description { get; }
        public IReadOnlyList<string> Rewards { get; }
        public AccountAchievementDefinition(string id, string name, string description, IEnumerable<string> rewards)
        { Id = id; Name = name; Description = description; Rewards = AccountData.List(rewards); }
    }
}
