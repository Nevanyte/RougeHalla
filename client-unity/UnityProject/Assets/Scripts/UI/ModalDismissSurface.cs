using System;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Roguehalla.Client
{
    /// <summary>Dismisses only presses on the scrim itself; content clicks never bubble into dismissal.</summary>
    public sealed class ModalDismissSurface : MonoBehaviour, IPointerDownHandler
    {
        public Action Dismiss;
        public void OnPointerDown(PointerEventData data)
        {
            if (data.pointerCurrentRaycast.gameObject == gameObject) Dismiss?.Invoke();
        }
    }
}
