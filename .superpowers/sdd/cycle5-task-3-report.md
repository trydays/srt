# Cycle 5 Task 3 — Desktop playback, AI contract and compact history

Implemented on `feature/subtitle-export-cycle0`, starting from `3409c0584b2214609f1b9c412fbb5f0c1c332923`, after Task 1 and Task 2 approval. Task 3 brief and the plan's Global Constraints / Frozen Interfaces were followed; unrelated task checklists were not used.

## Changes

- The editor loads `keyframes.js` and `visual-group.js` before the registry. The default catalog now includes the already executable `visual.group@1` registration.
- Group nodes use the existing layer-preview controller and decoded media time, seeking guards, one scheduled callback and normal playback events. Registry preview evaluates animation once. `SRTVisualGroup.sample` receives those evaluated scalars and the actual group range/time to derive intrinsic geometry; `draw` flattens ordered children then transforms once. A WeakMap associates one reusable scratch canvas with each draw target; no animation state is persisted.
- Group timeline metadata supplies `elementCount` and `animated`. Request aggregation remains one item per transaction, totals real child counts, selects `动画图层` when a group is present and retains `静态图层` for prior static records.
- Prompt definitions serialize the complete nested JSON schema, including oneOf, arrays, strict object keys and easing enums. Applied context uses the shared `matchesParameterSchema` matcher to preserve valid nested data and omit malformed/undeclared values. Descriptions teach relative time, destination easing, fixed pivot and additive composition; an in-place modification request must clarify the current limitation. No effect-to-recipe examples were added.
- Deterministic desktop fixtures cover normal playback and lifecycle events, reverse pixel repeatability, portrait/clipping, subtitle order, two groups in one transaction, reload, next-request nested context, add-only follow-up and whole-request undo, plus invalid second-step atomicity. They do not call manual render functions to repair playback.

Product files: `app/剪辑.html`, `app/editor-layer-preview.js`, `app/editor-timeline.js`, `src/edit-capabilities.js`, `src/instruction-capabilities.js`, `package.json`.

Tests: new `tests/e2e/group-animation-flow.spec.js`; updates to `tests/e2e/electron-main.js`, `tests/layer-preview.test.js`, `tests/instruction-capabilities.test.js`, `tests/edit-capabilities.test.js`. One additional assertion in `tests/video-transform.test.js` was updated from the old human-readable `type: boolean` format to actual JSON schema serialization; transform semantics and product code were unchanged. No other browser dependency lists needed modification.

## RED → GREEN evidence

- Representative desktop RED was run before editor/default-catalog changes: the group request was rejected with instruction status `failed` because the group capability was unavailable.
- Focused Node RED covered missing group dispatch, metadata, default catalog and nested prompt/context support. After implementation, focused Node tests passed **51/51**.
- Desktop fixture corrections preserved existing contracts: overflowing rectangle geometry was replaced with long text to test clipping, subtitle success used its own status selector, and undo assertions were aligned with the existing single-transaction undo depth. No product behavior was changed for these fixture assumptions.
- First visible normal desktop playback GREEN was confirmed by **08:58 UTC, 2026-09-08**, ahead of the 10:56 UTC checkpoint. Midpoint alpha was 128, back-out bounds exceeded settled bounds, the held frame had alpha 255, reverse seeks reproduced identical pixels, pause froze pixels and natural ended cleared the overlay.
- Initial full Node run: **313/314**, sole failure was the old prompt-format assertion in `tests/video-transform.test.js`. The corrected final run below passed.

## Final verification

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test
```

**314/314 passed, 0 failed, 0 skipped**; duration 4756.54225 ms. Final log: `/tmp/srt-cycle5-task3-node-final.log`. Initial full-run log: `/tmp/srt-cycle5-task3-node.log`.

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm run test:e2e
```

**57/57 passed**, including all three group cases, legacy static layer flows and actual color export/preview parity; duration 2.8 minutes. Color parity maximum channel errors were **2, 7, 2, 4** for the four existing cases, within their threshold. Log: `/tmp/srt-cycle5-task3-e2e.log`. Electron ownership was released after this suite completed.

`git diff --check` passed before commit. No source-exporter changes, dependencies, external AI calls, push or main merge were performed. Parent-owned `docs/PROJECT_STATUS.md`, the plan and coordination ledger were left out of the commit.

## Visible artifacts and limits

Artifacts were viewed after generation:

- `test-results/e2e/group-animation-flow-flat--8ac55-erministic-alpha-and-bounds/group-animation-midpoint.png`
- `test-results/e2e/group-animation-flow-flat--2457a-alid-second-group-atomicity/group-portrait-subtitle.png`

The deterministic source is **96×64 at 20 fps**; portrait is **64×96 at 20 fps**, both four seconds. Existing preview layout enlarges these tiny sources, so screenshot text/edges appear soft. They are intrinsic-pixel regression artifacts, not a claim about full-resolution typography. The UI palette/layout was unchanged.

Fixture CLI responses are deterministic application regression evidence, **not real-AI acceptance**. External Claude and the independent production-local smoke remain parent-owned validation. Existing add-only composition and one-transaction undo limits remain in force; no update-existing-edit protocol, animation UI, new persisted state or performance platform was introduced.
