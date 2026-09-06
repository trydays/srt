# Task 1 Report: Hard-Subtitle Export Capability Detection

## Status

Complete. Code review passed, the authorized keg-only `ffmpeg-full` installation completed without replacing the linked FFmpeg, and the real one-second Chinese hard-subtitle plus AAC sample gate passed.

## Scope and changed files

- `src/environment/index.js`
- `app/env-check.js`
- `tests/environment.test.js`
- `tests/environment-install.test.js`
- `tests/e2e/scenario-dependencies.js`
- `tests/e2e/environment-flow.spec.js`
- `.superpowers/sdd/task-1-report.md`

No exporter, render recipe, local CLI, Whisper, effect, or brainstorm file was changed.

## Read-only environment baseline

The two preferred keg-only candidates were absent:

- `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
- `/usr/local/opt/ffmpeg-full/bin/ffmpeg`

The existing PATH pair was:

- FFmpeg: `/opt/homebrew/bin/ffmpeg`, version `9.0.1`
- ffprobe: `/opt/homebrew/bin/ffprobe`, version `9.0.1`

Read-only probes found:

- filters: neither `ass` nor `subtitles`
- encoders: `libx264` and `aac`
- muxer: `mp4`

The production environment module therefore reported FFmpeg itself as installed/ready, `modes.subtitleExport` as `{ status: 'limited', reason: 'subtitle_filter_missing', blockers: ['ffmpeg'] }`, kept `canContinue: true`, and rejected `getExportTools()` with `EXPORT_RUNTIME_NOT_READY`.

## TDD evidence

RED command:

```bash
node --test tests/environment.test.js
```

Expected result: 25 passed, 4 failed. The new tests failed because `modes.subtitleExport` and `getExportTools()` did not exist.

Installation RED command:

```bash
node --test tests/environment-install.test.js
```

Expected result: 9 passed, 3 failed. The new assertions showed the plan and action still referenced ordinary `ffmpeg` rather than `ffmpeg-full`.

GREEN command:

```bash
node --test tests/environment.test.js tests/environment-install.test.js
```

Result: 41/41 passed.

Added behavior coverage for:

- installed FFmpeg without `ass` remaining installed while subtitle export is limited
- `subtitles` without `ass` not satisfying the fixed executor requirement
- missing `libx264`/`aac` or `mp4` capability
- missing ffprobe
- probe execution failure
- exact ready FFmpeg/sibling ffprobe paths returned by `getExportTools()`
- bundled/system fallback behavior
- macOS `ffmpeg-full` installation plan and fixed confirmed action

## Implementation notes

- Both `detectEnvironment()` and `getExportTools()` call the same `probeExportTools()` selection/probe path.
- macOS checks `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`, then `/usr/local/opt/ffmpeg-full/bin/ffmpeg`, then existing bundled/system candidates.
- An absolute FFmpeg candidate only checks its sibling ffprobe; only the system `ffmpeg` command may pair with the PATH `ffprobe` command.
- Readiness requires the exact `ass` filter, both `libx264` and `aac` encoders, the `mp4` muxer, and a runnable ffprobe.
- `getExportTools()` probes again on every call and returns only the selected `{ ffmpegPath, ffprobePath }`; no renderer-supplied executable path was introduced.
- FFmpeg installation and subtitle-export readiness remain distinct, and detection never blocks continuing to the home page.
- The macOS confirmed install remains allowlisted and now runs `brew install ffmpeg-full`; no force-linking or channel replacement was added.

## Verification

- Focused environment/install tests: 41/41 passed.
- Full `npm test` in the default sandbox: 126/133 passed; the 7 known server-security tests could not bind `127.0.0.1` (`EPERM`).
- Full `npm test` with loopback permission: 133/133 passed.
- Focused Electron E2E: 6/6 passed using an already-installed complete Electron runtime through `ELECTRON_OVERRIDE_DIST_PATH`; the worktree's incomplete Electron payload was not repaired or installed.
- Syntax checks and `git diff --check`: passed.

## Commit

- `feat: detect hard-subtitle export capability` (this task commit)

## Pre-gate self-review (later resolved)

- The source and tests stay within Task 1 boundaries.
- Capability parsing matches FFmpeg's table rows rather than accepting arbitrary prose containing a capability name.
- A ready fallback candidate wins over an earlier installed-but-limited candidate; otherwise the first installed candidate supplies the truthful limited state.
- At this pre-install checkpoint, the sample gate was intentionally not claimed because the then-current host FFmpeg lacked `ass`. The later controller-run gate below resolves this condition.

## Independent-review fixes

Two Important findings were addressed in a separate follow-up commit without entering Task 2.

### TDD RED

- `node --test tests/environment.test.js`: 29 passed, 1 failed. The new test showed an absolute `ffmpeg-full` path with a missing sibling ffprobe was incorrectly accepted by mixing it with PATH ffprobe.
- Focused Playwright scenario `installed FFmpeg with limited subtitle export`: failed by timing out while waiting for the existing “查看安装方案” button on a truthful `data-status="ready"` FFmpeg row.

### Minimal fixes

- The FFmpeg tool row retains its detected ready status but also exposes the existing installation-plan action whenever `modes.subtitleExport` is not ready.
- Absolute FFmpeg paths now probe only their same-directory sibling ffprobe. The existing `ffmpeg`/`ffprobe` PATH combination remains valid only when the selected FFmpeg candidate is the system command.
- Added the `mac-ffmpeg-limited` E2E scenario to verify the missing-`ass` reason, the unchanged ready tool status, opening the existing `ffmpeg-full` plan, cancellation, and zero installation calls.

### Follow-up verification

- Environment/install tests: 42/42 passed.
- Focused environment-page Electron E2E: 7/7 passed using the previously verified complete local Electron runtime; no Electron installation infrastructure was changed.
- Full `npm test` with loopback permission: 134/134 passed.
- At this code-review checkpoint, no `ffmpeg-full` installation or host-tool modification had yet been performed; the later authorized gate is recorded below.

## Controller-run real capability gate

After explicit user approval, Homebrew installed `ffmpeg-full` 9.0.1_1 as a keg-only formula. The existing linked `ffmpeg` formula was not removed, replaced, or force-linked.

The production environment module then selected one consistent pair:

- FFmpeg: `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`
- ffprobe: `/opt/homebrew/opt/ffmpeg-full/bin/ffprobe`
- `modes.subtitleExport`: `{ status: 'ready', reason: 'ok', blockers: [] }`
- `canContinue`: `true`

Direct probes confirmed the exact `ass` filter, `libx264` and `aac` encoders, the `mp4` muxer, and runnable sibling ffprobe.

The first sample attempt exposed a real font constraint: libass could not open macOS's private PingFang file and did not draw Chinese glyphs. A single bounded retry used the publicly readable macOS `Heiti SC` font; it produced a one-second MP4 with visible text `第一周期：中文字幕验收` and an audible 660 Hz AAC track. The extracted frame was visually inspected, ffprobe reported H.264 640×360 video plus 48 kHz mono AAC audio and exactly 1.000 seconds, and `volumedetect` reported mean -21.0 dB / max -12.7 dB.

Evidence (not committed):

- video: `/private/tmp/srtp-cycle0.t4thPX/chinese-subtitle-audio-heiti.mp4`
- frame: `/private/tmp/srtp-cycle0.t4thPX/frame-heiti.png`
- SHA-256: `6974886e7387dfcdeb5465968d1fca8cf05ea20bb57cb75aed46e161440aa4b1`

The plan's fixed Mac font was corrected from PingFang SC to the verified Heiti SC. No font downloader, font manager, or cross-platform generalization was added.

Result: Task 1's real subtitle capability gate is passed. Tasks 2–6 remain outside the currently authorized cycle and were not started.

Fresh final verification after the gate: environment/install tests 42/42, focused environment-page Electron E2E 7/7, full `npm test` 134/134, and `git diff --check` passed.
