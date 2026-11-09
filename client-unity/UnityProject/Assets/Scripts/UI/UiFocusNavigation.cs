using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Roguehalla.Client
{
    public static class UiFocusNavigation
    {
        public static bool Cycle(Transform root, bool backwards)
        {
            if (root == null || EventSystem.current == null) return false;
            var controls = root.GetComponentsInChildren<Selectable>(false);
            int selected = -1, count = 0;
            var current = EventSystem.current.currentSelectedGameObject;
            for (int i = 0; i < controls.Length; i++)
            {
                if (!controls[i].IsActive() || !controls[i].IsInteractable() || controls[i].navigation.mode == Navigation.Mode.None) continue;
                controls[count] = controls[i]; if (controls[count].gameObject == current) selected = count;
                count++;
            }
            if (count == 0) return false;
            int next = selected < 0 ? backwards ? count - 1 : 0 : (selected + (backwards ? count - 1 : 1)) % count;
            controls[next].Select();
            return true;
        }
    }

}
