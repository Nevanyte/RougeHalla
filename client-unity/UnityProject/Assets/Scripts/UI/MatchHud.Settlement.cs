using TMPro;

namespace Roguehalla.Client
{
    public sealed partial class MatchHud
    {
        TMP_Text _settlementText;
        UnityEngine.UI.Button _settlementRetry;

        void CreateSettlementRow()
        {
            _settlementText = Text(_results, "SavedCredit", "", .08f, .27f, .67f, .43f, 19);
            SetBaseSize(_settlementText, 19);
            _settlementText.color = ShowcasePalette.Text;
            _settlementRetry = Button(_results, "CheckSavedCredit", "Check again", .69f, .28f, .92f, .41f,
                () => _client?.CheckSettlementAgain());
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
