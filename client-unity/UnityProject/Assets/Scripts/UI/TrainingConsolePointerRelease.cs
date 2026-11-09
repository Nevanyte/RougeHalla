using UnityEngine;
using UnityEngine.EventSystems;
using TMPro;

namespace Roguehalla.Client
{
    /// <summary>Only a pointer activation releases a control; keyboard selection remains navigable.</summary>
    public sealed class TrainingConsolePointerRelease : MonoBehaviour, IPointerClickHandler
    {
        public void OnPointerClick(PointerEventData data)
        {
            if (data == null || data.button != PointerEventData.InputButton.Left) return;
            if (EventSystem.current == null) return;
            var selected = EventSystem.current.currentSelectedGameObject;
            if (selected == null || selected != gameObject && !selected.transform.IsChildOf(transform)) return;
            selected.GetComponent<TMP_InputField>()?.DeactivateInputField();
            EventSystem.current.SetSelectedGameObject(null);
        }
    }
}
