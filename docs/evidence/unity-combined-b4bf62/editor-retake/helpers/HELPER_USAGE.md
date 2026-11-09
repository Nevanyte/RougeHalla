# b4bf62 drawer proof helper usage

External, unexecuted helper fragment for exact source `b4bf621d7ed285bb6af4eb737073e197450415df`. It is intended to be inserted before the existing `CapturePair` coroutine in the frozen f5 template.

- Add/keep the imports documented at the top of `drawer-proof-functions.cs.txt`; `UnityEditor.ShaderUtil.IsPassCompiled(Material, int)` is called fully qualified to record readiness only, without requesting compilation.
- In the mode-`drawer` setup, after the offline review has advanced/rendered and Build Details is still closed, call `OpenDrawerByRenderedHit()`. It requires the sorted EventSystem center hit to resolve to the actual BuildDetails Button and its Graphic depth to be nonnegative; it dispatches `ExecuteHierarchy<IPointerClickHandler>` and verifies drawer/header state.
- Keep the existing one initial drawer PNG capture. Immediately after that baseline image is written, `yield return VerifyDrawerAfterCapture();` in the same advancing review coroutine. The verifier takes no PNGs and stores its interaction/readiness receipt at `outputFolder/drawer-proof.json`.
- The verifier stops on its first failed check and writes a partial JSON receipt in `finally`; open failures also write a failure receipt before rethrowing. It uses public `BuildDrawer` properties, `Transform.Find`, EventSystem raycasts, Graphic/CanvasRenderer/ShaderUtil state, and public `ExecuteEvents` dispatch. It does not invoke Button callbacks directly, call ScrollRect.OnScroll, mutate scroll position, inspect private fields, or force shader compilation.

This fragment is a preparation artifact only. It has not been compiled or run and is not acceptance evidence. Parent review is required before any use.
