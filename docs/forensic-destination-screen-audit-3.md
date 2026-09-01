# Forensic Report: Destination Screen Diagnosis (Round 3)

**Date:** 2026-08-16
**Repo:** `D:\project\guardianangel` — branch `integration/full-merge`, HEAD `38d16da` ("Error correction"), clean working tree (3 untracked docs)
**Status:** Diagnosis only. Nothing modified, deleted, reset, stashed, or committed.

---

## Critical environment fact

This machine is **PRATYUSH** (user `SHARMA`). The cited paths
`C:\Users\VICTUS\Desktop\guardianangel\guardianangel` and `mobile/android/android/`
**do not exist here**. This machine has **no Android SDK, no adb, no Java, no Gradle,
no emulator, no AVD**, and **Metro is not running** (port 8081: silent). The Android
environment (where the emulator lives) is the VICTUS machine. All findings below come
from the repository present on this machine.

---

## 1. DUPLICATE SOURCE FILES FOUND

**None.** Exactly one copy of every relevant file in the entire repo (excluding
`node_modules`, `.git`, build dirs):

| File | Location | Tracked | Under mobile/src | Version |
|------|----------|---------|------------------|---------|
| `CreateRideDestinationScreen.tsx` | `mobile/src/ui/` | Yes | Yes | NEW |
| `MapScreen.tsx` | `mobile/src/ui/` | Yes | Yes | NEW |
| `LiveMapView.tsx` | `mobile/src/components/` | Yes | Yes | NEW |
| `JoinRideScreen.tsx` | `mobile/src/ui/` | Yes | Yes | NEW |
| `env.ts` | `mobile/src/config/` | Yes | Yes | NEW |
| `App.tsx` | `mobile/` | Yes | No | NEW |
| `index.js` | `mobile/` | Yes | No | NEW |
| `metro.config.js` | `mobile/` | Yes | No | default |
| `app.json` | `mobile/` | Yes | No | — |

No `react-native.config.js`, `index.android.js/ts`, or `index.android.tsx` exists.

## 2. OLD SOURCE LOCATIONS

- **`mobile/android/app/src/main/assets/index.android.bundle`** — the *only* file in the
  repo containing old markers. **Tracked**, committed exactly once (`a4f58a1`), never
  regenerated. Not under `mobile/src`; generated artifact. Contains `PRESET_DESTINATIONS`,
  Nagarkot/Kakani/Dhulikhel, `"Destination & Room Setup"`, `__DEV__=true`, and
  `_jsxFileName = C:\Users\VICTUS\...` (built on the VICTUS machine from an old tree).
- **Historical only:** commits `37d5523`, `a4f58a1`, and `origin/main` still hold old
  *source* in git history. Removed from working source by `38d16da`.

## 3. NEW SOURCE LOCATIONS

- `mobile/src/ui/CreateRideDestinationScreen.tsx` — `MapView`/`PROVIDER_GOOGLE`
  (lines 14, 426), `reverseGeocode` (74), Places `searchPlaces` (107, 119),
  `getPlaceDetails` (139), `handleMapPress` (257, 433). 860 lines.
- `mobile/src/components/LiveMapView.tsx` — `MapView`/`PROVIDER_GOOGLE` (3, 120).

## 4. IS `mobile/android/android` A DUPLICATE PROJECT?

**No — it does not exist** on this machine (`Test-Path` = False; absent from
`git ls-files`, `git log --all`, and a recursive directory scan). Nothing to do.

## 5. METRO ENTRY POINT

`package.json` has no `main` → RN falls back to **`mobile/index.js`** →
`import App from './App'` → `App.tsx:15-17` imports `./src/ui/CreateRideDestinationScreen`
(relative) → rendered at `App.tsx:447`.

No aliases anywhere (`tsconfig` no paths, `babel.config.js` only env injection,
`metro.config.js` empty defaults, no `main`/exports redirection, no npm workspaces).
Metro's own resolver (metro-resolver 0.84.4, verified with a live run) returns
**`D:\project\guardianangel\mobile\src\ui\CreateRideDestinationScreen.tsx`** — the NEW
file. Nothing points outside `mobile/src`.

## 6. IS METRO RUNNING?

**No.** Port 8081 is not listening; no Metro/node dev-server process. Confirmed on this machine.

## 7. DOES DEBUG USE METRO OR BUNDLED JS?

**Metro.** The RN 0.86 Gradle plugin registers the bundle task **only for non-debuggable
variants** (`TaskConfiguration.kt:65`); debug variants load JS live from a Metro dev
server whose IP/port are baked into the APK (`AgpConfiguratorUtils.kt:90-112`, default
8081). `app/build.gradle` has no `bundleIn*` flags and no custom sourceSets. The checked-in
`src/main/assets/index.android.bundle` is **never read by a debug build**, and release
builds regenerate it from source (this plugin version has no "reuse checked-in bundle"
fallback).

## 8. OLD/NEW CONTENT IN `index.android.bundle`

Exact grep counts:

```
OLD  Destination & Room Setup    : 1     NEW  searchPlaces    : 0
OLD  Nagarkot Scenic Viewpoint   : 1     NEW  getPlaceDetails : 0
OLD  Kakani Hill Station         : 1     NEW  PlacePrediction : 0
OLD  Dhulikhel Heights Viewpoint : 1     NEW  PROVIDER_GOOGLE : 0
OLD  PRESET_DESTINATIONS         : 3     NEW  MapView         : 0
                                         NEW  handleMapPress  : 0
                                         NEW  reverseGeocode  : 0
```

The bundle is **100% old implementation, zero new code** — a dev-mode bundle built on the
VICTUS machine from old source, committed once, never regenerated.

## 9. IS THE INSTALLED APK OLD?

**Cannot be proven from this machine** — no adb, no device/emulator here to query. What
the evidence shows: the emulator's JS must come from a build made on the VICTUS machine
that (a) predates commit `38d16da`, and (b) contains the old screen — matching exactly what
is seen on the emulator. No APK has ever been built in the repository present on this
machine (`mobile/android/app/build` does not exist).

## 10. MOST LIKELY ROOT CAUSE

**The emulator is running an APK (or a Metro session) built on the VICTUS machine from an
old source tree.** The repository is internally consistent: source = NEW, Metro resolves
NEW, zero duplicates, zero stale caches on this machine. The **only** old-code artifact in
the repo — the committed dev bundle — is ignored by RN 0.86 debug builds and regenerated
for release builds, so it cannot be what the debug emulator loads. The `_jsxFileName`
inside it (`C:\Users\VICTUS\Desktop\guardianangel\guardianangel\...`) is the literal path
of the build that produced the old UI.

### Case verdict

| Case | Verdict |
|------|---------|
| A. Duplicate old source, Metro resolves it | **Disproved** — no duplicates; resolver returns the new file |
| B. Source correct, stale Metro cache | **Disproved on this machine** — no Metro cache exists; Metro isn't running |
| C. Source correct, APK uses stale bundled JS | The only old artifact exists, but no RN 0.86 build consumes it — symptomatic, not causal |
| D. Emulator running an old APK | **True on the VICTUS machine** — the installed APK predates the new source |
| E. IDE builds from a different project dir | No alternate source on this machine. `guardianangel-safety` is an **empty shell** (0 files in `mobile/src`); `mobile/.git` is a leftover scaffold repo (`main` @ `4aaac99`, tracks only 52 scaffold files, no `src/`, no bundle) — inert for builds, but a footgun for git/IDE tooling |
| F. Something else | The **machine mismatch** — cited paths/emulator exist only on VICTUS, not on the machine under investigation |

## 11. EXACT NEXT STEPS TO FIX (on the machine with the emulator — NOT executed here)

1. On the VICTUS machine, get the checkout to `integration/full-merge` @ `38d16da`
   (the new source). **`git rm mobile/android/app/src/main/assets/index.android.bundle`**
   so the old code can never be packaged, and optionally remove the leftover
   `mobile/.git` scaffold repo if it confuses tooling.
2. `npx react-native start` (Metro on 8081), then `npx react-native run-android`.
   With a debug APK rebuilt against the new source, Metro serves the NEW screen.
3. If using a physical device, `adb reverse tcp:8081 tcp:8081`; a local emulator reaches
   host port 8081 directly.
4. Set a real `GOOGLE_MAPS_API_KEY` (currently `YOUR_GOOGLE_MAPS_API_KEY_HERE` in
   `local.properties`/`gradle.properties`) — otherwise the new map renders blank and
   Places/Geocoding are disabled by the source's API-key guard.

---

## Supporting evidence index

| Claim | Evidence |
|-------|----------|
| No duplicate source files | glob sweep of the entire repo + recursive directory scan |
| Old markers only in the bundle | repo-wide grep; `git grep HEAD` |
| Bundle is dev-mode, from VICTUS | `index.android.bundle:1` (`__DEV__=true`), `:86601` (`_jsxFileName`) |
| Bundle 100% old | marker counts in section 8 (all NEW markers = 0) |
| Bundle never regenerated | `git log --oneline -- mobile/android/app/src/main/assets/index.android.bundle` → only `a4f58a1` |
| Entry point = index.js → App.tsx | `package.json` (no `main`), `PathUtils.kt:72` fallback, `index.js`, `App.tsx:15-17,447` |
| Metro resolves the new file | `metro-resolver` 0.84.4 live resolution |
| Debug loads JS from Metro | `TaskConfiguration.kt:65`, `AgpConfiguratorUtils.kt:90-112` |
| No toolchain/emulator on this machine | no adb/java/gradle/SDK/AVD; port 8081 silent; `android/app/build` absent |
| No stale caches | `.metro`, `node_modules/.cache`, `android/.gradle`, `android/app/build` all absent |
| Nested scaffold repo `mobile/.git` | `git -C mobile` → `main` @ `4aaac99`, 52 tracked files, no `src/`, no bundle |
| `guardianangel-safety` is empty | `mobile/src` = 0 files; no `App.tsx`; no assets |
