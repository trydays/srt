# Task 1 Report: Hard-Subtitle Export Capability Detection

## Status

Implementation complete. The real one-second Chinese hard-subtitle sample gate remains pending the controller's authorized `ffmpeg-full` installation/capability check; this task did not install or modify host tools.

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
- An absolute FFmpeg candidate first checks its sibling ffprobe, then the existing system ffprobe combination.
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

## Self-review and remaining concern

- The source and tests stay within Task 1 boundaries.
- Capability parsing matches FFmpeg's table rows rather than accepting arbitrary prose containing a capability name.
- A ready fallback candidate wins over an earlier installed-but-limited candidate; otherwise the first installed candidate supplies the truthful limited state.
- The real sample gate is intentionally not claimed: the current host FFmpeg lacks `ass`, and the controller must install/authorize `ffmpeg-full`, rerun the probes, generate the one-second Chinese audible sample, and inspect text and sound before Task 2 begins.
