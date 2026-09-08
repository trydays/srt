# Cycle 5: Minimal Keyframe Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax. Each implementation task needs tests first and an independent scoped review.

**Goal:** AI composes existing text and rectangles with shared opacity/scale keyframes, and the resulting animation persists, previews deterministically, undoes and exports to actual video.

**Architecture:** Add a flat `visual.group@1` composition primitive to the existing six-adapter registry and linear RenderGraph. It flattens ordered static text/rectangles onto a transparent intrinsic-size surface, then applies one opacity and one uniform scale about a fixed pivot. One shared keyframe evaluator and trusted expression compiler define Canvas/FFmpeg timing; no card preset or second execution/state system.

**Tech Stack:** Existing Electron, JavaScript UMD/CommonJS, Canvas, FFmpeg, node:test and Playwright; no new runtime dependency.

## Global Constraints

- User approved Cycle 5 after its goals/boundaries report. Cycle 4 backup was pushed and independently verified at `b530e2da1fc083bcfa0a41b85c6693bb120bf4c0` on `trydays/srt`, branch `feature/subtitle-export-cycle0` before development. Use existing isolated worktree `/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`; preserve unrelated changes. No automatic push of Cycle 5 or main merge.
- Start 2026-09-08 approximately 07:56 UTC; visible result checkpoint 10:56 UTC; six-hour stop-loss 13:56 UTC. Support work <=25%; end at acceptance, no Cycle 6.
- Scope: new flat compositions of existing rectangle/text primitives with opacity and uniform scale only. No position/rotation keyframes, nested groups, references to existing edit IDs, in-place modification of existing static layers, image imports, templates, skills, custom easing/curves, tracking or animation/property editor. Existing source-video transform remains static. This is additive composition through existing ProjectEditing, not an update-existing-edit protocol.
- Preserve UI palette/layout, existing subtitle editor/drafts and source effects. Existing static `visual.shape@1` / `visual.text@1` payloads and semantics remain unchanged. The default AI catalog gains the group only once real export and desktop preview are wired.
- AI produces data only: no paths, FFmpeg expressions, Shell, HTML/CSS/JavaScript or font names. Literal text uses existing fixed Heiti SC and service-owned UTF-8 files with expansion disabled. No arbitrary JSON Schema engine; support only concrete nested schema forms needed for group/keyframe payloads.
- Group `layers` is an ordered array of 1–16 `{kind:'shape'|'text',params:{...}}` records using existing static layer parameter contracts. Coordinates/font sizes remain fractions of the intrinsic VIDEO frame, not fractions of a card. All children share the group's half-open `[start,end)` range, fixed pivot, opacity and scale. Children have no range, IDs, own animation or nested groups. Flatten before alpha/scale; child overlap must not double-apply group opacity.
- Group params: required `layers`; `pivotX` and `pivotY` numbers in [0,1], defaults .5/.5; `opacity` default1, domain[0,1]; `scale` default1, domain[0,2]. Opacity/scale are either a scalar or `{keyframes:[{time,value,easing}]}`. Each animation has 2–16 frames, first time exactly0, strictly increasing finite times in seconds RELATIVE TO GROUP START, last <= group duration when known. Missing easing canonicalizes to `linear`; easing on the destination frame describes the incoming segment. Hold final value until range end.
- Only `linear` (p), `ease-out` (1-(1-p)^3) and `back-out` (1+2.70158*(p-1)^3+1.70158*(p-1)^2) are valid. Clamp interpolation results to the property's domain; fixed overshoot can be clipped at opacity/scale domain limits. No hidden loops, accumulated clocks, random or user expressions. Seeking backward and forward must produce identical state at a given media time.
- Composite onto an intrinsic W×H transparent surface, clip children there first, then scale the flattened surface. Scaled dimensions are max(1,floor(W*s+.5)) and max(1,floor(H*s+.5)); x=floor(pivotX*(W-scaledWidth)+.5), y analogous. Both adapters use these rules. Scale0 or opacity0 contributes no pixels. Existing font/baseline rules remain. Do not claim byte-identical glyph antialiasing between renderers.
- Keep source effects below visual overlays and subtitles on top. Group order is ordinary edit order. One request stays one atomic transaction/revision; invalid later step leaves document/undo unchanged. Persist only EditDocument and existing undo; the graph, animation samples and scratch surface are derived, never another persisted state.

## Frozen Interfaces

`src/keyframes.js` UMD `SRTKeyframes`:

```js
valueSchema(minimum, maximum, defaultValue); // finite scalar OR strict keyframes object
normalize(value, minimum, maximum, duration); // canonical scalar/object; duration optional until range known
valueAt(value, elapsed, minimum, maximum); // pure, clamped; already canonical input
expression(value, elapsedExpression, minimum, maximum); // only trusted caller supplies variable expression
```

`src/visual-group.js` UMD `SRTVisualGroup`, depends on keyframes and visual-layers:

```js
PARAMETERS; // group parameter schema
normalizeParams(params, duration); // required layers, defaults, strict nested keys/times
sample(params, range, mediaTime, width, height); // null outside range; otherwise {opacity,scale,x,y,width,height}
draw(context, surface, params, frame, width, height); // flatten using SRTVisualLayers.draw into caller-owned scratch canvas, then one drawImage/alpha
```

Registry factory `createGroupRegistration()` produces capability/node `visual.group@1`, edit `visual.group.layer@1`, `editMode:'append'`, stage `visualOverlay`. All six adapters use canonical group payloads; `preview(graph,time)` returns active canonical payloads with evaluated opacity/scale (same remaining group fields), using group-relative time. Timeline reports label `动画图层`, lane `visual`, summary as child element count. Current default registration list is not expanded until Task 3.

## Task 1: Keyframes, flat group contract and project persistence

**Files:** Create `src/keyframes.js`, `src/visual-group.js`, `tests/keyframes.test.js`, `tests/visual-group.test.js`. Modify `src/edit-capabilities.js`, `src/render-recipe.js`; focused additions to `tests/edit-capabilities.test.js`, `tests/project-editing.test.js`, `tests/render-graph.test.js`, `tests/render-recipe.test.js`. Do not modify app or exporter in this task.

**Interfaces:** Produce frozen APIs above and `createGroupRegistration`. Existing ProjectEditing/graph remain generic. Add `matchesParameterSchema(schema,value)` export to edit-capabilities for shared declared-value validation (finite scalars, enum, strict required object fields, bounded arrays and oneOf only); no references, schema loading or executable validators. Existing data-only check must run before examining untrusted nested fields. Registry normalization must call group normalization with the normalized range duration. RenderRecipe accepts only canonical complete group params and deep freezes them; stage remains visualOverlay.

- [ ] Write RED tests using the exact boundary cases and public APIs:

```js
const v={keyframes:[{time:0,value:0},{time:1,value:1,easing:'ease-out'}]};
assert.equal(keyframes.valueAt(keyframes.normalize(v,0,1,2),.5,0,1),.875);
assert.throws(()=>keyframes.normalize({keyframes:[{time:0,value:0},{time:0,value:1}]},0,1,2));
// A custom registry containing createGroupRegistration() applies one group
// with rectangle+text in one transaction; reload retains nested frames;
// undo removes the whole request. Invalid second group's frame beyond range
// leaves the exact document and prior undo intact.
```

- [ ] Run `node --test tests/keyframes.test.js tests/visual-group.test.js tests/project-editing.test.js`; record expected missing feature RED. Cover descending/duplicate/nonfinite times, unknown easing/fields, wrong scalar types, >16 frames/layers, nesting, first time !=0, animation outside explicit and default whole-video ranges, malformed child text/color. Assertions must test behavior, not file text.
- [ ] Implement normalization, pure evaluation and controlled expression generation from the same easing definitions. Segment evaluation uses `p=(elapsed-a.time)/(b.time-a.time)` clamped[0,1], destination easing, linear value interpolation and final domain clamp; expression uses identical segment comparisons and coefficients. Include JS evaluation tests for every easing, held last value, reversed sampling order and domain caps.
- [ ] Implement group canonicalization, integer geometry and flatten-once drawing. For draw tests use an instrumented minimal Canvas interface to verify children draw on scratch before a single opacity-bearing destination drawImage, preserving relative geometry. Do not independently alpha-blend each child onto the destination.
- [ ] Add the group registration factory and strict render-recipe support without making it default/AI-visible yet. Extend declared schema matching only as required, retain unknown-key rejection (including `constructor`), all old adapter contracts and scalar behavior. Verify removing any required adapter hides the group from a custom registry catalog. Verify graph order group-before-subtitle and ordered groups.
- [ ] Run focused tests then real-enabled `npm test` once. Commit Task 1 code/tests as `feat: add shared keyframe and visual group contracts`. Write `.superpowers/sdd/cycle5-task-1-report.md` with RED/GREEN, files, limits; no push.

## Task 2: Real animated group export

**Files:** Create `src/visual-group-export.js`, `tests/group-video-export.test.js`; modify `src/video-export.js`, focused `tests/video-export.test.js` assertions if necessary. No app/catalog changes.

**Interfaces:** Consume SRTKeyframes.expression and SRTVisualGroup normalization/geometry. Export helper `buildGroupFilter(step, stepIndex, media)` generates one controlled branch fragment suitable for existing -vf chain. Helper `groupTextFiles(step,stepIndex,media)` returns fixed relative filenames and literal text for nonempty child lines; video-export writes them using existing task directory/lifecycle. No extra render service or pre-render cache.

- [ ] Write failing real export test with a four-second synthetic source and audio, one grouped rectangle + two lines of Chinese text at [1,3). Keyframes fade0→1 and scale.5→1 via back-out in the first second, then fade1→0 during last half-second. Test start/middle/overshoot/settled/end and a second group with overlap; no AI fixture is claimed as actual model execution.
- [ ] Run `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/group-video-export.test.js` and record RED.
- [ ] Implement source-split transparent branch using source timestamps, not an independent color-source clock. Proven local structure:

```text
split[base][group]; [group]format=rgba,
drawbox=x=0:y=0:w=iw:h=ih:color=black@0:t=fill:replace=1,
<ordered static drawbox replace=1 / literal drawtext with y_align=baseline>,
format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(opacity(T-start))',
scale=w='max(1,floor(W*scale(t-start)+0.5))':h='max(1,floor(H*scale(t-start)+0.5))':eval=frame:flags=bilinear[groupScaled];
[base][groupScaled]overlay=x='floor(pivotX*(W-overlay_w)+0.5)':y='floor(pivotY*(H-overlay_h)+0.5)':format=auto:enable='gte(t,start)*lt(t,end)*gt(scale(t-start),0)'
```

The bracket names, paths and expression syntax are software-owned; insert only normalized numbers/hex strings and expressions from SRTKeyframes. Alpha is applied before scale so geq has fixed dimensions. Preserve source sample aspect ratio and existing map/audio/finalization/cancellation paths. Dynamic overlay exact geometry must match shared rules; adjust generated syntax for installed FFmpeg without changing those semantics.
- [ ] Add literal file tests, malformed export rejection before spawn, source protection, range validation and no partial output on render failure by extending existing seams. Check actual output width/height/duration/audio; decode solid interior regions to show shared alpha (not per-child darkening), size/pivot, fixed overshoot and half-open timing. Keep codec tolerance separate from glyph antialiasing.
- [ ] Run focused tests and real-enabled full Node suite once. Commit as `feat: export keyframed visual groups through shared renderer`; write `.superpowers/sdd/cycle5-task-2-report.md` with real artifact paths, failures and limits. Do not enable catalog or launch Electron yet.

## Task 3: Desktop playback, AI contract and compact history

**Files:** Modify `app/剪辑.html`, `app/editor-layer-preview.js`, `app/editor-timeline.js`, `src/edit-capabilities.js`, `src/instruction-capabilities.js`, `tests/e2e/electron-main.js`, `package.json`. Create `tests/e2e/group-animation-flow.spec.js`; extend `tests/layer-preview.test.js` and `tests/instruction-capabilities.test.js` as needed.

**Interfaces:** Load keyframes and visual-group scripts before edit-capabilities. Reuse existing preview controller decoded media time, seeking guards and single callback. Draw group with `SRTVisualGroup.sample` and `draw`, using one scratch canvas owned by the preview draw target (not new persistent state). Enable createGroupRegistration in default catalog only after preview and export paths exist. Capability schema serialization must include actual nested layer/keyframe schema and strict enums, not string `[object Object]`; context must preserve validated nested arrays/values.

- [ ] Write RED desktop case submitting a fixture group Recipe, then use normal seek/play/pause/ended events to assert alpha and bounds at beginning/mid/overshoot/end; no manual render calls to patch playback. Include reverse seek, portrait/clipping, group-before-subtitle order, two overlapping groups, reload, next-request nested context, second add-only request and whole-request undo. Add invalid second group check for zero partial commit. Fixture model responses are only deterministic regression evidence.
- [ ] Run new spec to establish RED before app/default registration changes.
- [ ] Extend drawGraph's visual node dispatch and source-ready check to include the group; preserve static branches and frame lifecycle. Reuse one scratch surface per target, resize/reset as needed, draw children in local edit order then transform once. For incoming sampled params, avoid applying keyframes twice; actual group range/time should be consumed once by sample.
- [ ] Keep timeline aggregation by request. Static-only label remains `静态图层`; when a request contains a group, label `动画图层`. Use generic timeline metadata to total child elements instead of counting group edits as one element; group metadata optional for old static records, so old tests/counts remain unchanged. No new panel or keyframe UI.
- [ ] Serialize full parameter schemas into prompt. Teach relative-to-range-start time, fixed pivot and newly-added group semantics in descriptions, not effect→recipe examples. Preserve incremental steps contract. Valid nested group payloads enter next context; undeclared fields are omitted/rejected using shared matching. An instruction to modify an existing edit in place must not falsely claim replacement; current add-only limitations remain explicit.
- [ ] Run focused Node/UI then real-enabled full Node and Electron suites once. Commit `feat: preview AI-composed group animations in editor`; write `.superpowers/sdd/cycle5-task-3-report.md`, including visible checkpoint/artifacts and exact counts.

## Task 4: End-to-end acceptance and handoff

**Files:** Only this plan, `docs/DEVELOPMENT_LOG.md`, `docs/PROJECT_STATUS.md` current-status summary, and ignored progress ledger. Bounded fixes require RED regression and review. Temporary smoke scripts/media remain in uniquely named /tmp directories.

- [ ] Parent independently runs final real-enabled Node suite and full Electron suite on final code; final whole-cycle read-only review uses baseline b530e2d.
- [ ] Production Electron isolated project on synthetic footage: run actual natural-language animation request through Claude, project persistence, natural playback/seeking, UI export/real FFmpeg. Then another add-only request with current nested context, undo and reload. Only send artificial instructions/capability/project metadata, never user footage or paths; follow tool authorization and ask if external calls are rejected. Do not call a mock test real-AI acceptance.
- [ ] At identical start/middle/overshoot/settled/end media times compare preview/export direction, pivot/size and interior alpha against source pixels. Solid-patch codec tolerance 7/255 (do not silently raise), shared integer geometry +/-1px away from antialiased boundaries. Inspect text in actual frames; no promise of identical glyph rasterization. Use ordinary playback and backwards seek to prove deterministic timing, no wall-clock drift.
- [ ] Log internal completion separately from user-visible result, exact test counts and actual AI/MP4 evidence, own-footage/manual-save-dialog gaps. Record six-hour ceiling/exit. Local commits only; leave tested worktree for manual user viewing, do not start Cycle 6.

## Exit

An AI-composed text/rectangle group actually fades in, scales up with fixed mild overshoot, settles and fades out at requested times; seeking/reload/undo/context and MP4 export preserve the same animation. Existing subtitles, color/transform and static layers retain their behavior. Stop at acceptance, disclose remaining user footage viewing separately.
