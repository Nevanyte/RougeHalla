# Official package API pin only

Source: d6603a82db1d8285d708afc85be576b39e5e22cc. Existing Unity 6000.0.85f2 Editor 9075 ran the sole authorized nonblocking `UnityEditor.PackageManager.Client.Add("com.unity.nuget.newtonsoft-json@3.2.2")` request. It returned Success, exact name/version and Registry source. No manifest or lock file was hand-edited.

The API added the direct manifest dependency and changed only that same package's lock depth from 1 to 0; the already-resolved version stayed 3.2.2. No unrelated dependency drift. Combined import/compile completed with no errors. This is a package-operation receipt, not test acceptance: the subsequent actual EditMode run had 82 total / 71 passed / 11 failed and its failure evidence is retained separately.
