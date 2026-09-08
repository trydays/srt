# Cycle 4 Task 1 report

## Changes

- Added `SRTVisualLayers`, with frozen shape/text parameter definitions, strict canonical normalization, shared rounded intrinsic-frame geometry, and Canvas drawing using fixed `Heiti SC` alphabetic baselines.
- Registered independent `visual.shape@1` and `visual.text@1` append capabilities across all six adapters. They persist complete payloads, use the visual lane, preserve edit order, and compile at `visualOverlay` between source effects and subtitles.
- Extended scalar validation and prompt context serialization only for declared constrained strings. Text, color and position values from existing layer operations are included in later prompt context.
- Added strict, deeply frozen layer export recipes and controlled FFmpeg drawbox/drawtext generation. User text is written to service-owned UTF-8 files in the existing task directory and never enters the filter expression.
- Added focused contract, atomic ProjectEditing, graph order, strict recipe, filter safety and real-media coverage.

## RED

- Command: `node --test tests/visual-layers.test.js tests/project-editing.test.js`
- Result: expected failure, 19 passed / 1 failed. `tests/visual-layers.test.js` could not load the missing `src/visual-layers.js`, establishing the missing shared contract before production code.

## GREEN

- Focused command: `node --test tests/visual-layers.test.js tests/edit-capabilities.test.js tests/project-editing.test.js tests/render-graph.test.js tests/render-recipe.test.js tests/instruction-capabilities.test.js tests/video-export.test.js tests/layer-video-export.test.js`
- Result before final review: 103 passed / 0 failed / 1 real-media skip. Later focused graph/geometry run after review: 47 passed / 0 failed / 1 real-media skip.
- Real command: `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe SRT_KEEP_REAL_EXPORT=1 node --test tests/layer-video-export.test.js`
- Result: 3 passed / 0 failed / 0 skipped. Two overlapping rectangles and their text were rendered in stable order; red-only, green-over-red and post-range pixels prove half-open coverage; the predicted text region contained more than 30 real white glyph pixels. Literal content was `重点:%{x}, "引号"` and `第二张卡`; filter-unit tests prove it appears only in UTF-8 text files.
- Final required command (with loopback permission for existing server security tests): `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test`
- Final result: 275 passed / 0 failed / 0 skipped.

## Real-media evidence

- Synthetic source/output directory: `/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle4-layer-real-UZMunN`
- Output: `/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle4-layer-real-UZMunN/layers.mp4`
- Verified source semantics: 640x360 display size, approximately 4 seconds, audio preserved.
- Independent baseline probe supplied by parent: `/tmp/srt-cycle4-font.BJ44WT/evidence.json` (29 px `Heiti SC`, x=77, baseline=72; browser/FFmpeg glyph bounds within one pixel).

## Self-review and concerns

- `git diff --check` is clean. No app/UI files, package metadata, plan/ledger changes, new runtime dependency, subprocess subsystem, or cache subsystem were added.
- Export filenames derive only from validated recipe indices; colors and geometry are normalized before fixed filter construction; empty explicit text lines create no drawtext call.
- The first sandboxed full run had seven unrelated `listen EPERM` failures from loopback restrictions. The same full suite passed completely after granting the existing server tests loopback permission.
- UI script loading and timeline aggregation remain intentionally deferred to Task 2.

## Review fix scope

### Behavior

- Floor every positive shape extent, text font size, and text line height to at least one pixel after rounding. Positions remain rounded without a floor; text baseline remains `y + fontSize`.
- Reject parameter keys unless they are own properties of the selected schema, including an own `constructor` key.
- Added Canvas geometry/draw regressions and a real 48×48 FFmpeg export regression.

## TDD RED evidence

1. `node --test tests/visual-layers.test.js tests/layer-video-export.test.js`
   - Exit 1.
   - `rejects unsafe or malformed layer parameters`: `Missing expected exception` for `{ constructor: 1 }`.
   - `floors positive extents and text metrics to one pixel`: actual shape width/height were `0`, expected `1`.
2. `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test --test-name-pattern='minimum shape' tests/layer-video-export.test.js`
   - Exit 1.
   - Center pixel was `254,0,0`, proving the zero-sized FFmpeg drawbox covered the frame.

## GREEN verification

1. `node --test tests/visual-layers.test.js tests/layer-video-export.test.js`
   - Exit 0: 9 tests, 7 passed, 2 real-export tests skipped by their environment gate, 0 failed.
2. `SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/layer-video-export.test.js`
   - Exit 0: 4 tests passed, 0 failed, 0 skipped.
