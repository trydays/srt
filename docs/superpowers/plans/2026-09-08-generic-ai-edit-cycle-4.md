# Cycle 4: Static Text and Rectangle Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use tests before implementation and review each task.

**Goal:** Natural-language requests compose plain text and rectangles into static cards that persist, preview, undo and export through the existing editing chain.

**Architecture:** Two composable capabilities, `visual.shape@1` and `visual.text@1`, append ordinary edits through ProjectEditing. Shared normalized geometry feeds Canvas preview and controlled FFmpeg drawbox/drawtext export; graphs order source effects, visual layers, then subtitles. No card-specific executor or second persisted graph.

**Tech Stack:** Existing Electron/JavaScript/Canvas/FFmpeg/Playwright/node:test. No new runtime dependency.

## Global Constraints

- Scope approved by the user on 2026-09-08: static plain text, rectangles, position, time range and layer ordering only. No images, rich text, animation, templates, personal skills or new property panel. Do not change existing UI colors/layout.
- Preserve ProjectEditing atomic requests, project persistence, latest-transaction undo, and context injection. New requests append; preserving old edits does not replay them. No automatic parameter deduplication.
- AI only produces data. No AI-provided paths, shell, FFmpeg filters, HTML/CSS/JavaScript, font filenames or runtime dependencies.
- Single source video and existing output size/duration/audio semantics remain. All new ranges use `[start,end)`; omitted range means whole video.
- Coordinates are normalized to the intrinsic video frame: x/y in [0,1]; rectangles have width/height in [0.01,1] and must fit within the frame. Round coordinates/sizes to pixels in one shared helper.
- Text uses fixed `Heiti SC`, the same family as existing subtitles, normal weight; no font import/selector. Font size is a fraction of frame height in [0.02,0.2], default 0.05. x/y specify a virtual top-left text origin: first alphabetic baseline = round(y*H) + round(fontSize*H); subsequent baselines advance round(1.2*pixelFontSize). Explicit newlines only, no auto-wrap or shrink-to-fit; overflow is clipped to the frame. Text max 200 UTF-16 code units, max 8 lines, nonblank; reject control characters other than newline, normalize CRLF. Simple #RRGGBB solid colors only.
- Rectangles and text are separate general-purpose nodes, not a fixed card preset. Source effects below visual layers; subtitles always on top. Visual layers use stable edit.order (AI step order); later nodes cover earlier nodes. Do not add a layer-reordering editor.
- Timeline visual-layer nodes aggregate by transaction as one user-facing item; their min start/max end is the request envelope, not a claim that every internal layer is active throughout. Preserve existing non-layer timeline behavior.
- Existing isolated worktree: `/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`, branch `feature/subtitle-export-cycle0`, baseline `9abf439`. Preserve unrelated work; no automatic push or main merge.
- Six-hour stop-loss, visible result by three hours, support work <=25%. Start recorded at approximately 06:22 UTC; visible checkpoint 09:22 UTC, stop 12:22 UTC. Stop at acceptance; do not start Cycle 5.

## Frozen Interfaces

`src/visual-layers.js` exports UMD/CommonJS `SRTVisualLayers`:

```js
FONT_FAMILY = 'Heiti SC';
SHAPE_PARAMETERS; // x=.1, y=.1, width=.3, height=.15, color='#000000'
TEXT_PARAMETERS; // text required, x=.12, y=.12, fontSize=.05, color='#FFFFFF'
normalizeParams(kind, params, requireExplicit); // kind 'shape' or 'text', reject unknown keys, canonical complete payload
geometry(kind, params, width, height); // {x,y,width,height,color} or {x,y,fontSize,lineHeight,lines:[{text,x,baseline}],color}
draw(ctx, kind, params, width, height); // save/restore context; opaque rect or literal fillText at shared baseline
```

Registration node types equal the capability IDs. Edit types: `visual.shape.layer@1`, `visual.text.layer@1`; `editMode:'append'`, `graphStage:'visualOverlay'`, lane `'visual'`. Registration `preview(graph,time)` returns active canonical payloads, `toExport(node)` returns `{capability,range,params}`. Shapes allow any nonempty subset with defaults; text always requires nonblank `text`.

Layer parameters and content are part of EditDocument and next prompt. String validation only supports the concrete needed `minLength/maxLength/pattern` constraints; no general JSON Schema engine. Definition params.required enforces required text. Data-only validation remains before access. Incomplete registrations are still hidden.

## Task 1: Executable layer contract, geometry and real export

**Files:** Create `src/visual-layers.js`, `tests/visual-layers.test.js`, `tests/layer-video-export.test.js`; modify `src/edit-capabilities.js`, `src/render-graph.js`, `src/render-recipe.js`, `src/instruction-capabilities.js`, `src/video-export.js`; focused updates to `tests/edit-capabilities.test.js`, `tests/instruction-capabilities.test.js`, `tests/project-editing.test.js`, `tests/render-graph.test.js`, `tests/render-recipe.test.js`, `tests/video-export.test.js` as required. Do not touch app files or package.json in this task.

**Interfaces:** Produce the frozen shared module and two registrations above. Existing ProjectEditing consumes registrations unchanged. Render recipe recognizes source-effect -> visual-layer -> subtitle stages with exact key/parameter checks and deep freezing. Keep existing subtitle-last compatibility, but add a visualOverlay graph stage between sourceEffect and overlay.

- [ ] Write focused failing tests for advertised complete layers, normalized geometry and source/text/shape/subtitle ordering. Example public behavior:

```js
const recipe = {kind:'instruction', steps:[
  {capability:'visual.shape@1',range:{start:1,end:3},params:{x:.1,y:.1,width:.4,height:.25,color:'#000000'}},
  {capability:'visual.text@1',range:{start:1,end:3},params:{text:'重点',x:.12,y:.12,fontSize:.08,color:'#FFFFFF'}}
]};
// registry.normalizeRecipe(recipe,{duration:4}) yields complete declared payloads.
// ProjectEditing applies once; document.edits.length=2, shared transactionId;
// refresh preserves both; undo removes both. Later shape covers earlier text.
```

- [ ] Run `node --test tests/visual-layers.test.js tests/project-editing.test.js` and record expected missing-capability/geometry RED before implementation. Add concrete rejection cases: missing/blank text, wrong types, unknown keys, bad colors, >200 units, >8 lines, control chars, rectangles exceeding frame, invalid ranges and invalid second step leaves storage/undo unchanged.
- [ ] Implement shared typed definitions, normalization and rounded geometry/draw. Canvas uses `textBaseline='alphabetic'`, `textAlign='left'`, fixed font and literal fillText per explicit line. Extend the existing scalar parameter validator and prompt context serialization to validated strings, without allowing arbitrary schema/executable values. Serialize existing layer text/color/position into the next prompt.
- [ ] Register both nodes with all six adapters; preserve old registrations. Generic graph stage order becomes sourceEffect=0, visualOverlay=1, overlay=2. Request append/undo logic remains unchanged; do not generalize replaceEdit (still subtitle-specific and not part of this deliverable).
- [ ] Extend strict render recipes for layers and stage ordering, with normalized exact keys. Build controlled drawbox fragments from numbers/#hex and drawtext fragments from trusted font plus numeric geometry. Each text line is written as UTF-8 to a service-owned `layer-<step>-<line>.txt` in existing taskDir, referenced by relative name, `expansion=none`, `y_align=baseline`, x and y from shared geometry. Never interpolate user text into filters. Empty explicit lines produce no draw call. Rendering resources use existing task lifecycle/cancel/cleanup; no extra process/service/cache subsystem.
- [ ] Run one real synthetic-video test through createVideoExportService, checking two overlapping cards, layer coverage, literal Chinese/text punctuation, half-open ranges, source media dimensions/duration/audio. Include scalar behavior tests and strict rejection before process spawn. FFmpeg installed locally supports drawtext y_align=baseline; do not substitute a new runtime. Example controlled fragment:

```js
// Text itself exists only in taskDir/layer-1-0.txt.
"drawtext=font='Heiti SC':textfile=layer-1-0.txt:expansion=none:fontsize=29:x=77:y=72:y_align=baseline:fontcolor=0xFFFFFF:enable='gte(t,1)*lt(t,3)'"
```

- [ ] Run focused tests then `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test`. Commit only Task 1 files, subject `feat: execute static text and shape layers through shared graph`. Write `.superpowers/sdd/cycle4-task-1-report.md`, including RED/GREEN and artifact paths.

## Task 2: Desktop layer preview, compact timeline and end-to-end interaction

**Files:** Create `app/editor-layer-preview.js`, `tests/layer-preview.test.js`, `tests/e2e/layer-edit-flow.spec.js`; modify `app/剪辑.html`, `app/editor-timeline.js`, `tests/e2e/electron-main.js`, `package.json`. Keep color/source preview logic and subtitle editor behavior intact.

**Interfaces:** Consume SRTVisualLayers and complete registry, existing project-edit-state-changed event and projectEditingReady. Expose `window.SRTLayerPreview.drawGraph(canvas, graph, time, width, height)` for production controller use, plus `window.layerPreviewController.render()` if an existing consumer needs immediate refresh. These are ordinary production interfaces, not test-only hooks.

- [ ] Write failing real Electron case using scoped CLI fixture output: rectangle/text pair at [1,3) and a second pair at [2,4), four nodes under one request. Expect one transaction, four edits, one visual timeline item and no new property panel. Also submit malformed text as second step, expect zero partial write. Run `npm run test:e2e -- --grep 'static visual layers'` once to observe RED.
- [ ] Add shared module script before capability registration, and an intrinsic-resolution transparent layer canvas positioned like previewSourceCanvas, above video/source canvas and below previewSubtitle. Render all active visual nodes in graph order using shared draw. Canvas object-fit/geometry follows intrinsic frame, including portrait media. Never apply video color/transform to the overlay canvas.
- [ ] Wire decoded frame callbacks (or existing frame-time fallback), seek/pause/source load/project change/reload lifecycle; one refresh loop at most, clear stale overlays when not ready/no layers or source replaced, cancel on pause/pagehide. Fresh graph read from ProjectEditing; no second persisted layer state. Pure-layer video must preview without requiring a transform.
- [ ] Aggregate only visual lane items per transaction at timeline presentation and transaction summary; do not collapse non-visual markers or change existing subtitle counts. Preserve original edit IDs in document. Use data/test marker attributes and literal textContent, never HTML from layer text. Envelope label must say e.g. `静态图层 · 4 个元素`, representing a request rather than a preset.
- [ ] Verify real Canvas pixels for position, two card overlap, [start,end) seek boundaries, frame clipping and portrait layout. Check actual text ink at predicted baseline region, literal HTML-like text, and topmost subtitle visibility. Save a screenshot as evidence. Verify refresh, next-context text/shape values, export recipe order, whole-request undo then refresh, old subtitle drafts still editable after layer-only requests.
- [ ] Add new spec to test:e2e; run focused Node/UI then full suite once. Commit only Task 2 files, subject `feat: preview static layers and group their timeline requests`. Write `.superpowers/sdd/cycle4-task-2-report.md` with RED/GREEN, output paths and limits.

## Task 3: Real production acceptance and report

**Files:** Update this plan checkboxes and `docs/DEVELOPMENT_LOG.md` only; bounded fixes require failing regression before changes. Temporary scripts/media/screenshots remain in unique tmp directories, not Git.

**Interfaces:** Production main/IPC, local Claude, project editing and FFmpeg. Artificial test source only; follow external-call permissions and stop to request authority if rejected, without bypass. No real user project mutation. Only inject save destination in automated export smoke; distinguish native dialog checks.

- [ ] Run real-enabled full Node/media and full Electron suites serially; independently inspect test counts and actual exit codes. Run one final whole-cycle read-only review from baseline 9abf439.
- [ ] Open production Electron in isolated userData and submit natural-language static-card request on artificial video. Verify actual returned steps, persisted edits, two overlapping visual arrangements, seek states and actual MP4 export. Submit a second add-only request with context, undo it and reload; no duplicate old edits. Do not count a mock CLI as actual Claude.
- [ ] Compare preview and export at the same frame: solid rectangle patches and overlap order with codec tolerance, text content/position/line baselines and visible glyph regions. Do not claim byte-identical antialiasing or cross-platform font rendering. If font/geometry differs materially, fix the cause or report the gap, never silently increase tolerance.
- [ ] Append development log: internal module changes, user-visible capabilities, exact tests/real results, evidence paths, remaining user own-footage acceptance and constraints. Update ledger and commit `docs: record cycle 4 static layer acceptance`. Do not automatically push or start Cycle 5.

## Acceptance exit

Two differently placed, overlapping static cards preview in correct order, refresh identically, undo by request and appear in actual exported MP4 with original size/time/audio; existing subtitles/color/transform remain intact. The project has reusable text/rectangle primitives, not a special effect name lookup. User own-footage viewing is reported separately.
