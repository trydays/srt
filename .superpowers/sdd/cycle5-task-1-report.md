# Cycle 5 Task 1 Report — Keyframes, flat group contract and persistence

## Status

DONE

Task 1 is implemented and committed locally on `feature/subtitle-export-cycle0` from base
`671f16d093f25b7b76e0fa78d469c84041d36441`.

Code/test commit:

- `2378ef2` — `feat: add shared keyframe and visual group contracts`

No push was performed. The concurrently modified Cycle 5 plan file was not staged or included
in the Task 1 commit.

## Scope delivered

- Added the UMD `SRTKeyframes` contract with strict scalar/keyframe normalization, the frozen
  three-easing vocabulary (`linear`, `ease-out`, `back-out`), deterministic pure sampling,
  final domain clamping, and controlled FFmpeg-native expression generation from the same
  easing definitions.
- Added the UMD `SRTVisualGroup` contract with strict flat shape/text child normalization,
  canonical defaults, group-relative opacity/scale sampling, exact integer pivot geometry,
  and scratch-surface flattening followed by one destination `drawImage` with group opacity.
- Added `matchesParameterSchema(schema, value)` for the existing scalar forms plus only the
  required enum, strict object, bounded array, and `oneOf` forms. The data-only descriptor walk
  runs before nested values are examined.
- Added `createGroupRegistration()` for `visual.group@1` /
  `visual.group.layer@1`, with append mode and `visualOverlay` stage. Its six adapters consume
  or produce canonical group payloads; preview evaluates group-relative opacity and scale.
- Kept `visual.group@1` out of the default capability registration list and default prompt
  catalog. It is available only when a caller explicitly builds a custom registry.
- Added strict render-recipe acceptance for canonical, complete group payloads and recursive
  freezing. Incomplete defaults, incomplete child params, missing canonical easing, and extra
  fields are rejected.
- Verified generic ProjectEditing persistence, refresh, one-transaction undo, and byte-exact
  atomic failure when a later group exceeds its normalized range.
- Verified graph routing keeps groups ordered by edit order and before subtitles.

Exporter execution and desktop/browser preview wiring were intentionally not changed; those
remain later Cycle 5 tasks.

## TDD evidence

### Review follow-up: sparse keyframe slots

The Cycle 5 review found that `Array.prototype.map()` skipped an absent first slot in a
two-element keyframe array. `normalize()` therefore returned a sparse canonical value instead
of throwing `KEYFRAMES_INVALID`, leaving `valueAt()` to fail later with an ordinary
`TypeError`.

RED command:

```sh
node --test tests/keyframes.test.js
```

Observed result before the production change: exit 1, 6 passed / 1 failed. The direct public
`normalize()` regression failed with `Missing expected exception`.

GREEN command:

```sh
node --test tests/keyframes.test.js tests/visual-group.test.js
```

Observed result after the production change: exit 0, **12/12 passed**. `normalize()` now checks
that every keyframe array index is an own property before mapping; no other validation or API
behavior was changed.

### Initial RED

Command:

```sh
node --test tests/keyframes.test.js tests/visual-group.test.js tests/project-editing.test.js
```

Observed result: exit 1, 21 passed / 4 failed. Failures were the expected missing features:

- `Cannot find module '../src/keyframes'`
- `Cannot find module '../src/visual-group'`
- both ProjectEditing group tests failed because `createGroupRegistration` did not exist

### Focused RED/GREEN iterations

1. Keyframes GREEN:

   ```sh
   node --test tests/keyframes.test.js
   ```

   Result: 6/6 passed.

2. Visual group GREEN:

   ```sh
   node --test tests/visual-group.test.js
   ```

   Result: 5/5 passed.

3. Registry/schema RED:

   ```sh
   node --test tests/edit-capabilities.test.js
   ```

   Result before implementation: 13 passed / 4 failed, all for the missing group factory or
   schema matcher.

4. Registry/schema GREEN:

   ```sh
   node --test tests/edit-capabilities.test.js
   ```

   Result: 17/17 passed.

5. Project persistence GREEN:

   ```sh
   node --test tests/project-editing.test.js
   ```

   Result: 23/23 passed.

6. Graph/render-recipe RED:

   ```sh
   node --test tests/render-graph.test.js tests/render-recipe.test.js
   ```

   Result before render-recipe support: 22 passed / 2 failed with the expected
   `EXPORT_UNSUPPORTED_OPERATION` for `visual.group@1`.

7. Graph/render-recipe GREEN:

   ```sh
   node --test tests/render-graph.test.js tests/render-recipe.test.js
   ```

   Result: 24/24 passed.

8. Combined focused GREEN:

   ```sh
   node --test tests/keyframes.test.js tests/visual-group.test.js \
     tests/edit-capabilities.test.js tests/project-editing.test.js \
     tests/render-graph.test.js tests/render-recipe.test.js
   ```

   Result: 75/75 passed.

## Full real-enabled Node verification

Authoritative command (run outside the filesystem/network sandbox so the existing loopback
server tests can bind):

```sh
env -u FORCE_COLOR -u NO_COLOR \
  SRT_REAL_EXPORT=1 \
  SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
  SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe \
  npm test
```

Result: exit 0, **302/302 passed**, 0 failed, 0 skipped. This includes the existing real color,
static-layer, subtitle, and transform media exports.

An earlier harness attempt used `/opt/homebrew/bin/ffmpeg`, which is a different Homebrew build
without the required libass filters. Outside the sandbox that misconfigured run reached 298/302
and failed only the four existing text/subtitle real-export cases. No product change was made in
response; rerunning with the project-approved `ffmpeg-full` paths produced the authoritative
302/302 pass above. A first sandboxed attempt additionally showed expected loopback `EPERM`
failures, which disappeared outside the sandbox.

## Boundary coverage

- Duplicate, descending/negative, non-finite, and non-zero-first keyframe times.
- Unknown easing and fields, wrong scalar types, domain violations, 1 frame and 17 frames.
- Explicit `null`/`undefined` unknown duration behavior, invalid known durations, and animation
  overflow against explicit and default whole-video ranges.
- Numeric checks for all three easings, destination-easing semantics, held last value,
  reversed sampling order, and opacity/scale domain caps.
- FFmpeg expression segment comparisons, `pow` use, and fixed back-out coefficients.
- Empty/17-child groups, nested groups, child-owned range/animation, executable/unknown fields,
  own `constructor`, malformed child text/color, and child geometry normalization.
- Half-open range sampling, group-relative time, scale-zero/opacity-zero no-pixel behavior,
  integer scale/pivot geometry, scratch-first child drawing, and exactly one destination alpha
  and `drawImage` application.
- Removal of any required adapter hides an explicit group registration from a custom catalog.
- Canonical complete group-only render recipe snapshots are recursively frozen.

## Files changed in code/test commit

- `src/keyframes.js` (new)
- `src/visual-group.js` (new)
- `src/edit-capabilities.js`
- `src/render-recipe.js`
- `tests/keyframes.test.js` (new)
- `tests/visual-group.test.js` (new)
- `tests/edit-capabilities.test.js`
- `tests/project-editing.test.js`
- `tests/render-graph.test.js`
- `tests/render-recipe.test.js`

## Limits and follow-up concerns

- `keyframes.expression()` deliberately emits FFmpeg-native `if/lt/min/max/pow` expressions.
  It accepts the elapsed expression only from a trusted caller; it is never AI-provided.
- The group registration remains opt-in. Adding it to the default catalog before export and
  desktop preview are wired would expose a capability the product cannot yet complete.
- Render recipes now recognize and freeze canonical group steps, but the export service does
  not execute them in Task 1.
- The scratch canvas is caller-owned; Task 3 should provide one intrinsic-size transparent
  surface per draw path and continue to call `sample()` for the authoritative frame geometry.
- No external calls, Electron runs, app changes, exporter changes, merges, or pushes were made.

## Review follow-up files changed

- `src/keyframes.js`
- `tests/keyframes.test.js`
- `.superpowers/sdd/cycle5-task-1-report.md`
