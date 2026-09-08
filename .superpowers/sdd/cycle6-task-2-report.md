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
