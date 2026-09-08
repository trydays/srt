# Cycle 6 Task 2 — Desktop texture preview and AI catalog

## Implemented

- Loaded `video-texture.js` before the browser capability registry.
- Extended the existing two-buffer source compositor to process ranged grain and vignette nodes in graph order with colors and transforms.
- Enabled texture-only source preview and preserved the color-only SVG fast path.
- Added decoded-media-time tracking, seek suppression, guarded refresh, and one cancellable playback callback.
- Enabled `video.noise@1` and `video.vignette@1` in the default AI catalog with strict scalar schemas, source scope, and time-range descriptions. Legacy `texture.grain@1` and `vignette@1` remain unsupported.
- Added actual playable-media Electron coverage for temporal grain, deterministic reverse seeks, ranged vignette, ordered landscape/portrait pixels, reversed texture/color ordering, persistence, typed next context, additive static text, atomic invalid recipes, undo/reload, canvas removal, and subtitle-draft editing.

## TDD evidence

### RED

Command:

```sh
env -u FORCE_COLOR -u NO_COLOR node --test tests/source-preview.test.js tests/instruction-capabilities.test.js
```

Expected failures:

- Texture-only graph scheduled no decoded callback because source preview required a transform.
- `video.noise@1` and `video.vignette@1` were absent from the default prompt catalog.

### GREEN

Focused controller/catalog command passed after implementation. The final strengthened desktop command was:

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 \
  SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
  SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe \
  npx playwright test tests/e2e/texture-edit-flow.spec.js
```

Result: **5/5 passed** in 16.4s.

## Full verification

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 \
  SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
  SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test
```

Result: **334/334 passed**, zero failures/skips.

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 \
  SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
  SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm run test:e2e
```

Result at the complete-suite checkpoint: **61/61 passed** in 3.0m. The focused spec was subsequently strengthened with an independent arithmetic oracle and subtitle-draft case and passed **5/5**; product code did not change after the complete-suite run.

## Files changed

- `app/editor-source-preview.js`
- `app/剪辑.html`
- `src/edit-capabilities.js`
- `tests/source-preview.test.js`
- `tests/instruction-capabilities.test.js`
- `tests/edit-capabilities.test.js`
- `tests/render-recipe.test.js`
- `tests/e2e/electron-main.js`
- `tests/e2e/texture-edit-flow.spec.js`
- `package.json`

## Self-review

- Replaced the first browser-pixel expectation with independent frozen grain/vignette arithmetic instead of calling the product texture module.
- Added explicit reversed texture/color output comparison so compositor ordering is behaviorally checked.
- Confirmed only the existing display canvas plus two reusable intrinsic buffers are used.
- Confirmed source changes, page hide, seeking, and undo cancel the active callback and clear stale pixels.
- `git diff --check` is clean. No Critical, Important, or Minor scoped issues remain.

## Issues / concerns

None. No AI service was called and nothing was pushed.

## Independent review closure

The independent scoped review found two Important items; both are closed in the follow-up commit.

1. **Interrupted seek latch on source replacement:** added a VM regression for `seeking -> emptied -> loadeddata` without an old-source `seeked`. RED was 4/5 with the new source still hidden. Source-reset events now clear the seek latch before the existing reset; GREEN is 5/5.
2. **Desktop acceptance detail:** strengthened the real playable-media spec to assert grain pixels change during natural playback, the ended frame remains stable, an opaque visual-layer pixel is unchanged by source grain, texture/color order matches independent RGB expectations in both landscape and portrait geometry, the first request has compact history and three timeline projections, and undoing only the newest text survives reload with the three source edits intact.

Focused review verification:

```sh
env -u FORCE_COLOR -u NO_COLOR node --test tests/source-preview.test.js
```

Result: **5/5 passed**.

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 \
  SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg \
  SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe \
  npx playwright test tests/e2e/texture-edit-flow.spec.js
```

Result: **5/5 passed** in 17.3s. After explicitly including the source-noise node in the opaque-overlay graph, its focused pixel case also passed **1/1** in 3.3s. No full suite was rerun in this follow-up because the controller requested focused verification and reserved final full-suite acceptance for the root task.

### Opaque DOM composition follow-up

The final scoped review requested proof from the real editor's composed DOM rather than detached layer pixels. The scenario fixture now returns a normal `visual.shape@1` instruction. The test applies source grain and the opaque shape through normal project/controller paths, confirms both real preview canvases are visible, and captures three `#previewArea` PNGs:

- source and layer visible;
- source hidden with the same layer visible;
- source and layer hidden, revealing the original video.

At a point inside the shape, the first two PNG pixels are byte-for-byte equal. The layer-visible baseline differs from the original-video control. Outside the shape, the source-visible and source-hidden pixels differ. Together these zero-tolerance controls prove that source grain is displayed while the opaque layer remains above it; no platform screenshot color value or codec tolerance is hardcoded.

Focused item result: **1/1 passed** in 4.0s. Complete texture spec result: **6/6 passed** in 21.0s. This follow-up changed tests/fixture/report only and did not call AI or modify product code.
