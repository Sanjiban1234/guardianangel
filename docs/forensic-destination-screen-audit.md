# Forensic Audit: Destination Screen Source-Resolution Problem

**Date:** 2026-08-16
**Scope:** `mobile/` tree on branch `integration/full-merge`, HEAD `38d16da` ("Error correction")
**Status:** Diagnosis only. No files deleted, no builds/caches touched.

---

## ROOT CAUSE

**The current repository is internally consistent and correct. The old destination
screen does NOT exist in any current source file. It exists only inside one committed
stale artifact — `mobile/android/app/src/main/assets/index.android.bundle` — and in the
APK that is currently installed on the device, which was built from an older source tree
on a different machine.**

Classification against the candidate scenarios:

| Scenario | Verdict |
|----------|---------|
| A. Current source is old | **NO** — HEAD source is the new Maps implementation |
| B. Source new, Metro resolves old | **NO** — Metro's own resolver returns the single new file |
| C. Source new, Metro resolves new, bundle stale | **YES** — the committed bundle is stale (old code, dev-mode, built on another machine) |
| D. Duplicate project/source root | **NO** — no duplicate directories exist |
| E. Something else | **YES (partial)** — the device is running an APK (or a Metro server) built from the OLD source tree at `C:\Users\VICTUS\Desktop\guardianangel\guardianangel\`, i.e. **not from this repository at all** |

The evidence is unambiguous: the stale bundle embeds its build-time source path as
`C:\Users\VICTUS\Desktop\guardianangel\guardianangel\mobile\src\ui\CreateRideDestinationScreen.tsx`
(`index.android.bundle:86601`). That path does not exist on this machine. The new Maps
implementation was introduced in source by HEAD commit `38d16da`, which rewrote
`CreateRideDestinationScreen.tsx` (+914 lines) but **never regenerated the committed bundle**.

---

## OLD IMPLEMENTATIONS FOUND

### Source files (tracked, current HEAD)
**None.** `git grep` of HEAD finds the old strings only in the bundle:

```
git grep -n "Nagarkot|Kakani Hill|Dhulikhel" HEAD -- mobile
> HEAD:mobile/android/app/src/main/assets/index.android.bundle:86617 ...
> HEAD:mobile/android/app/src/main/assets/index.android.bundle:86622 ...
> HEAD:mobile/android/app/src/main/assets/index.android.bundle:86627 ...
(no source file matches)
```

### Historical source (removed from current source)
| Location | Kind | Status |
|----------|------|--------|
| `37d5523:mobile/src/ui/CreateRideDestinationScreen.tsx` | Source (introduced `PRESET_DESTINATIONS`) | Historical, old |
| `a4f58a1:mobile/src/ui/CreateRideDestinationScreen.tsx` | Source (still contained `PRESET_DESTINATIONS`) | Historical, old |
| `origin/main:mobile/src/ui/CreateRideDestinationScreen.tsx` | Source on another branch | Still old |
| `38d16da` (HEAD) | Commit that removed the presets from source | New source |

`git log --all -S "PRESET_DESTINATIONS" -- mobile/src/ui/CreateRideDestinationScreen.tsx`
confirms: introduced in `37d5523`, removed in `38d16da`.

### Generated / committed artifact (tracked, current HEAD)
| File | Kind | Contains |
|------|------|----------|
| `mobile/android/app/src/main/assets/index.android.bundle` | Dev-mode Metro JS bundle, committed only in `a4f58a1`, never regenerated | `PRESET_DESTINATIONS` with Nagarkot/Kakani/Dhulikhel (`:86616`), `"Destination & Room Setup"` (`:86752`), `_jsxFileName` pointing to the VICTUS machine path (`:86601`), `__DEV__=true` header (`:1`) |

Nothing imports or references this asset from JS source. It is a build-time asset only
(see ANDROID BUNDLE SOURCE).

---

## NEW IMPLEMENTATIONS FOUND

| File | Role |
|------|------|
| `mobile/src/ui/CreateRideDestinationScreen.tsx` | **The only** destination screen. Contains `MapView`, `PROVIDER_GOOGLE`, `Marker` (line 14, 426), `searchPlaces()` (line 107), `getPlaceDetails()` (line 139), Places Autocomplete, `handleMapPress` reverse geocoding. 860 lines. |
| `mobile/src/components/LiveMapView.tsx` | `MapView` / `PROVIDER_GOOGLE` usage (line 3, 120). Companion map component. |
| `mobile/App.tsx` | Imports and renders `CreateRideDestinationScreen` (lines 15–17, 446–455). |

Only one `CreateRideDestinationScreen` file exists in the entire repository
(tracked + untracked, excluding `node_modules`). There are no duplicate files.

---

## ACTUAL IMPORT PATH

Verified from source (no navigation library involved — plain state-based screen switching):

```
mobile/index.js                     (entry; package.json has no "main", falls back to index.js)
  └── import App from './App'
        └── mobile/App.tsx:15
              import CreateRideDestinationScreen, { CreatedRoomData }
              from './src/ui/CreateRideDestinationScreen';        <- relative import
        └── mobile/App.tsx:446-455
              {screen === 'create_destination' && (
                <CreateRideDestinationScreen ... />
              )}
                    │
                    ▼
        mobile/src/ui/CreateRideDestinationScreen.tsx   (the NEW Maps file)
```

`App.tsx:17` is a **relative** import (`./src/ui/CreateRideDestinationScreen`), so Metro
resolves it strictly relative to `mobile/`. No aliases, no `paths`, no `extraNodeModules`,
no `haste` — nothing can redirect it.

---

## METRO RESOLUTION

Metro's own resolver (`metro-resolver` 0.84.4 from this project's `node_modules`) was run
against the exact import in `App.tsx`:

```
resolve(context, './src/ui/CreateRideDestinationScreen', 'android')
  => { "type": "sourceFile",
       "filePath": "D:\\project\\guardianangel\\mobile\\src\\ui\\CreateRideDestinationScreen.tsx" }
```

**Metro resolves the NEW Maps implementation.** There is no other candidate on disk, so
no configuration change could make it pick anything else.

Configuration check (all default / inert):
- `metro.config.js` — empty defaults (`mergeConfig(getDefaultConfig(__dirname), {})`); no `resolver`, `watchFolders`, or `projectRoot` overrides.
- `babel.config.js` — only injects `API_BASE_URL` / `GOOGLE_MAPS_API_KEY` at build time; no module mapping.
- `tsconfig.json` — no `paths` (and TypeScript path aliases do not affect Metro anyway).
- `package.json` — no `"main"` field; RN Gradle plugin falls back to `index.js` (`PathUtils.kt:72`).
- Only one `App.tsx`, one `index.js`, one `CreateRideDestinationScreen.tsx` in the repo.

---

## ANDROID BUNDLE SOURCE

Verified against the RN 0.86 Gradle plugin (`@react-native/gradle-plugin` in `node_modules`):

1. **Debug builds do NOT bundle JS.** `TaskConfiguration.kt:65` registers the
   `createBundle*JsAndAssets` task only `if (!isDebuggableVariant)`. Debug variants
   (default `debuggableVariants = [debug, debugOptimized]`) instead load JS at runtime
   from a Metro dev server whose IP/port is baked into the APK
   (`AgpConfiguratorUtils.kt:90-112` — build machine's LAN IP, default port `8081`).
   `app/src/main/assets/index.android.bundle` is **never read** in a debug build.
2. **Release builds regenerate the bundle from current source** into
   `android/app/build/generated/assets/react/release/index.android.bundle`
   (`TaskConfiguration.kt:29-90`) via Metro + Hermes. The RN 0.86 plugin contains
   **no "use the pre-existing checked-in bundle" fallback** — unlike very old RN
   versions, this one always regenerates.
3. The checked-in `app/src/main/assets/index.android.bundle` is therefore **orphaned**:
   it is a dev-mode (`__DEV__=true`), plain-JS bundle, 5.35 MB, committed once in
   `a4f58a1`. It is ignored by debug builds, bypassed/overwritten by release builds,
   and only its presence as a static asset is harmless duplication in the APK's asset
   folder.

Conclusion: the APK on the device cannot have obtained its old UI from any bundle that a
build of **this repository** would produce. It came from an APK built on the VICTUS
machine (old source tree, old bundle) — or from a Metro server still running from that
old tree.

---

## DUPLICATE DIRECTORIES

| Path | Exists? | Matters? |
|------|---------|----------|
| `mobile/mobile` | No | — |
| `mobile/android/android` | **No** (`Test-Path` = False) | The directory you were told about does **not** exist on this filesystem, and appears nowhere in git history or tracked files |
| `mobile/android/build`, `mobile/android/app/build` | No | No local Gradle build has ever run here |
| Backup folders (`.backup`, `.old`, `.tmp`, `backup`, `old`, nested `mobile`, `src`, `ui`) | None found | — |

The only duplicate-looking thing in the repo is the stale committed bundle, which is an
artifact, not a source root.

---

## GIT STATUS

```
Branch      : integration/full-merge
HEAD        : 38d16da6b3a3a938e55d8db03295d25e6cc6da6c ("Error correction")
Remote      : up to date with origin/integration/full-merge
Remote URL  : https://github.com/Sanjiban1234/guardianangel.git
Modified    : none
Untracked   : docs/communication-audit-report.md   (unrelated audit doc; no destination-screen content)
```

Branches present: `integration/full-merge` (HEAD, new source), `main` + `origin/main`
(old source still contains `PRESET_DESTINATIONS`), `pratyush/*`, `origin/radium/ui`,
`origin/sanjiban/backend`, `origin/utsuk/telementry`.

Bundle lineage: `index.android.bundle` was added in `a4f58a1` and has **never been
modified since** — it is older than the new Maps source in `38d16da`.

---

## SAFE FIX

The minimum safe fix, in order:

1. **Rebuild and reinstall from this repository.**
   - Start Metro from `mobile/`: `npx react-native start`
   - Run the app from `mobile/`: `npx react-native run-android`
   - Ensure the device reaches **this machine's** Metro. The old APK has the VICTUS
     machine's LAN IP baked in; if you build locally, either build a fresh APK (as
     above) or run `adb reverse tcp:8081 tcp:8081` on a machine with adb installed.
   - This alone produces the NEW Maps screen — the source and Metro resolution are correct.
2. **Delete the stale committed bundle** so the old code can never be packaged again:
   - `git rm mobile/android/app/src/main/assets/index.android.bundle`
   - It is a dev-mode artifact that no RN 0.86 build consumes. Debug builds ignore it,
     release builds regenerate it. Removing it has zero effect on building or running.
3. **(Optional) purge the old branch copies** (`main`, `radium/ui`) or rebase them so the
   old `PRESET_DESTINATIONS` source cannot be accidentally remerged later.

No caches need clearing and no Metro config changes are required — this was never a
cache or resolution problem in this repository.

---

### Evidence index

| Claim | Evidence |
|-------|----------|
| Old strings only in bundle | `git grep` HEAD; grep of working tree |
| Bundle is dev-mode, from VICTUS machine | `index.android.bundle:1` (`__DEV__=true`), `:86601` (`_jsxFileName`) |
| Bundle contains old screen | `:86616-86631` (`PRESET_DESTINATIONS`), `:86752` (`"Destination & Room Setup"`) |
| Bundle never regenerated | `git log --oneline -- mobile/android/app/src/main/assets/index.android.bundle` → only `a4f58a1` |
| New source is the Maps impl | `CreateRideDestinationScreen.tsx:14,107,139,426` |
| App imports only the new file | `App.tsx:15-17,446-455` |
| Metro resolves the new file | `metro-resolver` 0.84.4 live resolution |
| Debug never reads the asset | `TaskConfiguration.kt:65`, `AgpConfiguratorUtils.kt:90-112` |
| Release regenerates from source | `TaskConfiguration.kt:29-90` |
| No duplicate roots | `Test-Path` + recursive dir scan + `git ls-files` + `git log --all` |
