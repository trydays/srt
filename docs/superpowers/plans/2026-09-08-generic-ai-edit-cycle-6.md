# Cycle 6: Grain and Vignette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Each implementation task requires tests first, a local commit and an independent scoped review. Checkbox items track progress.

**Goal:** AI combines ranged monochrome grain and centered vignette with existing color operations; the same project state previews, persists, undoes and exports the result.

**Architecture:** Add two source-effect registrations to the existing six-adapter registry and linear RenderGraph. A shared UMD module owns parameter semantics, deterministic CPU pixels and software-generated FFmpeg expressions; existing source preview and exporter consume it. No preset recipes or alternate execution/state system.

**Tech Stack:** Existing Electron, JavaScript UMD/CommonJS, Canvas ImageData, FFmpeg, node:test and Playwright. No new runtime dependencies.

## Global Constraints

- User approved continuing the next phase of the previously approved roadmap; Cycle 6 is grain/vignette, not Cycle 7 personal skills. Base `bdfc422` is already pushed and verified on `trydays/srt`, `feature/subtitle-export-cycle0`. Use existing isolated worktree `/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`; no push, merge, cleanup or Cycle 7 without new approval.
- Start approximately 2026-09-08 09:50 UTC; visible-result checkpoint 11:50 UTC; four-hour stop-loss 13:50 UTC. Support work <=25%; stop at acceptance. Baseline fresh real-enabled Node/media 314/314, zero failures/skips. Preserve original palette/layout, subtitles/drafts and all previous operations.
- New capabilities/node types: `video.noise@1` and `video.vignette@1`. Edit types: `video.noise.adjustment@1` and `video.vignette.adjustment@1`. Both append source effects with `[start,end)` ranges, default whole target, and normal transaction/revision/undo semantics. Every new source operation retains graph order with colors/transforms; all visual layers/groups follow source effects and subtitles follow visual layers.
- Only required scalar `amount` for noise and required scalar `strength` for vignette, finite numbers [0,1], including 0 as exact identity. No undeclared parameters, keyframes, grain size/rate controls, custom seed, moving center, masks, LUT, blur, shader, arbitrary expression/code, third-party effects, new UI panel or skill library.
- Grain is achromatic additive fine noise, fixed maximum channel amplitude 32/255 and fixed 12 updates/second of source media time. No Math.random, accumulated frame count, wall clock or persisted noise state. Every RGB channel receives the same delta before per-channel clipping; alpha unchanged. Identical media time/source pixels/params must produce identical pixels across seek/reload.
- Canonical time bucket: `floor((floor(time*1000000+0.5)*12+6)/1000000)`. This uses nearest-microsecond media time and the half-microsecond upper edge so decoded 1.083333 and exact 13/12 select the same bucket. Reduce bucket modulo 65521 before seed arithmetic. For integer intrinsic pixel x,y: `z=((x+1)*1973+(y+1)*9277+(bucket%65521+1)*26699+911)%65521`; twice `z=(31*z*z+17)%65521`; delta=`amount*32*((z%256-127.5)/127.5)`. Output per RGB channel `min(255,max(0,floor(channel+delta+0.5)))`.
- Vignette is centered circular distance in intrinsic physical pixels, not an axis-normalized ellipse: `q=((x-(W-1)/2)^2+(y-(H-1)/2)^2)/max(1,((W-1)^2+(H-1)^2)/4)`. Per RGB channel output `min(255,max(0,floor(channel*(1-strength*q)+0.5)))`; alpha unchanged. Corners are black at strength1; 1x1 is safe. This does not imply professional lens simulation.
- Evaluate on the current intrinsic-size source frame at each node's position in graph order. Reuse the source compositor's two buffers; do not add frame caches, workers, GPU pipelines or another render loop. A single private fixed 65521-byte lookup of the two polynomial hash rounds is permitted to avoid recomputing invariant arithmetic per pixel; it must preserve the exact formula and is not time/project state. Runtime timeupdate events must not replace the last decoded media timestamp while playing, and seeking must not draw stale frames or reschedule callbacks.
- Export uses trusted `format=gbrp,geq=r='...':g='...':b='...'` with per-plane `if(gte(T,start)*lt(T,end),changed,original)` because geq lacks generic enable. Only normalized numbers enter generated strings. Preserve source protection, actual media dimensions/duration/SAR/audio, cancellation and the current H.264/AAC/yuv420p/CRF20 output contract. A zero-strength effect should be omitted from the filter chain; if all steps are neutral, retain a valid null/identity filter.
- Do not expose either new capability in the default AI catalog until real export and desktop preview are wired. The prompt still teaches decomposition using serialized schemas, not named-effect mappings or recipe examples. Older unsupported IDs `texture.grain@1` / `vignette@1` remain unsupported.
- Distinguish formula agreement from lossy video: raw RGB FFmpeg-vs-JS error <=1/255; repeat preview sampling is exact. For encoded grain, verify nonzero spatial variation, stable mean, temporal change and positive correlation to the predicted field; do not require 7/255 single-pixel agreement on high-frequency lossy noise. Smooth vignette and unaffected flat areas retain existing 7/255 codec tolerance. Do not silently increase thresholds to pass tests.

## Frozen Interfaces

Create `src/video-texture.js`, UMD global `SRTVideoTexture`:

```js
NOISE_PARAMETERS; // frozen {amount:{type:'number',minimum:0,maximum:1,description:...}}
VIGNETTE_PARAMETERS; // frozen {strength:{type:'number',minimum:0,maximum:1,description:...}}
normalizeParams(kind, params); // 'noise'|'vignette'; exactly its own required field, normalized clone; RECIPE_INVALID_PARAM
applyFrame(kind, params, rgba, width, height, mediaTime); // mutate and return RGBA pixel buffer, alpha unchanged
buildFilter(kind, params, range); // one trusted FFmpeg filter fragment, '' for neutral
```

Keep the pixel calculation and generated expression definitions beside one another in this small domain module. No generic expression compiler/interpreter. `applyFrame` validates supported kind/parameters, positive safe-integer width/height, correctly sized mutable RGBA byte data and nonnegative finite mediaTime; internal per-pixel helpers reuse precomputed bucket/geometry. `buildFilter` rejects malformed ranges without relying on a future command runner. Tests use independent arithmetic/known pixels and real FFmpeg to verify formulas, not eval of generated expressions.

`src/edit-capabilities.js` exports `createNoiseRegistration()` and `createVignetteRegistration()`, internally sharing only the two texture registrations' mechanics. Each has all six adapters and `graphStage:'sourceEffect'`, timeline lane `video-effect`, labels `画面颗粒` / `画面暗角`. `preview()` returns canonical active scalar params. Default catalog enabling is Task 2 only.

## Task 1: Shared textures, project contracts and real export

**Files:** Create `src/video-texture.js`, `tests/video-texture.test.js`, `tests/texture-video-export.test.js`. Modify `src/edit-capabilities.js`, `src/render-recipe.js`, `src/video-export.js`. Focused additions to `tests/edit-capabilities.test.js`, `tests/project-editing.test.js`, `tests/render-recipe.test.js`, `tests/video-export.test.js`. No app or default catalog changes.

**Interfaces:** Produce the frozen module and registration factories above. Consume existing range normalizer, ProjectEditing transactions, source-effect graph lowering and exporter lifecycle. No change to persisted schema version or migrations.

- [x] Write RED tests against public APIs before implementation. Examples:

```js
assert.deepEqual(texture.normalizeParams('noise',{amount:0}), {amount:0});
assert.throws(()=>texture.normalizeParams('noise',{amount:1,seed:4}));
const data=new Uint8ClampedArray([100,100,100,255]);
texture.applyFrame('vignette',{strength:1},data,1,1,2);
assert.deepEqual([...data],[100,100,100,255]);
// On a 3x3 neutral frame strength1 must make the corners black and leave center unchanged.
// Two samples at identical source time must match after an intervening different time.
// 13/12 and its decoded nearest microsecond must produce the same grain field.
```

- [x] Run `node --test tests/video-texture.test.js` and capture expected missing-feature RED. Add wrong types/nonfinite/out-of-range/missing/unknown/own-constructor parameter checks; invalid frame/range input; zero identity/unchanged alpha; frozen browser schemas. Small actual pixel arrays test achromatic grain, clipping and vignette center/corner/portrait symmetry.
- [x] Implement only the frozen semantics. For grain calculate bucket once per frame, then hash once per pixel (not once per channel). For vignette precompute center and denominator. Explicit `floor(v+.5)` avoids typed-array ties-to-even differences. Generate matching trusted geq expressions, not raw user strings or files. Test known pixels and deterministic changes between adjacent grain buckets.
- [x] Add opt-in registrations and strict canonical render-recipe validation. Both normalization and every persisted-node/export path must reject invalid fields/ranges. Complete adapters use the original source head, ordinary edit order and half-open activation. A custom registry with either required adapter removed hides the corresponding definition; neither capability is default yet.
- [x] Through real ProjectEditing test a color+grain+vignette transaction: all edits share one transaction/revision; context contains exact params and ranges; reload exact; whole request undo exact. Invalid later texture step leaves prior storage/document/undo unchanged. Test texture vs transform order and stage ordering below visual/subtitle nodes.
- [x] Wire the two validated export steps to `buildFilter`, preserving lifecycle/SAR/audio. Ensure a recipe containing only zero-valued texture steps still yields a valid export. Before implementation run the new real export test RED using the full FFmpeg installation below.
- [x] Use synthetic four-second neutral/color-block video plus audio to produce grain-only, vignette-only and color+grain+vignette actual MP4s. Also run the generated filter on a raw RGB source/output as independent formula oracle: before/start/middle/end/after, both operation orders, zero/max parameters and 96x64/portrait geometry. Compare raw pixels <=1; for grain-only gray128 at amounts .6 and1, encoded RMS/raw RMS must be .80–1.15, mean drift <=3 levels and correlation >=.90 with the known field (these bounds were independently probed at CRF20). Confirm texture changes between 1.25 and1.5sec, deterministic same-time re-export and unaffected half-open regions. Vignette corner/center and smooth samples <=7; test whole-target/default ranges and interleaving with color/transform plus top subtitle once. Malformed/out-of-duration payloads reject before render spawn; source and existing target remain protected.
- [x] Run focused suites then full real-enabled Node once; commit implementation/tests as `feat: add deterministic grain and vignette export`. Write `.superpowers/sdd/cycle6-task-1-report.md` with RED/GREEN, exact commands/counts, media artifacts and concerns. Task-scoped review before Task 2.

## Task 2: Desktop texture preview and AI catalog

**Files:** Modify `app/editor-source-preview.js`, `app/剪辑.html`, `src/edit-capabilities.js`, `tests/source-preview.test.js`, `tests/instruction-capabilities.test.js`, `tests/e2e/electron-main.js`, `package.json`; add `tests/e2e/texture-edit-flow.spec.js`. Update existing browser script/catalog assertions only where the new dependency genuinely requires it.

**Interfaces:** Load `video-texture.js` before edit-capabilities and render-recipe consumption. Use Task 1 `SRTVideoTexture.applyFrame`, registration factories, shared original-intrinsic geometry. Existing `SRTSourcePreview.createCompositor(canvas,filterRoot).render(source,graph,time,width,height)` remains unchanged to callers. Catalog expands only at this task after both adapters work.

- [x] Write RED desktop behavior: texture-only source graph must activate source preview without a transform; normal video seek/play/pause/ended shows grain changes and deterministic reverse seeks, vignette only in range, no stale frames during seeking. Use actual playable local fixture, not manual compositor/render calls as a substitute for event wiring. Extend source-controller VM tests with recorded texture draw timestamps: a decoded callback at1.25 followed by currentTime1.5/timeupdate must retain1.25 until next decoded frame; during seeking no render or callback is allowed.
- [x] Add per-node texture processing inside the existing ordered compositor. The changed branch reads previous-buffer ImageData, calls shared applyFrame, writes next buffer; preserve color/transform ordering, alpha/source geometry and the same two canvases. With no transform/textures, retain the existing color-only SVG path. Remove the source canvas when undo leaves no supported canvas-source effect.
- [x] Add a last-decoded-time value, a guarded refresh path and seeking checks to the existing source controller as required by temporal grain. Keep one cancellable callback; clear on source changes/pagehide/undo, resubscribe only when ready/not-seeking. Do not redesign layer rendering or add another scheduling service. Existing colorPreviewController calling sourcePreviewController.render() must use last decoded time while playing; explicit frame callbacks still supply mediaTime.
- [x] Enable both registrations in default catalog; descriptions explain scalar intensity, source-only scope and supported time ranges. Add prompt/context tests for the actual two schemas and canonical state. Replace broad old `/vignette/`-absence assertions with the exact unsupported legacy ID check so the new version can be present. No hardcoded user-effect mapping or extra request classifier.
- [x] Desktop fixture submits color+grain+vignette in one request, verifies compact existing history, timeline projections, document/graph revision, reload, actual renderer pixels and next-context typed params. Follow with one add-only static text instruction; original source edits remain unchanged, newest-request undo/reload works. Separately verify whole initial transaction undo, invalid-later-step no partial write, subtitle draft remains editable. Keep source effects below existing static/group overlays and subtitle presentation; draw a simple opaque visual element in fixture and assert its pixels are unaffected by source grain.
- [x] Add actual browser pixel checks of ordered texture/transform and reversed texture/color operations at landscape and portrait dimensions. Use independent known-pixel/RGB reference; collect then assert results (not screenshots alone). Run focused spec then full real-enabled Node and Electron once. Commit as `feat: preview AI-composed grain and vignette effects`; write `.superpowers/sdd/cycle6-task-2-report.md`, task review.

## Task 3: Parent acceptance and handoff

**Files:** Only this plan, `docs/PROJECT_STATUS.md`, `docs/DEVELOPMENT_LOG.md`, ignored `.superpowers/sdd/progress.md`. Temporary scripts/media in unique /tmp paths. Any bounded product fix needs a failing regression and re-review.

- [x] Independent final review of `bdfc422..finalProductCommit`; parent freshly runs final real-enabled Node and full Electron suites. No reuse of earlier counts as newly run results.
- [x] Isolated production Electron on artificial footage; default IPC/project/preview/actual FFmpeg, only save destination injected. When authorized, exactly two actual Claude calls with artificial instructions/project metadata: first combine ranged color+grain+vignette, second preserve effects and add text only. Do not send video/path/real project data. User consent requested asynchronously; if still pending use explicitly fixed local translations and disclose actual-AI gap, never bypass denial.
- [x] Verify normal source playback/backward seeks/half-open ranges, exact reload and context/second-undo. Export grain, vignette and their color combination already covered by Task1; production UI export must independently produce real video with same duration/dimensions/audio and expected texture metrics. View actual editor and exported frames; do not misrepresent synthetic data, save-path injection or untested packaged release as user manual acceptance.
- [x] Update internal-completion and user-visible-result records separately with exact tests, failures, time, artifact paths and remaining boundaries. Commit records locally and stop; no auto push or Cycle7.

## Verification Commands

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm run test:e2e
```

The separate `/opt/homebrew/bin/ffmpeg` lacks required text/subtitle filters. Use the explicit full installation; loopback/Electron permissions via ordinary authorization only. Tests never make real AI calls. The real-AI acceptance harness requires its separate user approval.

## Exit

Grain and vignette each execute independently and combine with color through the one existing chain, including actual video export, deterministic preview timing, project persistence, incremental context and request undo. Stop when achieved; personal skills, extra visual parameters and rendering-platform work remain outside this cycle.

## Final Verification Record — 2026-09-08

- All implementation and review tasks complete. Final tested code/test HEAD: `53dee81`; product code unchanged since `0b44335`. Task-scoped reviews and independent whole-cycle review `bdfc422..53dee81` approved with no outstanding findings.
- Parent fresh final real-enabled Node/media suite: **335/335 PASS**, zero failures/skips, exit 0 (5.207 seconds). Parent fresh full Electron suite: **63/63 PASS**, exit 0 (3.2 minutes), including actual texture/export tests. Desktop artifacts: `/tmp/srt-cycle6-final.zHLxVC/e2e-final/`. Earlier 334/62 and 335/62 runs are not the final verification.
- Production LOCAL acceptance: **PASS**, `/tmp/srt-cycle6-local.bAetFB/`. Exactly two fixed translation fixtures through the production parser and Electron IPC; production project/preview/export services and actual FFmpeg. Only the translation results and save-dialog destination were injected. No external AI calls.
- First request persisted ordered color + noise + vignette at [1,3) in one transaction; second add-only text received exact typed prior-project context. Second-request undo and reload preserved the first effects. Export occurred after the second text was undone, so the exported video contains the three source effects, not that text.
- Actual export: 640×360, 4.000 seconds, H.264/yuv420p/24fps + AAC, export duration 6.177 seconds. Grain comparison correlation 0.96458–0.96929, RMS retention 0.92946–0.93128, absolute mean drift <=1.523 levels. Unaffected sampled regions at .5,3,3.5 seconds had zero 8-bit RGB error. Frozen thresholds unchanged.
- Parent viewed actual editor and exported frame images. Independent read-only audit of scripts, IPC evidence, assertions, metrics and media metadata approved the LOCAL acceptance claims. All test-owned Electron windows/processes closed; no user footage/project was changed.
- Internal completion: shared texture semantics, adapters, source preview, catalog, persistence/context/undo/export and local verification complete. User-visible result: ranged grain/vignette independently execute and combine with existing source effects; actual preview and MP4 available without palette/layout changes.
- Actual Claude acceptance remains **pending fresh user authorization** for exactly two artificial test calls. The Task 3 checkbox records completion of its explicitly permitted local fallback, not actual AI validation. Real footage, native save-dialog interaction, packaged release and high-resolution performance acceptance remain unverified.
- Start approximately 09:50 UTC; first visible desktop result 10:29 UTC, before the 11:50 checkpoint. Local production acceptance and parent viewing completed approximately 11:08 UTC, before the 13:50 stop-loss. Finish records locally and stop; no push, merge, worktree cleanup or Cycle 7.
