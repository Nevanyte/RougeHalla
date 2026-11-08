namespace Roguehalla.Net.Ui
{
    public enum UiKey { Other, Tab, C, Escape, Digit0, Digit1, Digit2, Digit3 }
    public enum UiKeyAction { Unhandled, ShowMap, HideMap, FocusChest, ReleaseChest, ChooseChest0, ChooseChest1, ChooseChest2, SkipChest }

    /// <summary>Input conditions supplied by the presentation layer; this model never reads game state itself.</summary>
    public readonly struct UiInputContext
    {
        public readonly bool ActiveRun;
        public readonly bool Training;
        public readonly bool ResultsVisible;
        public readonly bool ChestVisible;
        public readonly bool Typing;
        public readonly bool OtherPanelOwnsFocus;

        public UiInputContext(bool activeRun, bool training, bool resultsVisible, bool chestVisible, bool typing, bool otherPanelOwnsFocus)
        {
            ActiveRun = activeRun;
            Training = training;
            ResultsVisible = resultsVisible;
            ChestVisible = chestVisible;
            Typing = typing;
            OtherPanelOwnsFocus = otherPanelOwnsFocus;
        }
    }

    /// <summary>Modifiers on a key press. Modified Tab remains browser focus navigation.</summary>
    public readonly struct UiKeyModifiers
    {
        public readonly bool Control, Meta, Alt, Shift, Repeat;
        public UiKeyModifiers(bool control = false, bool meta = false, bool alt = false, bool shift = false, bool repeat = false)
        { Control = control; Meta = meta; Alt = alt; Shift = shift; Repeat = repeat; }
        public bool Any { get { return Control || Meta || Alt || Shift; } }
    }

    /// <summary>
    /// Resolves local UI key ownership. Call on key-up and window blur even if UI visibility changed between events.
    /// The caller still submits every resulting gameplay choice through the ordinary input sender/server validation.
    /// </summary>
    public sealed class UiInputGate
    {
        public bool MapHeld { get; private set; }
        public bool ChestFocused { get; private set; }
        /// <summary>When true, Tab toggles map visibility and key-up leaves the chosen state in place.</summary>
        public bool MapToggle { get; set; }
        bool _togglePress;

        public UiKeyAction OpenMap(UiInputContext context)
        {
            if (!CanShowMap(context)) return UiKeyAction.Unhandled;
            if (MapHeld) return UiKeyAction.Unhandled;
            MapHeld = true;
            _togglePress = false;
            return UiKeyAction.ShowMap;
        }

        public UiKeyAction CloseMap()
        {
            if (!MapHeld) return UiKeyAction.Unhandled;
            MapHeld = false;
            _togglePress = false;
            return UiKeyAction.HideMap;
        }

        public UiKeyAction KeyDown(UiKey key, UiKeyModifiers modifiers, UiInputContext context)
        {
            if (key == UiKey.Tab)
            {
                if (modifiers.Repeat) return UiKeyAction.Unhandled;
                bool allowed = !modifiers.Any && !ChestFocused && CanShowMap(context);
                if (!allowed) return UiKeyAction.Unhandled;
                _togglePress = MapToggle;
                MapHeld = MapToggle ? !MapHeld : true;
                return MapHeld ? UiKeyAction.ShowMap : UiKeyAction.HideMap;
            }

            if (modifiers.Any || modifiers.Repeat) return UiKeyAction.Unhandled;
            if (key == UiKey.C && context.ChestVisible && !context.Typing && !context.OtherPanelOwnsFocus)
            {
                ChestFocused = !ChestFocused;
                if (ChestFocused) MapHeld = false;
                return ChestFocused ? UiKeyAction.FocusChest : UiKeyAction.ReleaseChest;
            }
            if (!ChestFocused || context.Typing || context.OtherPanelOwnsFocus) return UiKeyAction.Unhandled;
            if (key == UiKey.Escape)
            {
                ChestFocused = false;
                return UiKeyAction.ReleaseChest;
            }
            switch (key)
            {
                case UiKey.Digit1: ChestFocused = false; return UiKeyAction.ChooseChest0;
                case UiKey.Digit2: ChestFocused = false; return UiKeyAction.ChooseChest1;
                case UiKey.Digit3: ChestFocused = false; return UiKeyAction.ChooseChest2;
                case UiKey.Digit0: ChestFocused = false; return UiKeyAction.SkipChest;
                default: return UiKeyAction.Unhandled;
            }
        }

        public UiKeyAction KeyUp(UiKey key)
        {
            if (key == UiKey.Tab && _togglePress) { _togglePress = false; return UiKeyAction.Unhandled; }
            if (key != UiKey.Tab || !MapHeld) return UiKeyAction.Unhandled;
            MapHeld = false;
            return UiKeyAction.HideMap;
        }

        /// <summary>Releases momentary map state and chest keyboard ownership after focus/window loss.</summary>
        public void WindowBlur()
        {
            MapHeld = false;
            ChestFocused = false;
            _togglePress = false;
        }

        /// <summary>Hides the map when a later context change makes its hold ineligible.</summary>
        public UiKeyAction Reconcile(UiInputContext context)
        {
            bool allowed = context.ActiveRun && !context.Training && !context.ResultsVisible
                && !context.Typing && !context.OtherPanelOwnsFocus && !ChestFocused;
            if (MapHeld && !allowed)
            {
                MapHeld = false;
                return UiKeyAction.HideMap;
            }
            if (!context.ChestVisible || context.Typing || context.OtherPanelOwnsFocus) ChestFocused = false;
            return UiKeyAction.Unhandled;
        }

        bool CanShowMap(UiInputContext context)
        {
            return context.ActiveRun && !context.Training && !context.ResultsVisible && !context.Typing && !context.OtherPanelOwnsFocus;
        }
    }
}
