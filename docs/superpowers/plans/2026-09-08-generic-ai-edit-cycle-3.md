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

- [x] Add and execute a deterministic UI case using a scoped transform CLI recipe: horizontal flip + scale 1.25 over `[1,3)`. Check one timeline range item and revision, refresh equality, export recipe, entire-request undo, and next prompt containing boolean+scale params. Add mixed transform/color/subtitle and malformed second-step cases where meaningful; preserve previous fail/cancel scenarios. (The earlier environment prevented pre-implementation UI execution; the first successful desktop run exposed test assertion errors, corrected and rerun during acceptance.)
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
- [x] Pixel-level browser tests use an asymmetric real or canvas source, assert actual flip orientation, center resize, black margins, per-node loss of cropped pixels and interleaved color/transform ordering. Include portrait content displayed within the editor frame and the half-open boundaries. Attribute-only checks cannot prove these behaviors. (18 composition checks and actual Electron portrait-layout pixels/screenshot passed; screenshot reference colors share the same display path without increasing tolerance.)
- [x] Test the full UI transaction with transforms+existing effects, refresh, next-context and undo; existing subtitle draft handling must keep working after pure transform. Run focused Playwright suites and `npm test`; add new spec to `test:e2e`. Commit `feat: preview graph-ordered video transforms`. Report to `.superpowers/sdd/cycle3-task-2-report.md`. (Implementation commit remains `dd89fab`; desktop execution completed in the acceptance follow-up.)

### Task 3: Final real-chain acceptance and development log

**Files:** Update `docs/DEVELOPMENT_LOG.md`, this plan's checkboxes, and acceptance tests only where an uncovered criterion requires them. Runtime smoke scripts/screenshots/media live in unique temporary directories, not Git.

**Interfaces:** Consume completed Tasks 1–2 only. No new product feature.

- [x] Run the real transform exports plus browser/export comparison for horizontal, vertical, enlargement, shrink, combination and a mixed chain. Assert recognizable interior patches/geometry with codec tolerance rather than demanding identical resampling pixels.
- [x] Run `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test`; run full `npm run test:e2e` with real parity enabled. Serialize Playwright invocations or use different output directories. (Fresh results after the incremental-protocol fix: Node/media 264/264; Electron 51/51, zero skips/failures.)
- [x] Run one actual local Claude UI smoke in isolated userData using production main/default services. Only inject save destination. Submit a valid ranged flip+scale request on a real video; verify one transform item, seek in/out, refresh, actual FFmpeg export and undo. Reuse existing `/tmp/srt-cycle2-real.IRxuRN/` bootstrap pattern; do not use the mock CLI fixture as real evidence. Capture exact returned recipe, screenshot and output metadata. (Passed after the user-approved incremental-protocol fix; original two prompts unchanged, plus intentional-repeat and no-change checks. Evidence: `/tmp/srt-incremental-fix.vrp6cz/`.)
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

## Desktop acceptance follow-up — 2026-09-08

- Normal reviewed sandbox escalation now starts Electron; no product startup change was needed. This supersedes the earlier launch blocker above.
- First full desktop run: 47 passed, 4 failed, all within the newly executed transform spec. Root causes were the subtitle-only selector for pure transforms, a helper demanding collapse for clarify/failure responses, and screenshot RGB assumptions across display color conversion. Test-only corrections preserve exact intrinsic RGBA, same-screenshot reference equality, geometry/black/alpha checks and explicit state assertions. Independent read-only review found no blocking issues.
- Focused transform run: 6/6 passed. Final full Electron run with real color parity: 51/51 passed in 2.5 minutes, exit 0. Output: `/tmp/srt-cycle3-desktop-final-20260908/`; the portrait test retains `portrait-in-editor.png`, inspected by the parent agent.
- Fresh Node/real-media run: 260/260 passed, zero skips/failures. Real transform media retained at `/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle3-transform-msyAMa/`.
- An isolated production Electron check, without any AI request, imported the real 640×360 four-second video, applied a fixed test recipe through ProjectEditing, checked decoded frames at 0.5/1/2/3/3.5 seconds, retained document/graph after reload, exported through default production IPC/FFmpeg, and persisted undo. Only the save destination was injected. Output `local-export.mp4` retains 640×360, four seconds and audio. Evidence: `/tmp/srt-cycle3-native.PB3D1k/local-evidence.json`.
- Actual Claude-to-production-IPC UI smoke remains **not executed**: auto-review rejected sending test instructions/project metadata to Claude without explicit payload/destination approval. The user has been asked; no alternative external call was made.
- Native save-dialog GUI operation remains **not executed**: Computer Use reports the Mac is locked and needs manual unlock. Injected save destinations and simulated cancel scenarios do not count as native dialog acceptance. The initial temporary dialog bootstrap also needed its Electron builtin import corrected; no production file changed.
- No new product feature, user-project mutation, GitHub push or Cycle 4 work. Full acceptance remains pending the two checks above and the user's own-footage viewing. Test-only changes and this record remain local until the acceptance is finished.

## Real AI and native dialog follow-up — 2026-09-08

- User explicitly approved sending test instructions and artificial-media project summaries to the logged-in Claude service, without uploading video. The reviewed production Electron smoke was then executed; earlier permission/lock blockers no longer describe the current status.
- Actual Claude returned the requested `[1,3)` horizontal flip and 1.25 scale in 9 seconds. One transaction/revision was committed. Decoded preview samples at 0.5/1/2/3/3.5 seconds and reload passed. Production IPC exported a real 640×360, four-second H.264/AAC file. Five preview/export patches differed by at most 1/255 (unchanged threshold 7/255).
- **Important real acceptance failure:** the next request, “保留刚才已经执行的编辑。在第 3 秒到第 4 秒新增垂直翻转，缩放保持 1 倍。”, produced both the already-applied first step and the new step. The request context correctly contained revision 1 and the old operation. The append executor therefore produced three total edits instead of two; the real script stopped at this assertion. Its later undo checks did not execute. Exact evidence: `/tmp/srt-cycle3-native.PB3D1k/ipc-evidence.json`, `evidence.json`, `failure.png`; the first successful export is `export.mp4` in the same directory.
- Read-only diagnosis and independent review agree: `buildPrompt` describes output shape and existing state but never states that returned steps are only the current incremental edits; `ProjectEditing.applyRecipe` preserves the old document and appends each new source effect. This is a prompt/execution contract gap, not lost context or disconnected CLI. Product changes are not made under this acceptance-only authorization. Proposed next scope: clarify incremental output and intentional repetition semantics, add a regression, rerun this unchanged two-request case; do not blindly deduplicate equal parameters.
- Native dialog observations: the first cancellation returned `已取消` and allowed reopening export. A subsequent real save produced `dialog-source-已编辑.mp4`; the initial temporary checker stopped because it wrongly expected a different filename. During a fresh check, the window instead reached `导出完成` while the script was waiting for cancellation; its automation was stopped, not counted as a passing run. The actual native output `/tmp/srt-cycle3-dialog.H02Wyk/dialog-source-已编辑.mp4` was independently probed as 640×360, four seconds, H.264/AAC. Native cancellation and successful save have observed evidence, but neither complete temporary scripted run is reported as PASS.
- Current exit status: desktop rendering/export and native dialog outcomes are evidenced; **multi-turn real AI acceptance failed on repeated prior edits and remains unfixed**. No full-cycle sign-off, new feature, code commit, push or Cycle 4. Human own-footage acceptance remains separate.

## Approved incremental-protocol fix — 2026-09-08

- User approved repairing the repeated-prior-edit defect. Only production `buildPrompt` changed: return current incremental actions, not a complete project recipe; preserve applied context without resending it. Source effects append, subtitle regeneration replaces its track, and explicitly requested identical repetitions remain valid. A keep-current-only request uses the existing `clarify` response without mutating state. No executor deduplication, new capability, effect mapping, UI change or dependency.
- Test-first evidence: three new prompt constraints failed before the fix (41 passed / 3 failed); the focused prompt/CLI/project suite then passed 63/63. A project regression protects two intentional equal-parameter transforms as distinct transactions and undo of only the latest request. Fresh real Node/media suite passed 264/264, zero failures/skips, exit 0. Independent read-only review found no actionable issues in this round's three code/test files.
- Final full Electron regression after this fix passed 51/51 with real color parity enabled, zero failures/skips, exit 0, in 2.5 minutes. Artifacts: `/tmp/srt-incremental-fix.vrp6cz/e2e/`. Its mock-AI cases are distinct from the actual Claude smoke below.
- Production Electron + actual Claude + production IPC/FFmpeg smoke passed. The original two prompts were rerun unchanged: the second result contained only the new `[3,4)` vertical flip, so the document contained two edits rather than three. The first edit remained identical; revision-1 context arrived correctly. Undo and reload restored only the first edit. A third explicit identical-repeat prompt appended a new transaction, and a fourth keep-current-only prompt returned `clarify` with document/graph/revision unchanged. No renderer errors.
- First-request real decoded preview covered 0.5/1/2/3/3.5 seconds; refresh retained document/graph. The actual exported `export.mp4` is 640×360, four seconds, H.264/AAC, with a maximum five-patch preview/export difference of 1/255 (unchanged limit 7/255). Only the save destination was injected; no AI or rendering service was substituted. Tests sent only approved artificial-media summaries/text, not the video.
- Evidence: `/tmp/srt-incremental-fix.vrp6cz/evidence.json`, `ipc-evidence.json`, `preview-at-2s.png`, `export.mp4`. The previous failed run remains preserved separately.
- Current status supersedes the prior "remains unfixed" statement: the observed multi-turn defect is fixed and its real regression passed. Prompt-based constraints are not a deterministic guarantee for every future model output; the separate informational-question issue is not declared fully solved. Own-footage acceptance remains pending and earlier native-dialog script caveats remain. The user subsequently approved committing/pushing this fix, acceptance tests and records together with existing Cycle 3 commits to `feature/subtitle-export-cycle0`, without merging the main branch. Publication is not human-acceptance sign-off. No Cycle 4 work.
