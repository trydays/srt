# Cycle 3 — ranged video transforms Implementation Plan

> **For agentic workers:** Use subagent-driven-development task-by-task. Each task requires focused behavioral tests and a task review; finish with one whole-cycle review.

**Goal:** Horizontal/vertical flips and center uniform scaling can be requested with natural language, previewed within a range, persisted, undone as one request, and exported to a real video.

**Architecture:** Extend the existing executable capability registry and its adapters. `ProjectEditing` and the linear `RenderGraph` remain the common path; sequential source effects preserve graph order and precede subtitles. Shared geometry supplies both browser composition and controlled FFmpeg parameters.

**Tech Stack:** Existing Electron, vanilla JavaScript, UMD/CommonJS, Canvas 2D/SVG, FFmpeg, node:test and Playwright.

## Global Constraints

- Capability/export ID `video.transform@1`; edit type `video.transform.operation@1`; graph node `video.transform@1`.
- Params: `flipHorizontal` boolean default false, `flipVertical` boolean default false, `scale` finite number from 0.25 through 4 inclusive, default 1. Require at least one explicit supported parameter in AI recipes. Explicit neutral settings are valid.
- Half-open `[start,end)`; omitted range means the entire video. Only validated finite times within project/source duration are accepted.
- One transform applies horizontal flip, vertical flip, then center scaling. Canvas size does not change. Enlarged content clips at the frame; shrinking fills the remaining frame with opaque black. This is fixed framing behavior, not a crop/position editing feature.
- Each source effect processes the previous effect's complete frame; do not collapse multiple transforms or reorder color and transform operations. Subtitles are composed last and remain upright and unscaled.
- One user request is one atomic transaction. Document, timeline, preview, export and next AI context use the same committed revision. `EditDocument` is the sole persisted applied state.
- AI supplies declarative data only; no model-provided code, commands, paths, filters, HTML or CSS. A capability needs all six registered adapters.
- Keep the existing UI colors/layout and existing subtitle/color workflows. No new dependencies, frameworks, database, generic DAG, property panel, rotation, position controls, animation, tracking or later-cycle abilities.
- Work in the existing isolated feature worktree. Local commits are allowed; this development request does not request a new push/merge.
- Stop-loss: 5 hours from start. By 2.5 hours a visible transform must be testable; support work stays below 25%. Finish immediately once acceptance is met. Previous unrelated Minor hardening findings remain tracked separately.

## Geometry decision

Source/display frame dimensions are `W,H`. Use positive integer dimensions, nearest integer scaled dimensions, and deterministic centering:

```js
scaledWidth = Math.max(1, Math.round(W * scale));
scaledHeight = Math.max(1, Math.round(H * scale));
padWidth = Math.max(W, scaledWidth);
padHeight = Math.max(H, scaledHeight);
padX = Math.floor((padWidth - scaledWidth) / 2);
padY = Math.floor((padHeight - scaledHeight) / 2);
cropX = Math.floor((padWidth - W) / 2);
cropY = Math.floor((padHeight - H) / 2);
offsetX = padX - cropX;
offsetY = padY - cropY;
```

Odd differences produce at most one pixel more on the right/bottom. Preview uses these same intrinsic-pixel rectangles, scaled only for display. Preserve source sample aspect ratio in FFmpeg branches so overlay inputs agree.

Installed FFmpeg confirms scale/crop/pad do not accept timeline enable. A convergent split/overlay graph inside existing `-vf` works: original input goes to one branch; the other branch gets fixed flips, scaling, black padding and center crop back to `W,H`; overlay the opaque transformed frame over the original only in the requested interval. Filter labels are service-owned indices. Use 4:4:4 geometry and exact crop offsets to avoid chroma-subsampling rounding.

## File responsibilities

- `src/video-transform.js`: shared parameter schema/normalization and pixel geometry; no execution or persistence.
- `src/edit-capabilities.js`: six transform adapters and generic boolean/number parameter validation.
- `src/instruction-capabilities.js`: catalog-generated boolean descriptions and safe boolean operation context.
- `src/render-recipe.js`: strict transform export snapshot and existing source-effect/subtitle ordering.
- `src/video-export.js`: fixed flip/scale/pad/crop/overlay lowering using probed media dimensions.
- `app/editor-color-preview.js`: retain/reuse the verified SVG color primitives and coordinate graph-derived source-effect preview.
- `app/editor-source-preview.js`: bounded canvas composition for graphs with transforms; two reusable frame buffers, per-node clipping, frame scheduling and cleanup. No persisted state.
- `app/剪辑.html`: shared-module/script order and a display canvas aligned with the video content rectangle.
- Existing unit tests plus `tests/video-transform.test.js`, `tests/transform-video-export.test.js`, `tests/e2e/transform-edit-flow.spec.js`: contract, real pixels and complete UI acceptance.

### Task 1: Executable transform contract and real export

**Files:** Create `src/video-transform.js`, `tests/video-transform.test.js`, `tests/transform-video-export.test.js`; modify `src/edit-capabilities.js`, `src/instruction-capabilities.js`, `src/render-recipe.js`, `src/video-export.js`, `app/剪辑.html` (module loading only), and matching unit tests.

**Interfaces:** `SRTVideoTransform`/CommonJS exports `PARAMETER_SCHEMA`, `normalizeParams(params, requireExplicit)`, `geometry(params, width, height)`. Geometry returns the named dimensions/offsets above plus normalized params, as frozen plain data. Registry exports `createTransformRegistration()` and includes it by default. Registration metadata is append/sourceEffect. Preview adapter returns active normalized params in graph order; toExport returns a fully normalized step.

- [x] Add behavioral tests before implementation: catalog discovers transforms; booleans remain booleans; reject string/number-as-boolean, unknown keys, nonfinite/out-of-range scales and invalid ranges. Prove normalization is an independent snapshot.

```js
const recipe = {kind:'instruction', steps:[{capability:'video.transform@1',
  range:{start:1,end:3}, params:{flipHorizontal:true, scale:1.25}}]};
assert.deepEqual(registry.validateRecipe(recipe), recipe);
assert.deepEqual(transform.normalizeParams({flipVertical:true}, true),
  {flipHorizontal:false, flipVertical:true, scale:1});
assert.throws(() => registry.validateRecipe({kind:'instruction',steps:[{
  capability:'video.transform@1', params:{flipHorizontal:1}}]}));
```

- [x] Extend schema validation by declared type (number/boolean); use own-property membership. Prompt formatting must not print undefined min/max for booleans. Next-context serialization retains true AND false values with no extra payload fields.
- [x] Implement all six adapters with `lane:'video-effect'`, label `画面变换`, readable flip/scale summary. Test transform+color+subtitle uses unchanged atomic executor, common transaction and one undo; test second-step failure leaves prior JSON intact. No capability switch in ProjectEditing or timeline orchestration.
- [x] Add strict export validation for exactly `{capability,range,params}`, exactly three normalized params, and transform/color interleaving only before optional final subtitle. Revalidate persisted transform payloads in toGraph. Keep legacy export recipes valid.
- [x] Extend internal FFmpeg lowering. Use source probe geometry, fixed templates, generated labels and shell:false. The chosen structure per step is:

```text
format=yuv444p,split=2[baseN][workN];
[workN]hflip?,vflip?,scale=SW:SH:flags=bilinear,
 pad=PW:PH:PX:PY:color=black,crop=W:H:CX:CY:exact=1,setsar=SOURCE_SAR[changedN];
[baseN][changedN]overlay=0:0:format=auto:enable='gte(t,START)*lt(t,END)'[nextN]
```

The last output remains the sole video output; preserve existing color/subtitle filters and audio mapping. Omit disabled flip filters. Preserve opaque black in shrink operations and unique labels across repeated transform nodes. Guard real media ranges as strictly as color ranges.

- [x] Generate one short asymmetric source video with distinct quadrants, off-center detail and audio in a temporary directory. Via actual product export service prove each flip, enlarged center scale, shrink and a combination at samples before/inside/after `[1,3)` including exactly 1 and 3. Compare source features at expected mapped positions; metadata duration/dimensions/audio stay intact. Keep fixture out of Git. Include shrink→enlarge to prove per-step clipping.
- [x] Run focused unit/export tests, real transform export with existing SRT_REAL_EXPORT tools, and full `npm test` once. Commit `feat: execute ranged video transforms through the shared graph`. Report exact results, file list and any concern to `.superpowers/sdd/cycle3-task-1-report.md`.

### Task 2: Graph-ordered transform preview and complete UI flow

**Files:** Create `app/editor-source-preview.js`, `tests/e2e/transform-edit-flow.spec.js`; modify `app/editor-color-preview.js`, `app/剪辑.html`, `tests/e2e/electron-main.js`, `package.json` and narrowly necessary existing preview tests.

**Interfaces:** Consume Task 1 shared geometry and current `projectEditing.load(projectId)` snapshot. Keep `colorPreviewController.render()` compatibility for current consumers/tests. New controller handles graphs containing transforms with `render()` and frame lifecycle; runtime buffers are derived, never persisted.

- [ ] First add a failing deterministic UI case using a scoped transform CLI recipe: horizontal flip + scale 1.25 over `[1,3)`. Check one timeline range item and revision, refresh equality, export recipe, entire-request undo, and next prompt containing boolean+scale params. Add mixed transform/color/subtitle and malformed second-step cases where meaningful; preserve previous fail/cancel scenarios.
- [x] Verify actual Chromium Canvas 2D can apply the existing SVG color filter to a drawn frame. Reuse a single helper that builds the four verified color primitives; color-only preview and existing parity checks remain intact. If Canvas URL filtering is unsupported, report the concrete result before selecting another composition mechanism.
- [x] For graphs with transform nodes, keep the existing video element as playback/audio source and display a canvas aligned to its content, with subtitles/UI above it. Draw the source then each active source effect in graph order. Color applies the verified SVG primitives to the previous frame. Each transform writes into a black, original-sized destination buffer before flipping/scaling the prior frame using shared geometry. Swap two buffers; never combine two transforms into one CSS matrix.

```js
// Conceptual transform stage; coordinates come only from shared geometry.
ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
ctx.save();
ctx.translate(g.offsetX + (p.flipHorizontal ? g.scaledWidth : 0),
              g.offsetY + (p.flipVertical ? g.scaledHeight : 0));
ctx.scale(p.flipHorizontal ? -1 : 1, p.flipVertical ? -1 : 1);
ctx.drawImage(previous,0,0,W,H,0,0,g.scaledWidth,g.scaledHeight);
ctx.restore();
```

- [x] Repaint on decoded playback frames, seeks, metadata and project state changes; stop scheduled work on pause/pagehide and avoid duplicate loops. Size the canvas to intrinsic video/project dimensions and object-fit it to display. Black bars belong to the video frame, not the fixed 16:9 editor chrome. Clear/hide transform canvas after undo or absent transforms. Source re-upload/loading must not retain a stale frame.
- [ ] Pixel-level browser tests use an asymmetric real or canvas source, assert actual flip orientation, center resize, black margins, per-node loss of cropped pixels and interleaved color/transform ordering. Include portrait content displayed within the editor frame and the half-open boundaries. Attribute-only checks cannot prove these behaviors. (18 intrinsic/composition checks passed; the actual editor portrait-layout screenshot remains pending Electron execution.)
- [ ] Test the full UI transaction with transforms+existing effects, refresh, next-context and undo; existing subtitle draft handling must keep working after pure transform. Run focused Playwright suites and `npm test`; add new spec to `test:e2e`. Commit `feat: preview graph-ordered video transforms`. Report to `.superpowers/sdd/cycle3-task-2-report.md`.

### Task 3: Final real-chain acceptance and development log

**Files:** Update `docs/DEVELOPMENT_LOG.md`, this plan's checkboxes, and acceptance tests only where an uncovered criterion requires them. Runtime smoke scripts/screenshots/media live in unique temporary directories, not Git.

**Interfaces:** Consume completed Tasks 1–2 only. No new product feature.

- [x] Run the real transform exports plus browser/export comparison for horizontal, vertical, enlargement, shrink, combination and a mixed chain. Assert recognizable interior patches/geometry with codec tolerance rather than demanding identical resampling pixels.
- [ ] Run `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test`; run full `npm run test:e2e` with real parity enabled. Serialize Playwright invocations or use different output directories.
- [ ] Run one actual local Claude UI smoke in isolated userData using production main/default services. Only inject save destination. Submit a valid ranged flip+scale request on a real video; verify one transform item, seek in/out, refresh, actual FFmpeg export and undo. Reuse existing `/tmp/srt-cycle2-real.IRxuRN/` bootstrap pattern; do not use the mock CLI fixture as real evidence. Capture exact returned recipe, screenshot and output metadata.
- [x] Read-only whole-cycle code review from `fba4cb1` to final commit. Resolve actual blocking regressions with focused tests; retain low-priority unrelated work in the ledger.
- [x] Append development log with internal modules/interfaces, user-visible behavior, exact automated/real smoke results, evidence paths and limits. State the source frame stays same size/time/audio; shrink black margins and center clipping are explicit. Distinguish agent validation from pending human viewing. Record no Cycle 4 start and no automatic GitHub push.
- [ ] Commit `docs: record cycle 3 transform acceptance` and finish the cycle.

## Self-review

All Cycle 3 roadmap goals map to these three deliverables. Typed booleans also reach the next prompt. Shared geometry controls rounding/centering in both targets. Mixed ordering is preserved, including color applied to black margins and sequential destructive framing. No animation, rotation, user crop or future graph system is introduced. Completion percentages are rough roadmap indicators, not measured total product functionality.

## Execution status — 2026-09-08

- Contract/export: implemented and reviewed at `146a258`.
- Preview/UI code: implemented and reviewed at `dd89fab`; 18 actual browser pixel checks passed.
- Final real Node/media suite: 260/260 passed; direct preview/export comparison: 9 cases, 580 patches, maximum 5/255 channel difference (limit 7/255).
- Actual Claude → production editor → production export, reload, next-command context and one-request undo passed through an isolated loopback transport. This is not production Electron IPC.
- Electron aborts in macOS `_RegisterApplication` before application JavaScript in this environment. Six new E2E tests collect but could not execute; full desktop regression, the actual editor portrait screenshot and native CLI/IPC smoke remain pending. Do not mark the entire cycle accepted.
- Checkbox items requiring Electron execution remain unchecked even where their code/tests are implemented. The browser intrinsic-portrait check passed; the editor portrait-layout screenshot still requires desktop execution.
- Development log records the separate informational-question parse failure and one deferred Minor compositor error-observability concern. No new chat redesign, Cycle 4, or GitHub push.
