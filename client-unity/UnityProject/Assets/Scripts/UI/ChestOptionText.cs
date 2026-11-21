using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>What a chest option card shows: kind line, title, description and tags, from the display catalog and server facts.</summary>
    public static class ChestOptionText
    {
        public readonly struct Card
        {
            public readonly string Kind, Title, Text, Tags;
            public Card(string kind, string title, string text, string tags) { Kind = kind; Title = title; Text = text; Tags = tags; }
        }

        public static Card Describe(RewardOptionView option)
        {
            if (option.KillKey.HasValue) return new Card("TROPHY", "", TrophyText.Description(option.KillKey.Value, option.KillGain), "");
            if (option.Card.HasValue)
            {
                var entry = CardDisplayCatalog.Get((byte)option.Card.Value);
                return new Card("AUGMENT", entry.Title, entry.Description, entry.Tags);
            }
            return new Card("BOOST", "", "Permanent bonus for this run.", "");
        }
    }
}
