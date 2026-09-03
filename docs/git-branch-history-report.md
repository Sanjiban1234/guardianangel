# Guardian Angel Git Branch History

**Scope.** Read-only reconstruction performed 2026-09-02 (Asia/Kathmandu) from local refs, remote-tracking refs, reflogs, commit ancestry, merge commits, dangling objects, and a live `ls-remote --heads origin` comparison. No existing worktree file was edited during the reconstruction; this report and its companion visualization are documentation artifacts.

## 1. Executive Summary

The repository currently has **11 local branches** and **16 origin branches** (excluding `origin/HEAD`). The development line began at `2ed85e0` on 2026-07-14, progressed through `main`, and then entered two deliberately created integration lines:

1. `integration/full-merge`, created from `main` at `ef2c234` on 2026-08-13. It integrated telemetry, safety/backend, UI, background tracking, production, mapping, ride-lifecycle, and biometric work.
2. `integration/all-features`, created from `integration/full-merge` at `5bf8322` on 2026-09-01. It merged friends, weather, Guardian Portal, live-statistics/dead-end, and pause/rerouting feature tips, then received follow-up UI, Portal, AI, TTS, and presence/freshness work.

All current local branches are ancestors of the current V1 head; no local branch is unmerged from it. Two current remote-only feature branches remain non-ancestors of V1: `origin/pratyush/AI` (one unique commit) and `origin/feature/TTS` (two unique commits). Their functionality appears to have been adapted into `integration/all-features`, but Git does **not** prove a merge/cherry-pick equivalence.

Evidence labels: **[PROVEN]** direct ref/reflog/ancestry/merge evidence; **[RECONSTRUCTED]** strong graph-based inference; **[UNKNOWN]** metadata does not establish the fact.

## 2. Methodology and Git Limitations

Git records commit objects and movable refs, not a permanent database of branch creation and deletion. A ref's commit time is not its creation time. Creation times below are stated only where a reflog says `branch: Created from ...`; otherwise the report uses “first provable unique commit” and “probable fork/base.” A deleted branch can be named only when its old reflog/ref or a merge message still preserves that name. Dangling commits were checked, but they are mostly stashes, amended commits, and work-in-progress objects—not proof of deleted branches.

## 3. Current Branches

### Active local branches

| Branch | Tip | Tip subject | Relation to V1 |
|---|---|---|---|
| `backup/before-12f580a-sync` | `38d16da` | Error correction | ancestor |
| `backup/before-maps-merge` | `70c6b58` | Android Railway SSL config | ancestor |
| `feature/friends` | `92b2ccf` | friends socket-delivery tests | ancestor |
| `feature/guardian-portal` | `77f444e` | Guardian Portal live sharing | ancestor |
| `feature/weather-safety` | `adf81b0` | ride-aware weather safety | ancestor |
| `integration/all-features` | `8e997d3` | separate portal presence/location freshness | current |
| `integration/full-merge` | `5bf8322` | ride-summary telemetry/route visualization | ancestor |
| `main` | `ef2c234` | PR #7, `radium/ui` | ancestor |
| `pratyush/safety2` | `2252e73` | Backend Changes | ancestor |
| `radium/ui` | `7ca5fc0` | UI safety features | ancestor |
| `sanjiban/backend` | `1dbe2fb` | mobile sensor/closure fix | ancestor |

### Active origin branches

`feature/TTS`, `feature/background-ride-tracking`, `feature/friends`, `feature/guardian-portal`, `feature/live-stats-deadend`, `feature/pause-rerouting`, `feature/weather-safety`, `integration/all-features`, `integration/full-merge`, `main`, `pratyush/AI`, `pratyush/mobile-scaffold`, `pratyush/safety2`, `radium/ui`, `sanjiban/backend`, and `utsuk/telementry`. `origin/HEAD -> origin/main` is a symbolic default pointer, not a development branch. The `origin` listing was confirmed against `git ls-remote --heads origin`; no stale remote-tracking branch was found.

## 4. Complete Branch Lifecycle Table

| Branch | Local/Remote/Historical | Probable parent/base | First provable unique commit | Last known tip | Lifecycle / merged into | Integration evidence | Deletion evidence | Confidence |
|---|---|---|---|---|---|---|---|---|
| `main` | local + origin | initial lineage | `4dd9624` (2026-07-14) | `ef2c234` | MERGED AND STILL PRESENT → both integrations | base of `integration/full-merge` proven by reflog | none | HIGH |
| `pratyush/mobile-scaffold` | origin | `2ed85e0` | `6c71ac3` | `6c71ac3` | MERGED AND STILL PRESENT | tip ancestor of V1 | none | HIGH |
| `pratyush/safety` | historical | `4dd9624` | `6cc143c` or `1e7aacc` | same ambiguous PR #1 parent | MERGED AND DELETED | PR #1 merge commits `cbc8300` and `e51c5ed` | name only in merge subjects; deletion date unknown | MEDIUM |
| `sanjiban/weather` | historical | `cbc8300` | `14a2ba1` | `14a2ba1` | MERGED AND DELETED | PR #5 merge `88d022b` | name only in merge subject; deletion date unknown | MEDIUM |
| `radium/ui` | local + origin | `main` / `140eab1` checkout ref | `7ca5fc0` local; remote advanced to `37d5523` | local `7ca5fc0`, origin `37d5523` | MERGED AND STILL PRESENT → full merge | `ef2c234` into main; `3c0cf42` remote tip into full merge | none | HIGH |
| `pratyush/safety2` | local + origin | `main` at `ef2c234` (merged into branch) | `48a1853` lineage | `2252e73` | MERGED AND STILL PRESENT → full merge | `eee0c21`; reflog proves local branch from remote | none | HIGH |
| `sanjiban/backend` | local + origin | early main/backend lineage | `615513b` reachable lineage | `1dbe2fb` | MERGED AND STILL PRESENT → full merge | `539e731` | none | HIGH |
| `utsuk/telementry` | origin | `main` at `ef2c234` | `1f8b054` | `1f8b054` | MERGED AND STILL PRESENT → full merge | reflog: merge was fast-forward; commit is a merge object | none | HIGH |
| `integration/full-merge` | local + origin | `main` at `ef2c234` | `1f8b054` | `5bf8322` | MERGED AND STILL PRESENT → all-features base | creation reflog; ancestry | none | HIGH |
| backup branches (2) | local | `integration/full-merge` | n/a; point-in-time backups | `70c6b58`, `38d16da` | ACTIVE refs, both ancestors of V1 | creation reflogs | none | HIGH |
| `feature/background-ride-tracking` | origin | full-merge at `a8ae0a2` | `82f8028` | `82f8028` | MERGED AND STILL PRESENT → full merge | `cd278f1` | none | HIGH |
| `feature/guardian-portal` | local + origin | full-merge `5bf8322` | `77f444e` | `77f444e` | MERGED AND STILL PRESENT → all-features | creation reflog; `5d514c0` | none | HIGH |
| `feature/weather-safety` | local + origin | full-merge `5bf8322` | `adf81b0` | `adf81b0` | MERGED AND STILL PRESENT → all-features | creation reflog; `f762fc5` | none | HIGH |
| `feature/friends` | local + origin | full-merge `5bf8322` | `bb67638` | `92b2ccf` | MERGED AND STILL PRESENT → all-features | creation reflog; `7ab9688` | none | HIGH |
| `feature/live-stats-deadend` | origin | full-merge `5bf8322` | `7693de7` | `7693de7` | MERGED AND STILL PRESENT → all-features | `b00c74e` | none | HIGH |
| `feature/pause-rerouting` | origin | full-merge `5bf8322` | `fe33c6f` | `983a433` | MERGED AND STILL PRESENT → all-features | `73306d7` | none | HIGH |
| `pratyush/AI` | origin | full-merge `6df9394` | `c832db9` | `c832db9` | UNMERGED AND STILL PRESENT | V1 has `afe7598`, but no ancestry proof | none | HIGH (status); LOW (functional relation) |
| `feature/TTS` | origin | AI tip `c832db9` | `3cfa91e` | `3cfa91e` | UNMERGED AND STILL PRESENT | V1 has `231beac`/`0380d98`, but no ancestry proof | none | HIGH (status); LOW (functional relation) |
| `integration/all-features` | local + origin | full-merge `5bf8322` | merge `7ab9688` | `8e997d3` | ACTIVE / current V1 | creation reflog | none | HIGH |

## 5. Chronological Repository Evolution

**2026-07-14 — Initial structure.** [PROVEN] `2ed85e0` established the mobile/backend/contracts/docs skeleton; `6c71ac3` added the mobile scaffold; `4dd9624` added React.

**2026-07-15 to 2026-08-02 — Main and safety/backend development.** [PROVEN] PR #1 merged historical `pratyush/safety`; backend, weather, UI, telemetry, crash detection, and safety work followed. `main` merged weather (`88d022b`), backend (`023394f`), and UI (`ef2c234`). `pratyush/safety2` was merged into `sanjiban/backend` (`98eb362`).

**2026-08-13 to 2026-08-30 — Full integration.** [PROVEN] `integration/full-merge` was created from `main`, fast-forwarded telemetry, and true-merged `pratyush/safety2`, `radium/ui`, and `sanjiban/backend`. It then consolidated production/Railway, maps, ride lifecycle, background tracking, security, biometrics, and ride-summary work.

**2026-08-30 to 2026-09-02 — All-features consolidation and stabilization.** [PROVEN] `integration/all-features` forked at `5bf8322`, merged five feature tips, then added reconciliation, pause fixes, AI-route adaptation, Portal deployment/location fixes, weather/HUD mapping, temporary socket diagnostics, TTS integration/voice alerts, and the final presence/freshness separation.

## 6. Feature Integration Timeline

| Date (+05:45) | Source | Destination | Type | Commit | Evidence-supported feature |
|---|---|---|---|---|---|
| 2026-07-15 | `pratyush/safety` | early main | merge commit | `cbc8300` / `e51c5ed` | safety PR #1 |
| 2026-07-28 | `sanjiban/weather` | main | merge commit | `88d022b` | weather endpoint |
| 2026-07-28 | `sanjiban/backend` | main | merge commit | `023394f` | backend PR #6 |
| 2026-07-28 | `radium/ui` | main | merge commit | `ef2c234` | Guardian Angel ride UI |
| 2026-08-13 | `utsuk/telementry` | full-merge | fast-forward | `1f8b054` | telemetry upload |
| 2026-08-13 | safety2/UI/backend | full-merge | 3 merge commits | `eee0c21`, `3c0cf42`, `539e731` | safety, UI, backend integration |
| 2026-08-23 | background tracking | full-merge | merge commit | `cd278f1` | Android background ride tracking |
| 2026-09-01 | friends/weather/Portal/live stats/pause | all-features | 5 merge commits | `7ab9688`..`73306d7` | listed feature set |
| 2026-09-01–02 | AI/TTS/Portal/weather | all-features | manual adaptation / unknown | `afe7598`, `231beac`, `0380d98`, `e4ffb80`, `9fa9207` | see §10; ancestry does not prove source integration |

## 7. Merge and Fast-Forward History

There are **18 reachable true merge commits** excluding the stash merge object. Relevant integration merges are the 18 commits beginning with `cbc8300`, `e51c5ed`, `af06981`, `88d022b`, `023394f`, `ef2c234`, `1707bcf`, `98eb362`, `1f8b054`, `eee0c21`, `3c0cf42`, `539e731`, `cd278f1`, `7ab9688`, `f762fc5`, `5d514c0`, `b00c74e`, and `73306d7`.

**[PROVEN] Fast-forward integrations: 3.** Reflogs record: telemetry into full-merge (2026-08-13); `pull --ff-only origin integration/full-merge` (2026-08-16); and `pull --ff-only origin integration/all-features` (2026-09-02). The latter two are branch synchronizations, not source-feature merge operations. No merge commit was generated for them.

## 8. Deleted / Historical Branches

Only two deleted names are reconstructable: `pratyush/safety` and `sanjiban/weather`. Their names and integration are preserved by merge subjects, and their parent commits are reachable. No ref/reflog survives to establish their exact branch creation or deletion dates. There is **no evidence that either current local or current origin branch was deleted**. Dangling objects include stashes and amended commits (for example `31f8517`, `3a8e013`, `672254f`) but do not establish deleted branch refs.

## 9. Diverged / Unmerged Branches

`origin/pratyush/AI...integration/all-features` has **1 left-only / 34 right-only** commits, base `6df9394`; `origin/feature/TTS...integration/all-features` has **2 / 34**, same base. They are the only active refs not ancestors of V1. Commit subjects make conceptual overlap plausible, but [UNKNOWN] whether integration used cherry-picks, manual adaptation, or independent implementation. `radium/ui` local is one commit behind origin, but both tips are ancestors of V1.

## 10. integration/all-features Evolution

**[PROVEN]** Created from `5bf8322` at 2026-09-01 10:05:29. It sequentially true-merged friends (`7ab9688`), weather (`f762fc5`), Portal (`5d514c0`), live statistics/dead-end tracking (`b00c74e`), and pause/rerouting (`73306d7`). Follow-up commits prove ride reconciliation, pause control work, Portal Vercel/location repair, UX/weather-map refinement, diagnostics, weather voice alerts, and final Portal presence/location-freshness separation. AI and TTS branch ancestry is not in this line; only the resulting all-features commits are proven.

## 11. Current Branch Topology

```text
main (ef2c234)
  └─ integration/full-merge (5bf8322)
       ├─ background-tracking [merged]
       ├─ guardian-portal / weather-safety / friends [merged]
       └─ integration/all-features (8e997d3, V1)
            ├─ live-stats-deadend [merged]
            ├─ pause-rerouting [merged]
            ├─ origin/pratyush/AI [diverged; not ancestor]
            └─ origin/feature/TTS [diverged; not ancestor]
```

## 12. Condensed Git Graph

```text
8e997d3 all-features V1
* 73306d7 merge pause-rerouting
*  b00c74e merge live-stats/dead-end
*   5d514c0 merge Guardian Portal
*    f762fc5 merge weather safety
*     7ab9688 merge friends
* 5bf8322 full-merge
*  cd278f1 merge background tracking
*   539e731 / 3c0cf42 / eee0c21 merge backend/UI/safety2
* 1f8b054 telemetry (fast-forward integration)
* ef2c234 main ← radium/ui PR #7
* 6c71ac3 mobile scaffold
* 2ed85e0 initial skeleton
```

## 13. Current V1 HEAD

`integration/all-features` at **`8e997d31575bd52ae79d2f4616ea806f289613d0`** — 2026-09-02 20:33:31 +05:45 — `fix: separate portal presence from location freshness`.

## 14. Evidence Confidence / Known Gaps

* [PROVEN] Current refs, tips, ancestry, true merges, branch creation events listed in reflogs, and three explicit fast-forward reflog events.
* [RECONSTRUCTED] Historical `pratyush/safety` and `sanjiban/weather` lifecycle: both names survive only in merge subjects.
* [UNKNOWN] Exact creation/deletion times for historical branches; any deleted remote branch whose ref and reflog are gone; and whether AI/TTS functionality was cherry-picked or manually adapted into V1.
* Current status is expected to include the pre-existing modified `.gitignore` and the untracked history documentation artifacts until reviewed; none is staged or committed.
