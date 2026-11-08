# Roguehalla WebGL shell

The Unity WebGL template lives at `client-unity/UnityProject/Assets/WebGLTemplates/Roguehalla/index.html`. Unity 6 fills its standard template variables at build time; the page has no remote fonts, images, scripts, or other network dependencies. The page shell uses CSS and text only, while the in-game splash remains controlled by Unity's Player Settings.

## Canvas and pixel budget

The canvas fills the viewport (`100vw` by `100vh`, with `100dvh` support), and Unity keeps the WebGL backbuffer matched to its CSS size. The configured pixel ratio is:

```js
Math.min(2, devicePixelRatio, Math.sqrt((2560 * 1440) / (innerWidth * innerHeight)))
```

This caps scaling at 2× and bounds the backbuffer to 3,686,400 pixels. At a 1280×720 CSS viewport and device pixel ratio 2, the expected backbuffer is 2560×1440. At larger viewport sizes the ratio decreases to stay within that area budget. The browser proof should verify the actual backbuffer dimensions with Unity diagnostics/profiling.

The canvas has no browser focus outline, and text selection is disabled while the game is running. The shell does not put a fullscreen button over gameplay controls; users can use the browser's fullscreen controls.

## Loading and errors

The local loading panel uses accessible status and progress roles. It is hidden with `display: none` after `createUnityInstance` succeeds, and the instance is exposed as `window.unityInstance` for browser QA. Startup failures leave an accessible, plain-language message in the panel and log the technical error to the browser console. The page does not use `alert`.
