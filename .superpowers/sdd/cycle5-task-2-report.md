# Cycle 5 Task 2 report: real animated group export

## Result

Implemented the opt-in `visual.group@1` export path without changing the default AI catalog. The existing export service now renders each flat group from the source branch onto one transparent intrinsic-size surface, applies group alpha once, dynamically scales that flattened surface, restores source SAR, and overlays it with the shared fixed-pivot and half-open timing rules.

No Electron, catalog, AI-provider, dependency, or service changes were made.

## Files

- Added `src/visual-group-export.js`.
- Modified `src/video-export.js`.
- Added `tests/group-video-export.test.js`.
- Added this report.
- `tests/video-export.test.js` did not need modification; its existing cancellation, source-protection, audio, finalization, and failure checks remain green through the shared service path.

## TDD evidence

### RED: actual renderer

Command:

```text
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/group-video-export.test.js
```

Before production changes, the real four-second group test failed as expected: the service returned `EXPORT_RENDER_FAILED` because `buildVideoFilters` omitted `visual.group@1`, leaving an empty video filter.

The helper contract was then added to the test. The focused non-real run failed first because `src/visual-group-export.js` did not exist. After the helper was introduced, the service-level literal-file test remained RED with `EXPORT_RENDER_FAILED` because `video-export.js` had not yet written the group line file or inserted the group branch.

### GREEN: focused

Command:

```text
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_KEEP_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe node --test tests/group-video-export.test.js tests/video-export.test.js
```

Result: 26 tests, 26 passed, 0 failed, 0 skipped.

The focused cases cover:

- source-derived `split` branches and source-relative `T`/`t` expressions;
- ordered opaque rectangle and literal text rendering onto transparent RGBA;
- one alpha application after flattening and before dynamic scaling;
- `max(1,floor(iw*s+0.5))` / height geometry, fixed-pivot floor rounding, SAR restoration, and half-open overlay enable;
- two UTF-8 Chinese lines plus literal `%`, colon, apostrophe, brackets, backslash, braces, and `$HOME`, all through fixed relative filenames with expansion disabled;
- rejection of malformed keyframes before any process spawn;
- rejection of group ranges beyond media duration before rendering;
- unchanged source bytes, cleanup of task files, and no partial output on renderer failure;
- the pre-existing cancellation, finalization, optional-audio mapping, output validation, and source-protection suite.

### GREEN: full real-enabled Node suite

The sandboxed full command first produced 302 passes and seven failures, all from the existing server-security tests receiving `listen EPERM` on `127.0.0.1`. The same command was immediately rerun with approved local loopback access:

```text
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test
```

Result: 309 tests, 309 passed, 0 failed, 0 skipped.

## Real media evidence

Retained test directory:

```text
/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle5-group-export-1XqkXr
```

Files:

```text
/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle5-group-export-1XqkXr/source.mp4
/var/folders/dz/dz1x73p96xn6d1ss30xqk1dw0000gn/T/srt-cycle5-group-export-1XqkXr/group-export.mp4
```

The exported H.264/AAC MP4 is 320x240, SAR 1:1, and approximately four seconds with audio. Exact output frame indices at 20 fps were decoded instead of seeking by fractional timestamp:

- frame 19: source-only reference before the range;
- frame 20: opacity zero at group start;
- frame 30: back-out overshoot, detected rectangle bounds x=60..193;
- frame 40: settled scale, detected bounds x=64..191;
- frame 55: final half-second fade at 0.5 opacity;
- frame 60: source-only pixels at the half-open end.

Geometry checks allow at most one pixel at raster edges. Solid-region codec comparisons use the separately stated 7/255 tolerance. Two overlapping same-color child rectangles in a second 0.5-opacity group decode to the same interior color in unique and overlap regions, showing that opacity is applied once to the flattened group rather than once per child.

## Limits and deferred scope

- This task does not make groups visible to the default AI catalog and does not implement desktop preview; those remain later Cycle 5 work.
- The fixture recipe is deterministic test data, not a claim of actual AI model execution.
- FFmpeg and Canvas glyph antialiasing are not promised to match byte-for-byte; assertions avoid glyph boundaries.
- Children are clipped to the intrinsic frame before scale, as specified. Content outside that surface cannot re-enter when shrinking.
- Dynamic full-frame alpha/scale has not been benchmarked for 4K or many overlapping groups; no performance claim is made.
- The retained `/var/folders/...` media is test evidence only. Normal export task directories and service-owned line files are removed by the existing lifecycle.
