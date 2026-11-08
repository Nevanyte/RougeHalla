using Roguehalla.Net;

namespace Roguehalla.Client
{
    /// <summary>Turns server-delivered potion notice codes into presentation text.</summary>
    public static class PotionNoticeFormatter
    {
        public static string Format(PotionNotice notice)
        {
            switch (notice)
            {
                case PotionNotice.Stored: return "Small potion stored · Heal 25% HP over 5s";
                case PotionNotice.BagFull: return "Consumable bag full (5 of each)";
                case PotionNotice.Used: return "Small potion · healing over 5s";
                case PotionNotice.Blocked: return "Can't use an item now";
                case PotionNotice.Busy: return "Already drinking 3 potions";
                case PotionNotice.Full: return "Already at full health";
                case PotionNotice.Empty: return "No potion stored";
                case PotionNotice.LargeStored: return "Camp potion stored · Heal 40% HP over 5s";
                case PotionNotice.LargeUsed: return "Camp potion · healing over 5s";
                case PotionNotice.CampBagFull: return "Camp cleared · camp potion bag full (5)";
                default: return "Potion update";
            }
        }
    }
}
