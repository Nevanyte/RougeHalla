# Training UI layout and interaction observations for the next gate

Source: `e0da2de0b5100d979901aa5e20cc3d8f964e0626`. This is a **proposed observation
checklist**, not a screenshot or visual PASS. Root chooses the frozen source and grants
the sole Editor worker an explicit test/preview scope. Do not change package, project
settings, production scene, art or audio to produce these observations. Preserve source,
background ticking, current input device/settings, preferences, focus and preview state.

## Resolution/text matrix

Capture the same console states at **1280×720** and **2560×1440**, each with default
text and **150% text**. Record actual viewport size, Canvas scale factor and effective
text scale for each image. Use the existing authorized capture path; an unsupported
resolution/capture state remains open. Do not label an analytical anchor calculation or
an offline mockup as a runtime screenshot.

The existing Canvas uses 1920×1080 reference and Scale With Screen Size, match 0.5.
At these matching-aspect viewports, expected screen bounds from the current anchors are:

| Element | 1280×720 bounds (left,bottom → right,top) | 2560×1440 bounds |
|---|---|---|
| Console root | `(19.2,129.6) → (614.4,633.6)` | `(38.4,259.2) → (1228.8,1267.2)` |
| Expanded panel | `(19.2,190.08) → (614.4,633.6)` | `(38.4,380.16) → (1228.8,1267.2)` |
| Collapsed CONSOLE control | `(19.2,129.6) → (209.664,180)` | `(38.4,259.2) → (419.328,360)` |

These values are source expectations; compare them to observed RectTransform/world-corner
bounds. The expanded console is a deliberate temporary overlay on the left. The normal
combat HUD's stat and health anchors remain top left and bottom left; the bottom-right
minimap and character scale are unchanged by this integration. Record expanded-console
overlap with the stat region honestly. The local character at screen center, Leave/header
controls and the lower-left health area should remain usable. Focused console controls
use the existing HUD visibility rules; do not confuse that input-owned state with the
ordinary pointer-open state after focus is released.

## Images and geometric checks

For each viewport/text combination retain these labeled observations:

1. **Collapsed verified Training:** practice/no-run-rewards copy, closed CONSOLE control,
   ordinary HUD positions and minimap. No console action panel or bank promise. The launcher
   is reachable by pointer and Tab. Arena and unconfirmed Welcome frames show no launcher.
2. **Pointer-open panel, top:** title and CLOSE, selected mob, Spawn camp, complete stacks
   field and Set stacks, card/copies choices. Check all labels at 150%, including the longest
   source mob/card labels. Decorations are click-through; viewport and controls receive
   pointer hits. Background transparency does not lower icon/text opacity.
3. **Focused stacks/keyboard reading:** complete `9007199254740991` text remains editable;
   invalid strings remain verbatim and cause no Train request. Tab/Shift-Tab cycle visible
   usable controls when a text field does not own the key. Arrow/Page/Home/End scrolling is
   limited to the selected reading pane; input caret navigation remains in the input field.
   There are no production dropdown controls in this leaf: mob/card/copies use cycle buttons.
   The additive popup regression checks shared input ownership with a real TMP dropdown.
4. **Bottom of scroll:** card description, chosen/random chest, Clear all, authority note
   and status are all reachable, readable and uncut. Scrollbar is optional; wheel and keyboard
   access must work. Long card explanations expand content and stay inside the viewport mask.
5. **Higher modal / focus loss:** opening Settings/Help/Build/Journal removes Training
   actions and does not send chest/world input from the same press. Closing a higher panel
   alone leaves the console unarmed until the next accepted Training fact. Blur closes it;
   background snapshots cannot rearm it. Regain alone keeps it closed/unarmed; a fresh accepted
   snapshot restores a closed launcher. Retain a state record if not every state needs an image.

Check text/body contrast over the visible world, unobscured action labels, gold keyboard
focus borders, clipping and active hit rectangles. Color must not be the only state cue.
Status distinguishes request sent/outcome unconfirmed from a server-applied result. A decoded
fixture may prove UI composition and command encoding; annotate that provenance. Only a
separate real server read/application observation can establish applied Training behavior.

## Input observations and one-run boundary

Bind actual public NUnit discovery to every proposed CLR method/typed tuple and unique
full name before executing the exact combined contract once. Preserve the old64 and leaf13
sets, all new wiring leaves, source/meta hashes and actual loaded Client/test module identity.
No selected-case arithmetic, earlier receipt or managed MVID substitutes for current native
discovery/load identity. Keep first failure records unchanged.

The interaction observation should explicitly cover:

- One physical Escape closes an open console, repeated reads of that update do nothing,
  and a later bare Escape can leave confirmed Training. Popup Hide and higher modal Escape
  take priority. No accidental attack/move/swap/potion/chest selection after a close transition.
- Pointer opening/changing a control releases pointer focus as designed. World movement
  is available on a later input update when no control owns keys. Focused text/buttons/popup
  keep game keys and tactical-map Tab from leaking. Arena Tab remains the map gesture.
- Spawn camp, stat stacks, card copies/remove, chosen chest, random chest and Clear all each
  emit the exact existing Train intent. Ordinary queued input before that intent remains in
  order when `FlushInput` sends all pending commands. Observe feedback as unconfirmed.
- Reconnect/new Welcome/source-clock cut, wrong mode, Leave/replacement and retained old
  button/input events cannot send into a retired binding or reuse cached confirmation.

Return the Editor to the exact frozen baseline and record restoration of temporary objects,
Canvas/EventSystem, registered URP lights, keyboard/device state, InputSettings identity and
flags, Tab/map preferences, focus, background/preview state and source hashes. No browser,
public admission, cloud, artwork or server-application campaign is authorized by this document.
