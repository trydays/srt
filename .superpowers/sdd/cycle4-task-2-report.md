# Cycle 4 Task 2 report

Status: DONE

## Scope

- Added the production `SRTLayerPreview.drawGraph(canvas, graph, time, width, height)` interface and `layerPreviewController.render()`.
- Added an intrinsic transparent overlay canvas above source frames and below subtitles, driven directly from the current ProjectEditing graph.
- Added decoded-frame/fallback scheduling with one outstanding callback, seek/load/pause/project/page lifecycle clearing and refresh.
- Aggregated only visual timeline items by transaction into `静态图层 · N 个元素`; original edit IDs and all persisted edits remain unchanged.
- Added real Electron coverage for browser pixels, overlap order, `[start,end)` boundaries, clipping, portrait geometry, text ink/literal content, subtitle ordering, persistence, typed context, export recipe order, whole-request undo, malformed-step atomicity and subtitle draft continuity.

## RED evidence

- `node --test tests/layer-preview.test.js`: 0 passed, 2 failed because `app/editor-layer-preview.js` did not exist.
- `./node_modules/.bin/playwright test tests/e2e/layer-edit-flow.spec.js --reporter=line`: 0 passed, 3 failed after the scoped fixture was valid; renderer failed because `SRTVisualLayers` was not loaded before capability registration. Failure artifacts were under `test-results/e2e/layer-edit-flow-*`.

## GREEN evidence

- Focused: `node --test tests/layer-preview.test.js` — 2 passed, 0 failed.
- Focused: `./node_modules/.bin/playwright test tests/e2e/layer-edit-flow.spec.js --reporter=line` — 3 passed, 0 failed.
- Full Node/media, run once with real-export flags: 280 passed, 0 failed. Real layer output: `/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle4-layer-real-YmYdFM/layers.mp4`.
- Full Electron, run once with the new spec in `test:e2e`: 54 passed, 0 failed in 2.7 minutes.
- Browser screenshot: `test-results/e2e/layer-edit-flow-static-vis-d5e3c-text-and-subtitle-top-layer/layer-preview.png`.

## Limits

- Static shape/text layers only; no animation, images, templates, layer property panel, updates or reordering UI.
- Electron translation is a scoped deterministic CLI fixture. The separate production actual-AI smoke remains Task 3/root ownership.
- Browser and FFmpeg glyph antialiasing are not asserted byte-identical; the test checks real text ink in the predicted baseline region and shared geometry/order.

## Review follow-up (2026-09-08)

- RED: `node --test tests/layer-preview.test.js` — 2 passed, 2 failed. A decoded callback at `mediaTime=.99` correctly hid `[1,3)`, but `timeupdate` at `currentTime=1.01` exposed it without a new decoded frame. A `timeupdate` fired during seeking also redrew and restarted both decoded and animation-frame schedulers after the seeking reset.
- Root cause: decoded playback lifecycle events bypassed the decoded timestamp, while neither `render` nor `schedule` guarded `video.seeking`.
- Fix: retain the last decoded media time, route lifecycle/public refresh through it during decoded playback, and stop rendering or scheduling while seeking. Paused rendering and animation-frame fallback continue to use `video.currentTime`; source/load/page resets clear the retained time.
- GREEN Node: `node --test tests/layer-preview.test.js tests/visual-layers.test.js` — 9 passed, 0 failed.
- GREEN Electron: `./node_modules/.bin/playwright test tests/e2e/layer-edit-flow.spec.js --reporter=line --output=/tmp/srt-cycle4-task2-review-e2e-final` — 3 passed, 0 failed. The strengthened evidence asserts portrait canvas/video content rectangles match, edge pixels remain frame-clipped, literal text produces ink, and a visible subtitle physically overlaps a visual shape while remaining above it.
- Focused Electron artifacts: `/tmp/srt-cycle4-task2-review-e2e-final`.
