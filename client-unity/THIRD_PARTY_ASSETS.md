# Unity client asset provenance

Arena, actor, prop, status and projectile geometry is project-authored procedural code under the project MIT license.
No external character/environment artwork was added for the first playable build.

`UnityProject/Assets/TextMesh Pro/` was imported non-interactively from the TMP Essential Resources package bundled
with the pinned `com.unity.ugui`2.0.0 package in Unity6000.0.85f2. Unity resources retain the package’s
[Unity Companion notice](UnityProject/Assets/TextMesh%20Pro/License.Unity.md); they are not relicensed as MIT.
Liberation Sans and its derived SDF font retain the bundled
[SIL Open Font License](UnityProject/Assets/TextMesh%20Pro/Fonts/LiberationSans%20-%20OFL.txt).

The imported TMP essentials also include the EmojiOne sample sprite atlas and its
[upstream attribution](UnityProject/Assets/TextMesh%20Pro/Sprites/EmojiOne%20Attribution.txt), preserved with the assets.
The Web distribution includes the project license, Unity notice, font license and EmojiOne attribution in `Licenses/`.

The package lock pins the tooling dependencies. The broader dependency/asset audit remains P-OSS-2; these notices
record the assets actually added for this milestone.
