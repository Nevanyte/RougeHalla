using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Explicit DOM-to-typed reads; no reflection DTO factories, game rules or inferred ownership.</summary>
    public static class AccountFullJson
    {
        const int MaxChars = 1024 * 1024;
        static readonly JsonLoadSettings LoadSettings = new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error };

        static JToken Load(string json)
        {
            if (string.IsNullOrEmpty(json) || json.Length > MaxChars) throw new FormatException();
            using (var text = new StringReader(json))
            using (var reader = new JsonTextReader(text) { DateParseHandling = DateParseHandling.None, FloatParseHandling = FloatParseHandling.Decimal, MaxDepth = 64 })
            {
                JToken token = JToken.ReadFrom(reader, LoadSettings);
                if (reader.Read()) throw new FormatException();
                return token;
            }
        }

        static JObject Object(JToken token) => token as JObject ?? throw new FormatException();
        static JArray Array(JToken token) => token as JArray ?? throw new FormatException();
        static JToken Required(JObject obj, string key) => obj.TryGetValue(key, StringComparison.Ordinal, out var value) ? value : throw new FormatException();
        static string String(JToken token) => token?.Type == JTokenType.String ? (string)token : throw new FormatException();
        static long Integer(JToken token)
        {
            if (token?.Type != JTokenType.Integer) throw new FormatException();
            long value = (long)token;
            if (value < 0) throw new FormatException();
            return value;
        }
        static uint Unsigned(JToken token)
        {
            long value = Integer(token);
            if (value > uint.MaxValue) throw new FormatException();
            return (uint)value;
        }
        static double Number(JToken token)
        {
            if (token?.Type != JTokenType.Integer && token?.Type != JTokenType.Float) throw new FormatException();
            double value = (double)token;
            if (double.IsNaN(value) || double.IsInfinity(value)) throw new FormatException();
            return value;
        }
        static string OptionalString(JObject obj, string key) => obj.TryGetValue(key, out var token) ? String(token) : null;
        static string Month(JToken token)
        {
            string month = String(token);
            if (month.Length != 7 || month[4] != '-') throw new FormatException();
            for (int i = 0; i < month.Length; i++) if (i != 4 && (month[i] < '0' || month[i] > '9')) throw new FormatException();
            int number = (month[5] - '0') * 10 + month[6] - '0';
            if (number < 1 || number > 12) throw new FormatException();
            return month;
        }
        static Dictionary<string, long> Counts(JToken token, bool months = false)
        {
            var result = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (JProperty property in Object(token).Properties())
            {
                if (months) Month(new JValue(property.Name));
                result.Add(property.Name, Integer(property.Value));
            }
            return result;
        }
        static Dictionary<string, string> Strings(JToken token)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (JProperty property in Object(token).Properties()) result.Add(property.Name, String(property.Value));
            return result;
        }
        static List<string> StringList(JToken token, bool months = false)
        {
            var result = new List<string>();
            foreach (JToken item in Array(token)) result.Add(months ? Month(item) : String(item));
            return result;
        }

        static AccountFullProfile Profile(JToken token)
        {
            JObject p = Object(token), stats = Object(Required(p, "stats")), cosmetics = Object(Required(p, "cosmetics")), progress = Object(Required(p, "progress"));
            return new AccountFullProfile(String(Required(p, "name")), Integer(Required(p, "gv")), Integer(Required(p, "gvLifetime")),
                Counts(Required(p, "gvByMonth"), true),
                new AccountFullStats(Integer(Required(stats, "runs")), Integer(Required(stats, "wins")), Integer(Required(stats, "draws")), Integer(Required(stats, "deaths")), Integer(Required(stats, "kills"))),
                new AccountFullCosmetics(StringList(Required(cosmetics, "owned")), Strings(Required(cosmetics, "equipped"))),
                Counts(Required(p, "achievements")),
                new AccountFullProgress(Integer(Required(progress, "qualifiedWins")), Integer(Required(progress, "bountyRuns")), Integer(Required(progress, "bestRunKills")),
                    Counts(Required(progress, "winsByFaction")), Counts(Required(progress, "winsByWeapon"))));
        }

        public static bool TryProfile(string json, out AccountFullProfile profile)
        {
            profile = null;
            try { profile = Profile(Required(Object(Load(json)), "profile")); return true; }
            catch (Exception error) when (Malformed(error)) { return false; }
        }
        public static void AttachProfile(AccountReply ownershipReply, string json)
        {
            if (ownershipReply == null) return;
            ownershipReply.FullProfile = null;
            if (TryProfile(json, out var full) && full.Name == ownershipReply.profile?.name)
                ownershipReply.FullProfile = full;
        }

        public static bool TryLeaderboard(string json, out AccountLeaderboard leaderboard)
        {
            leaderboard = null;
            try
            {
                JObject root = Object(Load(json));
                var entries = new List<AccountLeaderboardEntry>();
                foreach (JToken token in Array(Required(root, "entries")))
                {
                    JObject entry = Object(token);
                    entries.Add(new AccountLeaderboardEntry(String(Required(entry, "name")), Integer(Required(entry, "gv")), OptionalString(entry, "title")));
                }
                AccountLeaderboardRank you = null;
                if (root.TryGetValue("you", out var rankToken))
                {
                    JObject rank = Object(rankToken);
                    you = new AccountLeaderboardRank(Integer(Required(rank, "rank")), Integer(Required(rank, "gv")));
                }
                leaderboard = new AccountLeaderboard(Month(Required(root, "month")), entries, StringList(Required(root, "months"), true), you);
                return true;
            }
            catch (Exception error) when (Malformed(error)) { return false; }
        }

        public static bool TryCosmeticCatalog(string json, out IReadOnlyList<AccountCosmeticDefinition> catalog)
        {
            catalog = null;
            try
            {
                var entries = new List<AccountCosmeticDefinition>(); var ids = new HashSet<string>(StringComparer.Ordinal);
                foreach (JToken token in Array(Load(json)))
                {
                    JObject entry = Object(token); string id = String(Required(entry, "id"));
                    if (!ids.Add(id)) throw new FormatException();
                    entries.Add(new AccountCosmeticDefinition(id, String(Required(entry, "slot")), String(Required(entry, "name")), Unsigned(Required(entry, "code")),
                        entry.TryGetValue("price", out var price) ? Integer(price) : (long?)null,
                        entry.TryGetValue("color", out var color) ? Unsigned(color) : (uint?)null,
                        entry.TryGetValue("width", out var width) ? Number(width) : (double?)null,
                        OptionalString(entry, "style"), OptionalString(entry, "text"), OptionalString(entry, "target")));
                }
                catalog = entries.AsReadOnly(); return true;
            }
            catch (Exception error) when (Malformed(error)) { return false; }
        }

        public static string EncodeMutation(AccountApiRequest request)
        {
            var body = new JObject { ["id"] = request.ItemId == null ? JValue.CreateNull() : new JValue(request.ItemId) };
            if (!request.PurchaseId.HasValue) body["slot"] = request.Slot;
            return body.ToString(Formatting.None);
        }

        public static bool TryAchievementCatalog(string json, out IReadOnlyList<AccountAchievementDefinition> catalog)
        {
            catalog = null;
            try
            {
                var entries = new List<AccountAchievementDefinition>(); var ids = new HashSet<string>(StringComparer.Ordinal);
                foreach (JToken token in Array(Load(json)))
                {
                    JObject entry = Object(token); string id = String(Required(entry, "id"));
                    if (!ids.Add(id) || entry.TryGetValue("goal", out _)) throw new FormatException();
                    entries.Add(new AccountAchievementDefinition(id, String(Required(entry, "name")), String(Required(entry, "desc")), StringList(Required(entry, "reward"))));
                }
                catalog = entries.AsReadOnly(); return true;
            }
            catch (Exception error) when (Malformed(error)) { return false; }
        }

        public static AccountApiError DecodeError(int status, string json)
        {
            try
            {
                JObject error = Object(Load(json)); String(Required(error, "error"));
                string code = OptionalString(error, "code");
                int expectedStatus = code == "forbidden" ? 403 : code == "bad_request" ? 400 : code == "unknown_cosmetic" ? 404 :
                    code == "unknown_slot" || code == "slot_mismatch" ? 400 : code == "insufficient_gv" ? 402 :
                    code == "not_for_sale" || code == "already_owned" || code == "not_owned" ? 409 : 0;
                if (expectedStatus != status) return new AccountApiError(Fallback(status));
                AccountApiFailure failure = code == "forbidden" ? AccountApiFailure.Forbidden : code == "bad_request" ? AccountApiFailure.BadRequest :
                    code == "unknown_cosmetic" ? AccountApiFailure.UnknownCosmetic : code == "unknown_slot" ? AccountApiFailure.UnknownSlot :
                    code == "not_for_sale" ? AccountApiFailure.NotForSale : code == "already_owned" ? AccountApiFailure.AlreadyOwned :
                    code == "insufficient_gv" ? AccountApiFailure.InsufficientGv : code == "not_owned" ? AccountApiFailure.NotOwned :
                    code == "slot_mismatch" ? AccountApiFailure.SlotMismatch : Fallback(status);
                return failure == AccountApiFailure.InsufficientGv
                    ? new AccountApiError(failure, Integer(Required(error, "need")), Integer(Required(error, "have")))
                    : new AccountApiError(failure);
            }
            catch (Exception error) when (Malformed(error)) { return new AccountApiError(Fallback(status)); }
        }
        static AccountApiFailure Fallback(int status) => status == 403 ? AccountApiFailure.Forbidden :
            status == 400 || status == 413 || status == 415 ? AccountApiFailure.BadRequest : status == 429 ? AccountApiFailure.RateLimited : AccountApiFailure.Unavailable;

        static bool Malformed(Exception error) => error is JsonException || error is FormatException || error is OverflowException ||
            error is ArgumentException || error is InvalidCastException;
    }
}
