using TMPro;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        TMP_Text _settlementText;
        UnityEngine.UI.Button _settlementRetry;

        static readonly string[] ResultLabels = { "Place", "Kills", "GV earned", "Duration", "Killed by" };
        readonly TMP_Text[] _resultLabel = new TMP_Text[5], _resultValue = new TMP_Text[5];
        TMP_Text _resultOutcome, _resultNote;

        /// <summary>
        /// The end-of-run screen in the settled skin: a centred framed card in HUD units (title rule, outcome in the display face, a label and
        /// value row per delivered fact, the saved-credit line, then Play again and Return to menu). The facts are the server's Result only.
        /// </summary>
        void CreateResultsCard()
        {
            var theme = UiTheme.Current;
            _results = ModalBackdrop("Results");
            var card = ModalCard(_results, "ResultsCard", 520f, 376f, "RUN RESULTS", null, false);
            _resultTitle = card.GetComponentInChildren<TMP_Text>();
            _resultOutcome = LaunchUi.Text(card, "ResultOutcome", 16f, 54f, 488f, 38f, "", 26f, theme.Accent, TextAlignmentOptions.MidlineLeft, true, UiFontRole.Display);
            for (int i = 0; i < ResultLabels.Length; i++)
            {
                _resultLabel[i] = LaunchUi.Text(card, "ResultLabel" + i, 16f, 102f + i * 30f, 150f, 26f, ResultLabels[i].ToUpperInvariant(), 11.5f, theme.TextSecondary, TextAlignmentOptions.MidlineLeft, true);
                _resultValue[i] = LaunchUi.Text(card, "ResultValue" + i, 170f, 102f + i * 30f, 334f, 26f, "", 16f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft, true);
            }
            _resultNote = LaunchUi.Text(card, "ResultNote", 16f, 252f, 488f, 40f, "", 13f, theme.Warning, TextAlignmentOptions.TopLeft, false, UiFontRole.Body, true);
            CreateSettlementRow(card);
            var again = LaunchUi.Button(card, "Rejoin", 16f, 324f, 238f, 42f, LaunchUi.Look.Primary, JoinAgain);
            LaunchUi.Text(again.transform, "Label", 0, 0, 238f, 42f, "PLAY AGAIN", 14f, theme.OutlineDark, TextAlignmentOptions.Center, true);
            var menu = LaunchUi.Button(card, "Menu", 266f, 324f, 238f, 42f, LaunchUi.Look.Raised, () => _client.Leave());
            LaunchUi.Text(menu.transform, "Label", 0, 0, 238f, 42f, "RETURN TO MENU", 14f, theme.TextPrimary, TextAlignmentOptions.Center, true);
        }

        void ShowResultFacts(Roguehalla.Net.Protocol.WireResult r)
        {
            var theme = UiTheme.Current;
            _resultOutcome.text = r.Outcome < Outcomes.Length ? Outcomes[r.Outcome] : "Outcome " + r.Outcome;
            _resultOutcome.color = r.Outcome == 0 ? (Color)theme.Accent : r.Outcome == 2 ? (Color)theme.Warning : (Color)theme.TextPrimary;
            string[] values = { r.Place + " of " + r.Players, r.Kills.ToString(), r.GvTotal + "  (win " + r.GvWin + ")", r.DurationSec + " s", r.KilledBy };
            for (int i = 0; i < values.Length; i++)
            {
                bool show = i != 4 || !string.IsNullOrEmpty(r.KilledBy);
                _resultLabel[i].gameObject.SetActive(show); _resultValue[i].gameObject.SetActive(show); _resultValue[i].text = values[i] ?? "";
            }
            _resultNote.text = r.WinBonusWithheld ? "Win bonus withheld by server" : "";
        }

        void ShowResultMessage(string message)
        {
            _resultOutcome.text = "No result"; _resultOutcome.color = UiTheme.Current.Warning;
            for (int i = 0; i < 5; i++) { _resultLabel[i].gameObject.SetActive(false); _resultValue[i].gameObject.SetActive(false); }
            _resultNote.text = message; _resultNote.color = UiTheme.Current.TextPrimary;
        }

        void CreateSettlementRow(RectTransform card)
        {
            var theme = UiTheme.Current;
            _settlementText = LaunchUi.Text(card, "SavedCredit", 16f, 280f, 330f, 36f, "", 13f, theme.TextPrimary, TextAlignmentOptions.MidlineLeft, false, UiFontRole.Body, true);
            var retry = LaunchUi.Button(card, "CheckSavedCredit", 360f, 282f, 144f, 32f, LaunchUi.Look.Raised, () => _client?.CheckSettlementAgain());
            LaunchUi.Text(retry.transform, "Label", 0, 0, 144f, 32f, "CHECK AGAIN", 12.5f, theme.TextPrimary, TextAlignmentOptions.Center, true);
            _settlementRetry = retry;
            _settlementRetry.gameObject.SetActive(false);
        }

        void RefreshSettlementRow()
        {
            if (_settlementText == null || _settlementRetry == null) return;
            string text = _client != null && ReferenceEquals(_session, _client.Session) ? _client.SettlementText : "";
            Set(_settlementText, text);
            _settlementRetry.gameObject.SetActive(text.Length != 0);
            _settlementRetry.interactable = _client != null && _client.CanCheckSettlement;
        }
    }
}
