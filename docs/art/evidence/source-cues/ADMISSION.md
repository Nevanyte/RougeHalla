# Source-cue admission

The lead admitted the bounded batch on `optimization_port` through `f16bca0d`. The six scoped commits were
cherry-picked with original commit references; the separate audio research `e81d70a4` was excluded and its ref retained.

| Original revision | Integrated revision | Scope |
|---|---|---|
| `4e51582b` | `3088e1a4` | Delivered prop distinctions and regressions |
| `8de29133` | `be32cbee` | Delivered persistent signature bits and regressions |
| `8b5958e6` | `8eb823b7` | Initial source handoff |
| `01ce403d` | `a8f47035` | No-network catalog preview selector and regressions |
| `04d8de08` | `a9a0a6c6` | Selector handoff |
| `f9a6c891` | `f16bca0d` | Actual compile/Editor evidence |

Root independently checked all nine raw artifact SHA256/byte counts, all31 source-manifest entries and all42 individual
passed test results/per-class counts. The summary SHA256 is
`64ab1b0c3b30aec62d772170be2ce2cc8d89afd7f20845e3bdaea9d67996bacb`.
The complete integrated `client-unity/UnityProject` tree is byte-identical to the tested source at `04d8de08`:

```sh
git diff --exit-code 04d8de08 f16bca0d -- client-unity/UnityProject
```

Independent source reviews found no blocking defect. Props/signatures consume delivered facts only, clear on removal/
reuse and preserve neutral unsupported fallbacks. The selector is confined to the preview bootstrap, uses catalog
clips/FPS and clears missing art; it creates no live session or gameplay inputs. The42 Editor passes comprise14 new
regressions and28 existing controls; they are not added to older overlapping suite counts.

This admission transfers the exact source/Editor result, not a new runtime result. Actual browser zero-socket behavior,
keyboard operation, rendered ground contact/text fit, live/crowded/CVD readability and the added actor renderers' cost
remain unmeasured. Synthetic test catalogs do not prove authored-asset coverage. The separate .NET/source-copy checks
were not rerun for this presentation-only batch. No new Web build, browser/profile/audio campaign or native144Hz result
is claimed. Served runtime `4f37e9f0` and its older native base remain unchanged; camp-stock and these new sources await
the next final-union client/public-flow Web batch. Rust/publication work retains priority.
