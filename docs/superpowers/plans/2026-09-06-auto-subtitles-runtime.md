# Auto Subtitles Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在桌面版导入一段真实视频并输入“给视频加字幕”后，所选本地 CLI 返回严格字幕指令，SRT 使用已准备的 Whisper Small 在本机转录，并在当前项目中生成可同步预览、修改文字和整批撤销的字幕。

**Architecture:** 保留现有 Electron 主进程、preload、淡入接口与经典脚本页面结构，只并行增加一条窄字幕链路。主进程用固定 Python、固定模型目录和固定脚本转录；renderer 只接收经过校验的字幕片段，并通过项目级状态模块原子替换字幕。为避免 renderer 用关键词决定执行路径，新增加一个只允许“字幕或既有淡入”两种结果的 Agent 分类入口，但不删除、不重命名旧淡入接口，也不把它扩展成通用编辑协议。

**Tech Stack:** Electron 33、Node.js 内置测试运行器、Playwright Electron、Python 3.12、faster-whisper Small、浏览器 localStorage 与 IndexedDB；不增加 npm 或 Python 依赖。

## Global Constraints

- 实施基线固定为 `8e33dca703b06685d2fad715145bd7fc14ad457a`。
- 实施目标为 245 分钟，硬上限为 5 小时；已完成的模型准备不再计入，剩余时间不是必须消耗的额度。
- 支撑性工作目标 40 分钟、硬上限 75 分钟，只包括媒体路径和字幕进程桥接。
- 实际执行顺序固定为 Task 3 → Task 6 → Task 2 → Task 4 → Task 1 → Task 5 → Task 7 → Task 8。
- 完成 Task 3 和 Task 6 后，约第 70 分钟必须使用固定字幕片段在真实编辑器中看到字幕轨和画面字幕；否则停止并报告。该里程碑只证明用户界面，不冒充真实转录已经接通。
- 新增 Agent 分类入口只接受 `{"type":"generate_subtitles"}` 或已有 `{"type":"add_effect","effect":"fade_in"}`；不增加第三种编辑指令。
- 原有 `translateEffect()`、`local-cli:translate-effect`、`translateLocalCliEffect()` 的定义与直接测试保持原样，不得删除、重命名或借机重构。共享输入框会改用新增的两结果分类入口，以避免 renderer 关键词路由；分类为淡入后仍调用原有 `applyLocalCliEffect()`。这是对既有用户流程唯一允许的接线变化。
- renderer 不得用“是否包含字幕”等关键词决定执行路径，必须使用本地 CLI 返回的严格结构化结果。
- 固定使用应用管理的 Python 3.12 和 `models/faster-whisper-small`；必需文件为 `model.bin`、`config.json`、`tokenizer.json`、`vocabulary.txt`。
- 不接受 Agent 返回的命令、Python 参数、文件路径或模型名称；renderer 只从当前项目读取由
  `webUtils.getPathForFile` 保存的 `video.path`，主进程负责验证它是存在的绝对文件路径。
  本阶段不建设主进程项目注册表，也不声称能够验证 renderer 传入路径的来源；转录始终使用
  SRT 固定参数数组，且 `shell: false`。
- 不改产品主色，不做字幕样式、翻译、说话人识别、时间调整、完整多轨、导出或组件库改造。
- 不建立通用撤销栈，只保存最近一次成功生成字幕之前的一份字幕快照。
- 转换、转录、校验或持久化任一步失败时，不得覆盖已有字幕或撤销快照。
- 不修改旧的直接命令执行链；本阶段只证明新的字幕路径从不调用它，旧链另立任务处理。
- 任何新增工作只有满足下列任意一项才能进入本阶段：不做就无法通过既定验收；不做会造成现实的安全、法律或数据损失风险；用户了解成本后明确批准。否则写入“以后再做”，不得顺手实现。

## Stage Exit Conditions

满足以下全部条件后立即结束，不继续顺手完善：

1. 当前 Mac 上已准备的 Small 模型可以转录一段短中文口播视频。
2. 用户输入“给视频加字幕”后，只产生一条字幕轨和带起止时间的字幕块。
3. 播放进入字幕时间段时，画面显示对应文字；离开后隐藏。
4. 用户修改字幕文字后，字幕块、画面和当前项目存储同步更新，刷新后仍存在。
5. 首次生成后的撤销恢复空轨；重新生成后的撤销恢复包含用户修改的上一版字幕。
6. 失败时同一张处理卡显示可读原因，且原字幕保持不变。

## Support Budget

| 支撑项 | 硬上限 | 超限动作 |
|---|---:|---|
| 当前项目视频路径（Task 4） | 目标 15 分钟；硬上限 30 分钟 | 停止并报告，不迁移 Blob、不建设媒体资产层 |
| 主进程与 preload 字幕桥接（Task 5） | 目标 25 分钟；硬上限 45 分钟 | 停止并报告，不抽象通用任务或 IPC 框架 |
| 支撑工作合计 | 目标 40 分钟；硬上限 75 分钟 | 达到硬上限立即停止支撑开发，保留已验证成果 |

## Task Budget

| 任务 | 目标预算 |
|---|---:|
| Task 1 并行增加严格分类入口 | 20 分钟 |
| Task 2 固定转录服务 | 35 分钟 |
| Task 3 项目字幕状态 | 30 分钟 |
| Task 4 当前视频路径 | 15 分钟 |
| Task 5 两个新增窄 IPC | 25 分钟 |
| Task 6 字幕轨与画面预览 | 40 分钟 |
| Task 7 对话生成、编辑与撤销 | 45 分钟 |
| Task 8 回归与真实验收 | 35 分钟 |

合计目标 245 分钟，距离 5 小时硬上限保留 55 分钟缓冲；任何单项超过目标预算两倍时立即停止并报告。验收提前通过时不得用缓冲时间继续完善。

## Required Execution Order

任务编号用于对应文件边界，不表示执行先后。实施者必须按下列顺序执行：

1. Task 3：先建立最小项目字幕状态。
2. Task 6：用固定片段做出真实字幕轨、画面字幕和文字编辑；累计目标 70 分钟。
3. Task 2：接入固定本地转录服务。
4. Task 4：只保存首页导入文件的稳定路径。
5. Task 1：并行新增严格的“字幕或淡入”Agent 分类入口，旧淡入入口不动。
6. Task 5：增加分类与字幕生成 IPC。
7. Task 7：把真实字幕生成接入现有压缩对话卡。
8. Task 8：验证一层撤销、一个代表性失败场景、全量回归和真实 Mac。

不得为了让编号连续而改回 Task 1 → Task 8 的顺序；第一个用户可见成果必须先于转录与 IPC 完整接通。

## File Map

### New files

- `src/subtitles.js`：主进程字幕服务、固定路径计算、进程调用、片段校验和稳定错误码。
- `resources/tools/transcribe-subtitles.py`：唯一 Python 转录入口，只输出字幕 JSON。
- `app/subtitle-state.js`：项目级字幕状态、文字修改和一层撤销。
- `app/editor-subtitles.js`：字幕轨、画面字幕和文字编辑器控制器。
- `tests/subtitles.test.js`：字幕服务单元测试。
- `tests/subtitle-state.test.js`：项目字幕状态单元测试。
- `tests/e2e/auto-subtitles-flow.spec.js`：确定性字幕编辑器流程测试。

### Modified files

- `src/local-cli.js`：保留现有单效果接口，并行增加只允许字幕或淡入的严格分类入口。
- `main.js`：保留旧淡入 IPC，创建字幕服务，并增加严格分类与字幕生成两个窄 IPC。
- `preload.js`：保留旧淡入 API，增加严格分类、字幕生成和 `webUtils.getPathForFile` 的窄接口。
- `app/shared.js`：新增字幕存储 key、按 ID 读取/更新项目的 helper。
- `app/主页.html`：保留现有全局预览 Blob，只在当前项目元数据中记录稳定路径。
- `app/editor-core.js`：沿用现有预览恢复流程，从当前项目恢复稳定路径；不扩展重新导入流程。
- `app/剪辑.html`：增加字幕轨、字幕编辑框和画面字幕容器；加载两个新脚本。
- `app/editor-timeline.js`：按结构化指令增加一个明确字幕分支，在现有两行卡片中切换为固定“生成字幕”文案；不建立通用操作状态模型。
- `tests/local-cli.test.js`：保留淡入测试，追加严格分类入口测试。
- `tests/main-entry.test.js`：保留旧淡入断言，追加新的窄 IPC 和 preload API 断言。
- `tests/e2e/electron-main.js`：注入确定性的字幕服务 fake。
- `tests/e2e/electron.fixture.js`：增加字幕结果场景选项。
- `package.json`：把字幕 E2E 加入现有 E2E 命令。

---

### Task 1: Add a Parallel, Strict Subtitle-or-Fade-In Classifier

**Files:**
- Modify: `tests/local-cli.test.js`
- Modify: `src/local-cli.js`

**Interfaces:**
- Consumes: 已有 CLI 扫描、显式选择和固定 `execFile(file, args)` 调用。
- Produces: `translateSubtitleOrFadeIn(text): Promise<{type:'generate_subtitles'} | {type:'add_effect',effect:'fade_in'}>`；现有 `translateEffect(text)` 不变。

- [ ] **Step 1: Append classifier tests without replacing the existing effect tests**

在 `tests/local-cli.test.js` 保留现有扫描、选择和 `translateEffect()` 测试，追加：

```js
test('translates a subtitle request into the only subtitle instruction', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { calls, run } = fakeTranslator('{"type":"generate_subtitles"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateSubtitleOrFadeIn('给视频加字幕'), {
    type: 'generate_subtitles'
  });
  assert.equal(calls.length, 1);
});

test('keeps the existing fade-in instruction as a regression capability', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const { run } = fakeTranslator('{"type":"add_effect","effect":"fade_in"}');
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  assert.deepEqual(await service.translateSubtitleOrFadeIn('给片头添加淡入'), {
    type: 'add_effect', effect: 'fade_in'
  });
});

test('reports a killed CLI translation as a timeout', async () => {
  const fsApi = fakeFs(['/bin/codex']);
  const timeout = Object.assign(new Error('timed out'), { killed: true });
  const { run } = fakeTranslator(timeout);
  const service = createLocalCliService({
    platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
    fsApi, run: async () => ({ exitCode: 0 }), translate: run
  });
  await service.select('codex');
  await assert.rejects(
    () => service.translateSubtitleOrFadeIn('给视频加字幕'),
    { code: 'LOCAL_CLI_TRANSLATION_TIMEOUT' }
  );
});

for (const output of [
  'not json',
  '{}',
  '[{"type":"generate_subtitles"}]',
  '{"type":"generate_subtitles","language":"zh"}',
  '{"type":"trim","start":0,"end":2}'
]) {
  test(`rejects unsupported instruction output: ${output}`, async () => {
    const fsApi = fakeFs(['/bin/codex']);
    const { run } = fakeTranslator(output);
    const service = createLocalCliService({
      platform: 'darwin', env: { PATH: '/bin' }, homeDir: '/Users/a', userDataDir: '/prefs',
      fsApi, run: async () => ({ exitCode: 0 }), translate: run
    });
    await service.select('codex');
    await assert.rejects(
      () => service.translateSubtitleOrFadeIn('任意请求'),
      { code: 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT' }
    );
  });
}
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```bash
node --test tests/local-cli.test.js
```

Expected: existing `translateEffect()` tests PASS; new tests FAIL because `translateSubtitleOrFadeIn` and `LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT` do not exist.

- [ ] **Step 3: Implement the minimal strict parser and prompt**

在 `src/local-cli.js` 保留 `EFFECT_PROMPT`、`parseEffectInstruction()` 和 `translateEffect()` 原样，并行加入以下固定 prompt/parser；复用现有 CLI 参数表：

```js
const SUBTITLE_OR_FADE_IN_PROMPT = [
  '判断用户的视频编辑请求，只输出下列两个 JSON 对象之一：',
  '整段视频生成或添加字幕：{"type":"generate_subtitles"}',
  '片头添加淡入：{"type":"add_effect","effect":"fade_in"}',
  '不支持的请求输出空对象 {}。',
  '不要解释、Markdown、命令或额外字段。用户请求：'
].join('\n');

function invalidInstructionOutputError() {
  const error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function instructionTranslationError(cause) {
  const code = cause && (cause.killed || cause.code === 'ETIMEDOUT')
    ? 'LOCAL_CLI_TRANSLATION_TIMEOUT' : 'LOCAL_CLI_TRANSLATION_FAILED';
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseSubtitleOrFadeInInstruction(output) {
  let value;
  try {
    value = JSON.parse(String(output).trim());
  } catch (_) {
    throw invalidInstructionOutputError();
  }
  if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw invalidInstructionOutputError();
  }
  const keys = Object.keys(value).sort();
  if (keys.length === 1 && keys[0] === 'type' && value.type === 'generate_subtitles') {
    return { type: 'generate_subtitles' };
  }
  if (keys.length === 2 && keys[0] === 'effect' && keys[1] === 'type'
      && value.type === 'add_effect' && value.effect === 'fade_in') {
    return { type: 'add_effect', effect: 'fade_in' };
  }
  throw invalidInstructionOutputError();
}
```

把 service 方法改为：

```js
async function translateSubtitleOrFadeIn(text) {
  const available = await scan();
  const selectedCliId = await readSelection();
  if (!selectedCliId) throw notSelectedError();
  const selectedCli = available.find((item) => item.id === selectedCliId);
  if (!selectedCli) throw unavailableError();
  const argsFactory = EFFECT_ARGS[selectedCliId];
  if (typeof argsFactory !== 'function') throw translationFailedError();
  let output;
  try {
    output = await translateEffectOutput(
      selectedCli.file,
      argsFactory(SUBTITLE_OR_FADE_IN_PROMPT + String(text || ''))
    );
  } catch (error) {
    throw instructionTranslationError(error);
  }
  return parseSubtitleOrFadeInInstruction(output);
}
```

service 只追加新方法；不得把旧方法指向新 parser：

```js
return {
  getState: () => state(),
  rescan: () => state(),
  select: (id) => state(id),
  translateEffect,
  translateSubtitleOrFadeIn
};
```

- [ ] **Step 4: Re-run the focused tests**

Run:

```bash
node --test tests/local-cli.test.js
```

Expected: all local CLI tests PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add src/local-cli.js tests/local-cli.test.js
git commit -m "feat: add strict subtitle request classifier"
```

---

### Task 2: Build the Fixed Local Transcription Service

**Files:**
- Create: `tests/subtitles.test.js`
- Create: `src/subtitles.js`
- Create: `resources/tools/transcribe-subtitles.py`

**Interfaces:**
- Consumes: `userDataDir`, current platform, an absolute user-selected `videoPath`, and the already prepared model directory.
- Produces: `createSubtitleService(options).generate({videoPath}): Promise<{segments:Array<{start:number,end:number,text:string}>}>`.

- [ ] **Step 1: Write service tests for fixed arguments, minimal validation and failures**

创建 `tests/subtitles.test.js`，包含以下 fixture 和断言：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleService } = require('../src/subtitles');

function createFixture({ stdout = '[]', runError = null, missing = [] } = {}) {
  const calls = [];
  return {
    calls,
    service: createSubtitleService({
      platform: 'darwin',
      userDataDir: '/user-data',
      transcriberPath: '/app/resources/tools/transcribe-subtitles.py',
      fsApi: {
        async stat(file) {
          if (missing.some((suffix) => file.endsWith(suffix))) {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          }
          return { isFile: () => true, size: 1 };
        }
      },
      run: async (program, args, options) => {
        calls.push({ program, args, options });
        if (runError) throw runError;
        return { stdout, stderr: '' };
      }
    })
  };
}

test('runs only the managed Python, fixed script, model directory and selected video', async () => {
  const fixture = createFixture({
    stdout: '[{"start":0.4,"end":1.2,"text":"第一句"},{"start":2,"end":3,"text":" 第二句 "}]'
  });
  const result = await fixture.service.generate({ videoPath: '/videos/talk.mp4' });
  assert.deepEqual(result.segments, [
    { start: 0.4, end: 1.2, text: '第一句' },
    { start: 2, end: 3, text: '第二句' }
  ]);
  assert.deepEqual(fixture.calls, [{
    program: '/user-data/python/bin/python',
    args: [
      '/app/resources/tools/transcribe-subtitles.py',
      '--model-dir', '/user-data/models/faster-whisper-small',
      '--video', '/videos/talk.mp4'
    ],
    options: { timeout: 300000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false }
  }]);
});

for (const stdout of [
  'not-json',
  '{}',
  '[{"start":0,"end":0,"text":"x"}]',
  '[{"start":0,"end":1,"text":"   "}]',
  '[{"start":0,"end":1,"text":"x","extra":true}]'
]) {
  test(`rejects the entire invalid result: ${stdout}`, async () => {
    const { service } = createFixture({ stdout });
    await assert.rejects(
      () => service.generate({ videoPath: '/videos/talk.mp4' }),
      { code: 'SUBTITLE_INVALID_OUTPUT' }
    );
  });
}

test('classifies empty speech without returning an empty track', async () => {
  const { service } = createFixture({ stdout: '[]' });
  await assert.rejects(
    () => service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_NO_SPEECH' }
  );
});

test('rejects a missing video before starting Python', async () => {
  const fixture = createFixture({ missing: ['talk.mp4'] });
  await assert.rejects(
    () => fixture.service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'VIDEO_PATH_UNAVAILABLE' }
  );
  assert.equal(fixture.calls.length, 0);
});

test('rejects a missing managed runtime or model before transcription', async () => {
  const fixture = createFixture({ missing: ['model.bin'] });
  await assert.rejects(
    () => fixture.service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_RUNTIME_NOT_READY' }
  );
  assert.equal(fixture.calls.length, 0);
});

test('classifies a child process failure without exposing command execution', async () => {
  const { service } = createFixture({ runError: new Error('python failed') });
  await assert.rejects(
    () => service.generate({ videoPath: '/videos/talk.mp4' }),
    { code: 'SUBTITLE_TRANSCRIPTION_FAILED' }
  );
});
```

- [ ] **Step 2: Run the test and verify it fails because the service is absent**

```bash
node --test tests/subtitles.test.js
```

Expected: FAIL with `Cannot find module '../src/subtitles'`.

- [ ] **Step 3: Implement the Node service with a fixed runner**

创建 `src/subtitles.js`，实现并导出以下完整公共边界：

```js
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MODEL_FILES = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'];

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function defaultRun(program, args, options) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(program, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function parseSegments(stdout) {
  let value;
  try { value = JSON.parse(String(stdout).trim()); }
  catch (_) { throw codedError('SUBTITLE_INVALID_OUTPUT'); }
  if (!Array.isArray(value)) throw codedError('SUBTITLE_INVALID_OUTPUT');
  if (value.length === 0) throw codedError('SUBTITLE_NO_SPEECH');
  const segments = value.map((segment) => {
    if (!segment || Array.isArray(segment) || Object.getPrototypeOf(segment) !== Object.prototype
        || Object.keys(segment).sort().join(',') !== 'end,start,text'
        || !Number.isFinite(segment.start) || segment.start < 0
        || !Number.isFinite(segment.end) || segment.end <= segment.start
        || typeof segment.text !== 'string' || !segment.text.trim()) {
      throw codedError('SUBTITLE_INVALID_OUTPUT');
    }
    return { start: segment.start, end: segment.end, text: segment.text.trim() };
  });
  return segments;
}

function createSubtitleService({
  platform = process.platform,
  userDataDir,
  transcriberPath,
  fsApi = fs.promises,
  run = defaultRun
}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const managedPython = platform === 'win32'
    ? pathApi.join(userDataDir, 'python', 'Scripts', 'python.exe')
    : pathApi.join(userDataDir, 'python', 'bin', 'python');
  const modelDir = pathApi.join(userDataDir, 'models', 'faster-whisper-small');

  async function requireFile(file, errorCode) {
    try {
      const stat = await fsApi.stat(file);
      if (!stat.isFile() || stat.size <= 0) throw new Error('not a usable file');
    } catch (_) {
      throw codedError(errorCode);
    }
  }

  async function generate({ videoPath } = {}) {
    if (typeof videoPath !== 'string' || !pathApi.isAbsolute(videoPath)) {
      throw codedError('VIDEO_PATH_UNAVAILABLE');
    }
    await requireFile(videoPath, 'VIDEO_PATH_UNAVAILABLE');
    await requireFile(managedPython, 'SUBTITLE_RUNTIME_NOT_READY');
    await requireFile(transcriberPath, 'SUBTITLE_RUNTIME_NOT_READY');
    for (const fileName of MODEL_FILES) {
      await requireFile(pathApi.join(modelDir, fileName), 'SUBTITLE_RUNTIME_NOT_READY');
    }
    let result;
    try {
      result = await run(managedPython, [
        transcriberPath, '--model-dir', modelDir, '--video', videoPath
      ], {
        timeout: 300000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        shell: false
      });
    } catch (_) {
      throw codedError('SUBTITLE_TRANSCRIPTION_FAILED');
    }
    return { segments: parseSegments(result.stdout) };
  }

  return { generate };
}

module.exports = { createSubtitleService, parseSegments };
```

- [ ] **Step 4: Add the fixed Python transcriber outside the packaged ASAR**

创建 `resources/tools/transcribe-subtitles.py`：

```python
import argparse
import json
import sys

from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--video", required=True)
    args = parser.parse_args()

    model = WhisperModel(args.model_dir, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(args.video)
    payload = [
        {"start": float(item.start), "end": float(item.end), "text": item.text.strip()}
        for item in segments
        if item.text and item.text.strip()
    ]
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
```

不加入语言、模型、输出文件或 FFmpeg 参数。

- [ ] **Step 5: Run focused tests and compile-check the script**

```bash
node --test tests/subtitles.test.js
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("resources/tools/transcribe-subtitles.py").read_text())'
```

Expected: Node tests PASS; 当前 Mac 的 Python 语法检查 exits 0 and prints nothing。该命令不是 Windows 验收项。

- [ ] **Step 6: Commit the fixed transcription boundary**

```bash
git add src/subtitles.js resources/tools/transcribe-subtitles.py tests/subtitles.test.js
git commit -m "feat: add fixed local subtitle transcriber"
```

---

### Task 3: Add Project-Scoped Subtitle State and One-Level Undo

**Files:**
- Create: `tests/subtitle-state.test.js`
- Create: `app/subtitle-state.js`
- Modify: `app/shared.js`

**Interfaces:**
- Consumes: `localStorage`, current `projectId`, validated segments, and request ID.
- Produces: `createSubtitleStore(storage, idFactory)` with `get`, `replace`, `updateText`, `canUndo`, and `undo`.

- [ ] **Step 1: Write state tests for isolation, edits and exact undo semantics**

创建 `tests/subtitle-state.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubtitleStore } = require('../app/subtitle-state');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function fixture() {
  let id = 0;
  return createSubtitleStore(memoryStorage(), () => `segment-${++id}`);
}

test('keeps subtitles isolated by project', () => {
  const store = fixture();
  store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: 'A' }]);
  assert.equal(store.get('project-a').segments[0].text, 'A');
  assert.deepEqual(store.get('project-b').segments, []);
});

test('first generation can be undone exactly once to an empty track', () => {
  const store = fixture();
  store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '初版' }]);
  assert.equal(store.canUndo('project-a', 'request-a'), true);
  assert.deepEqual(store.undo('project-a', 'request-a').segments, []);
  assert.equal(store.canUndo('project-a', 'request-a'), false);
  assert.throws(() => store.undo('project-a', 'request-a'), { code: 'SUBTITLE_UNDO_UNAVAILABLE' });
});

test('regeneration snapshots user-edited current subtitles', () => {
  const store = fixture();
  const first = store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '初版' }]);
  store.updateText('project-a', first.segments[0].id, '人工修改版');
  store.replace('project-a', 'request-b', [{ start: 0, end: 1, text: '重生成版' }]);
  const restored = store.undo('project-a', 'request-b');
  assert.equal(restored.segments[0].text, '人工修改版');
});

test('rejects an empty edited subtitle without changing storage', () => {
  const store = fixture();
  const state = store.replace('project-a', 'request-a', [{ start: 0, end: 1, text: '保留' }]);
  assert.throws(
    () => store.updateText('project-a', state.segments[0].id, '   '),
    { code: 'SUBTITLE_TEXT_REQUIRED' }
  );
  assert.equal(store.get('project-a').segments[0].text, '保留');
});
```

- [ ] **Step 2: Run the state tests and verify the module is absent**

```bash
node --test tests/subtitle-state.test.js
```

Expected: FAIL with `Cannot find module '../app/subtitle-state'`.

- [ ] **Step 3: Implement a narrow store with copy-before-write semantics**

创建 `app/subtitle-state.js`，以 UMD 形式同时支持浏览器和 Node 测试。公共接口固定如下：

```js
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTSubtitleState = api;
})(typeof window === 'undefined' ? null : window, function() {
  var STORAGE_KEY = 'srt_project_subtitles';

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSubtitleStore(storage, idFactory) {
    function readAll() {
      try {
        var value = JSON.parse(storage.getItem(STORAGE_KEY));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (_) { return {}; }
    }
    function emptyState() { return { segments: [], undo: null }; }
    function get(projectId) {
      var state = readAll()[projectId];
      return clone(state && Array.isArray(state.segments) ? state : emptyState());
    }
    function write(projectId, state) {
      var all = readAll();
      all[projectId] = clone(state);
      storage.setItem(STORAGE_KEY, JSON.stringify(all));
      return clone(state);
    }
    function replace(projectId, requestId, rawSegments) {
      var current = get(projectId);
      var nextSegments = rawSegments.map(function(segment) {
        return { id: idFactory(), start: segment.start, end: segment.end, text: segment.text };
      });
      return write(projectId, {
        segments: nextSegments,
        undo: { requestId: requestId, segments: current.segments }
      });
    }
    function updateText(projectId, segmentId, text) {
      var value = String(text || '').trim();
      if (!value) throw codedError('SUBTITLE_TEXT_REQUIRED');
      var state = get(projectId);
      var found = false;
      state.segments = state.segments.map(function(segment) {
        if (segment.id !== segmentId) return segment;
        found = true;
        return Object.assign({}, segment, { text: value });
      });
      if (!found) throw codedError('SUBTITLE_SEGMENT_NOT_FOUND');
      return write(projectId, state);
    }
    function canUndo(projectId, requestId) {
      var undo = get(projectId).undo;
      return !!undo && undo.requestId === requestId;
    }
    function undo(projectId, requestId) {
      var state = get(projectId);
      if (!state.undo || state.undo.requestId !== requestId) {
        throw codedError('SUBTITLE_UNDO_UNAVAILABLE');
      }
      return write(projectId, { segments: state.undo.segments, undo: null });
    }
    return { get: get, replace: replace, updateText: updateText, canUndo: canUndo, undo: undo };
  }

  return { STORAGE_KEY: STORAGE_KEY, createSubtitleStore: createSubtitleStore };
});
```

- [ ] **Step 4: Register the storage key and current-project lookup**

在 `app/shared.js` 的 `STORAGE_KEYS` 加入：

```js
PROJECT_SUBTITLES: 'srt_project_subtitles',
```

并加入：

```js
function getProjectById(projectId) {
  var projects = getProjects();
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].id === projectId) return projects[i];
  }
  return null;
}

```

- [ ] **Step 5: Run the focused tests**

```bash
node --test tests/subtitle-state.test.js
```

Expected: all subtitle state tests PASS.

- [ ] **Step 6: Commit project subtitle state**

```bash
git add app/subtitle-state.js app/shared.js tests/subtitle-state.test.js
git commit -m "feat: persist project subtitle state"
```

---

### Task 4: Preserve Only the Stable Video Path Needed for Transcription

**Files:**
- Modify: `preload.js`
- Modify: `app/主页.html`
- Modify: `app/editor-core.js`
- Modify: `tests/main-entry.test.js`
- Test: `tests/e2e/home-workbench-flow.spec.js`

**Interfaces:**
- Consumes: a user-selected renderer `File` and `webUtils.getPathForFile(file)`.
- Produces: `project.video.path` and `window.currentProjectVideoPath`.
- Leaves unchanged: the existing `current_video` IndexedDB preview Blob. Project-level Blob migration remains explicitly deferred.

- [ ] **Step 1: Add a preload contract test for the narrow file-path helper**

在 `tests/main-entry.test.js` 的 preload test 加入：

```js
assert.match(preloadSource, /getPathForFile: \(file\) => webUtils\.getPathForFile\(file\)/);
assert.equal(preloadSource.includes('readFile'), false);
assert.equal(preloadSource.includes('writeFile'), false);
```

- [ ] **Step 2: Run the preload contract test and verify it fails**

```bash
node --test tests/main-entry.test.js
```

Expected: FAIL because `webUtils` and `getPathForFile` are not exposed.

- [ ] **Step 3: Expose only Electron's selected-file path helper**

对 `preload.js` 做以下精确增量修改：

```diff
-const { contextBridge, ipcRenderer } = require('electron');
+const { contextBridge, ipcRenderer, webUtils } = require('electron');
 contextBridge.exposeInMainWorld('srtAPI', {
+  getPathForFile: (file) => webUtils.getPathForFile(file),
   openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
```

不增加 `readFile`、`writeFile` 或目录访问 API。

- [ ] **Step 4: Record the selected path without changing existing Blob storage**

保留现有 `current_video` IndexedDB 写入、上传卡片和 `startEditing` 流程，只把
`handleFile` 写入的 metadata 改为包含 Electron 选择路径：

```diff
 function handleFile(f){
   if(!f||!f.type.startsWith('video/'))return;
+  var localPath = null;
+  try { localPath = window.srtAPI.getPathForFile(f) || null; } catch (_) {}
+  var videoInfo = {
+    name: f.name,
+    size: f.size,
+    type: f.type,
+    lastMod: f.lastModified,
+    path: localPath
+  };
+  try { localStorage.setItem(STORAGE_KEYS.VIDEO, JSON.stringify(videoInfo)); }
+  catch(e) { console.error('[handleFile] localStorage 写入失败:', e.message); }
-  try { localStorage.setItem(STORAGE_KEYS.VIDEO, JSON.stringify({ name: f.name, size: f.size, type: f.type, lastMod: f.lastModified })); } catch(e) { console.error('[handleFile] localStorage 写入失败:', e.message); }
   /* Store video blob in IndexedDB; wait for transaction before allowing navigation */
```

- [ ] **Step 5: Restore the current project's stable path in the editor**

保留 `app/editor-core.js` 对全局 `current_video` 的现有预览读取，在初始化视频变量后加入：

```js
var activeProject = getProjectById(getActiveProjectId());
window.currentProjectVideoPath = activeProject && activeProject.video
  ? activeProject.video.path || null : null;
```

现有编辑器内 `reupload` 处理器保持原样。本阶段不为重新导入同步项目路径；如果用户重新导入后请求字幕，状态卡提示“请从首页重新导入视频后再生成字幕”。该行为进入“以后再做”。

- [ ] **Step 6: Run focused and existing home regressions**

```bash
node --test tests/main-entry.test.js
npx playwright test tests/e2e/home-workbench-flow.spec.js
```

Expected: both commands PASS; recent project creation and editor navigation still work.

- [ ] **Step 7: Commit the stable media input**

```bash
git add preload.js app/主页.html app/editor-core.js tests/main-entry.test.js
git commit -m "feat: keep project video path for subtitles"
```

---

### Task 5: Wire Narrow Main-Process Subtitle IPC

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `tests/main-entry.test.js`
- Modify: `tests/e2e/electron-main.js`
- Modify: `tests/e2e/electron.fixture.js`

**Interfaces:**
- Consumes: Task 1 `translateSubtitleOrFadeIn(text)` and Task 2 `subtitleService.generate({videoPath})`.
- Produces: `translateSubtitleOrFadeIn(text): Promise<{ok:true,instruction:{type:'generate_subtitles'}|{type:'add_effect',effect:'fade_in'}}|{ok:false,errorCode:string}>` and `generateSubtitles({videoPath}): Promise<{ok:true,segments:Array<{start:number,end:number,text:string}>}|{ok:false,errorCode:string}>`；旧 `translateLocalCliEffect(text)` 继续存在且返回形状不变。

- [ ] **Step 1: Add source-contract assertions for the two dedicated IPC routes**

在 `tests/main-entry.test.js` 保留对 `local-cli:translate-effect` 与
`translateLocalCliEffect` 的旧断言，并追加：

```js
assert.match(mainSource, /ipcMain\.handle\('local-cli:translate-subtitle-or-fade-in'/);
assert.match(mainSource, /ipcMain\.handle\('subtitles:generate'/);
assert.match(preloadSource, /translateSubtitleOrFadeIn: \(text\) => ipcRenderer\.invoke\('local-cli:translate-subtitle-or-fade-in', text\)/);
assert.match(preloadSource, /generateSubtitles: \(request\) => ipcRenderer\.invoke\('subtitles:generate', request\)/);
assert.equal(preloadSource.includes('subtitle:exec'), false);
```

- [ ] **Step 2: Run the contract test and verify it fails**

```bash
node --test tests/main-entry.test.js
```

Expected: FAIL because neither route exists.

- [ ] **Step 3: Construct the service and return stable envelopes**

在 `main.js` 引入 `createSubtitleService`，并把 `startApplication` 改为接受 fake：

```js
const { createSubtitleService } = require('./src/subtitles');

function publicFailure(error, fallback) {
  return { ok: false, errorCode: error && error.code ? error.code : fallback };
}

function startApplication({ environmentModule, localCliService, subtitleService } = {}) {
  const userDataDir = app.getPath('userData');
  const bundledRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'tools')
    : path.join(__dirname, 'resources', 'tools');
  const activeEnvironment = environmentModule || createProductionEnvironment({
    targetPath: userDataDir, userDataDir, bundledRoot
  });
  const activeLocalCliService = localCliService || createLocalCliService({ userDataDir });
  const activeSubtitleService = subtitleService || createSubtitleService({
    userDataDir,
    transcriberPath: path.join(bundledRoot, 'transcribe-subtitles.py')
  });

  // Keep the existing local-cli:translate-effect handler unchanged.
  ipcMain.handle('local-cli:translate-subtitle-or-fade-in', async (_event, text) => {
    try {
      return {
        ok: true,
        instruction: await activeLocalCliService.translateSubtitleOrFadeIn(text)
      };
    } catch (error) {
      return publicFailure(error, 'LOCAL_CLI_TRANSLATION_FAILED');
    }
  });
  ipcMain.handle('subtitles:generate', async (_event, request) => {
    try {
      const result = await activeSubtitleService.generate(request);
      return { ok: true, segments: result.segments };
    } catch (error) {
      return publicFailure(error, 'SUBTITLE_TRANSCRIPTION_FAILED');
    }
  });

  // 本函数中现有环境、CLI 选择和 Electron 生命周期注册保持原样。
}
```

不得删除或改写旧的 `local-cli:translate-effect` IPC、`translateEffect()` 或 `cli:exec`；字幕路径不得调用 `cli:exec`。

- [ ] **Step 4: Append only the two new renderer operations**

在 `preload.js` 保留 `translateLocalCliEffect`，追加：

```js
translateSubtitleOrFadeIn: (text) => ipcRenderer.invoke('local-cli:translate-subtitle-or-fade-in', text),
generateSubtitles: (request) => ipcRenderer.invoke('subtitles:generate', request),
```

- [ ] **Step 5: Extend the existing E2E fake with one subtitle result option**

在 `tests/e2e/electron.fixture.js` 增加 option：

```js
subtitleResult: ['success', { option: true }],
```

把 `electronContext` 的 fixture 参数加入 `subtitleResult`：

```diff
-electronContext: async ({ scenario, realEnvironment, localCliMode, localCliEffectResult }, use, testInfo) => {
+electronContext: async ({ scenario, realEnvironment, localCliMode, localCliEffectResult, subtitleResult }, use, testInfo) => {
```

只在 Electron env 中传递结果场景：

```js
SRT_E2E_SUBTITLE_RESULT: subtitleResult,
```

视频测试文件由 `auto-subtitles-flow.spec.js` 使用 `testInfo.outputPath()` 按测试创建，不扩展共享 fixture 生命周期。

在 `tests/e2e/electron-main.js` 保留既有 `translateEffect()` fake，并追加：

```js
async translateSubtitleOrFadeIn(text) {
  if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
    const error = new Error('Invalid local CLI instruction output');
    error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
    throw error;
  }
  if (/字幕/.test(text)) return { type: 'generate_subtitles' };
  return { type: 'add_effect', effect: 'fade_in' };
}

const subtitleService = {
  async generate(request) {
    state.subtitleCalls = (state.subtitleCalls || []).concat([request]);
    if (process.env.SRT_E2E_SUBTITLE_RESULT === 'no-speech') {
      const error = new Error('no speech');
      error.code = 'SUBTITLE_NO_SPEECH';
      throw error;
    }
    return { segments: [
      { start: 0.2, end: 1.4, text: '大家好' },
      { start: 1.6, end: 3.0, text: '欢迎测试自动字幕' }
    ] };
  }
};

startApplication({ environmentModule, localCliService, subtitleService });
```

这里的 `/字幕/` 只用于确定性 E2E fake 选择返回夹具；生产 renderer 不得据此路由，生产结果必须来自本地 CLI。

- [ ] **Step 6: Run focused unit tests**

```bash
node --test tests/main-entry.test.js tests/local-cli.test.js tests/subtitles.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit the IPC bridge**

```bash
git add main.js preload.js tests/main-entry.test.js tests/e2e/electron-main.js tests/e2e/electron.fixture.js
git commit -m "feat: bridge subtitle generation to editor"
```

---

### Task 6: Render One Subtitle Track, Preview Overlay and Text Editor

**Execution note:** Execute this immediately after Task 3. It is intentionally the second implementation task so the user can inspect a real editor surface at about minute 70, before process/IPC work continues.

**Files:**
- Modify: `app/剪辑.html`
- Create: `app/editor-subtitles.js`
- Create: `tests/e2e/auto-subtitles-flow.spec.js`

**Interfaces:**
- Consumes: `videoEl`, `videoDuration`, current project ID, `SRTSubtitleState`, and validated subtitle segments.
- Produces: global `subtitleController` with `replace(requestId,segments)`, `undo(requestId)`, `canUndo(requestId)`, `count()`, and `render()`.

- [ ] **Step 1: Add semantic subtitle DOM without changing the palette**

在 `app/剪辑.html` 的 `<video>` 后加入：

```html
<div class="preview-subtitle" id="previewSubtitle" data-testid="preview-subtitle" hidden></div>
```

在现有时间轴轨下加入：

```html
<section class="subtitle-section" data-testid="subtitle-section">
  <div class="subtitle-track-label">字幕</div>
  <div class="subtitle-track" id="subtitleTrack" data-testid="subtitle-track"></div>
  <label class="subtitle-editor" id="subtitleEditor" hidden>
    <span>字幕文字</span>
    <input id="subtitleTextInput" data-testid="subtitle-text-input" type="text" />
    <button id="subtitleTextSave" data-testid="subtitle-text-save" type="button">保存</button>
  </label>
</section>
```

加入以下最小样式；除视频字幕的中性深色衬底外，只复用现有设计令牌：

```css
.preview-subtitle{position:absolute;left:50%;bottom:7%;z-index:3;max-width:84%;
  transform:translateX(-50%);padding:6px 10px;border-radius:var(--radius-sm);
  background:rgba(0,0,0,.72);color:#fff;font-size:16px;line-height:1.45;
  text-align:center;pointer-events:none}
.preview-subtitle[hidden]{display:none}
.subtitle-section{display:grid;grid-template-columns:42px minmax(0,1fr);gap:6px 8px;
  align-items:center}
.subtitle-track-label{font-size:11px;color:var(--text-muted)}
.subtitle-track{position:relative;height:34px;overflow:hidden;border:1px solid var(--border);
  border-radius:var(--radius-sm);background:var(--bg-panel)}
.subtitle-block{position:absolute;top:4px;height:24px;overflow:hidden;padding:0 6px;
  border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));
  border-radius:var(--radius-sm);background:var(--accent-tint);color:var(--text-strong);
  font:inherit;font-size:10px;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
.subtitle-editor{grid-column:2;display:grid;grid-template-columns:auto minmax(0,1fr) auto;
  gap:8px;align-items:center;font-size:11px;color:var(--text-muted)}
.subtitle-editor[hidden]{display:none}
.subtitle-editor input{min-width:0;height:30px;padding:0 9px;border:1px solid var(--border);
  border-radius:var(--radius-sm);background:var(--bg-panel);color:var(--text);font:inherit}
.subtitle-editor button,.request-undo{height:30px;padding:0 10px;border:1px solid var(--border);
  border-radius:var(--radius-pill);background:var(--bg-panel);color:var(--text);
  font:inherit;font-size:11px;cursor:pointer}
.request-result{margin-top:5px;font-size:10.5px;color:var(--text-muted)}
.request-undo{margin-top:7px}
.request-status-row[data-state="generating"] .request-status-icon{border:2px solid var(--border);
  border-top-color:var(--accent);background:transparent}
```

不要新增字幕颜色、字号或位置设置入口。

在脚本顺序中加入：

```html
<script src="subtitle-state.js"></script>
<script src="editor-subtitles.js"></script>
```

两者放在 `editor-core.js` 之后、`editor-timeline.js` 之前。

- [ ] **Step 2: Implement the focused subtitle controller**

创建 `app/editor-subtitles.js`。控制器必须使用以下公共接口和事务顺序：先写项目状态，写成功后才渲染 DOM。

```js
var subtitleStore = SRTSubtitleState.createSubtitleStore(localStorage, createLocalId);
var subtitleTrack = document.getElementById('subtitleTrack');
var subtitlePreview = document.getElementById('previewSubtitle');
var subtitleEditor = document.getElementById('subtitleEditor');
var subtitleTextInput = document.getElementById('subtitleTextInput');
var subtitleTextSave = document.getElementById('subtitleTextSave');
var selectedSubtitleId = null;

function currentSubtitleState() {
  return subtitleStore.get(getActiveProjectId());
}

function renderSubtitleTrack() {
  var state = currentSubtitleState();
  subtitleTrack.innerHTML = '';
  var duration = videoDuration || 1;
  state.segments.forEach(function(segment) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'subtitle-block';
    button.dataset.segmentId = segment.id;
    button.dataset.testid = 'subtitle-block';
    button.style.left = Math.max(0, segment.start / duration * 100) + '%';
    button.style.width = Math.max(0.8, (segment.end - segment.start) / duration * 100) + '%';
    button.textContent = segment.text;
    subtitleTrack.appendChild(button);
  });
}

function renderCurrentSubtitle() {
  var time = videoEl.currentTime;
  var active = currentSubtitleState().segments.find(function(segment) {
    return time >= segment.start && time < segment.end;
  });
  subtitlePreview.hidden = !active;
  subtitlePreview.textContent = active ? active.text : '';
}

function renderSubtitleEditor() {
  var segment = currentSubtitleState().segments.find(function(item) {
    return item.id === selectedSubtitleId;
  });
  subtitleEditor.hidden = !segment;
  subtitleTextInput.value = segment ? segment.text : '';
}

function renderAllSubtitles() {
  renderSubtitleTrack();
  renderCurrentSubtitle();
  renderSubtitleEditor();
}

subtitleTrack.addEventListener('click', function(event) {
  var block = event.target.closest('[data-segment-id]');
  if (!block) return;
  selectedSubtitleId = block.dataset.segmentId;
  var segment = currentSubtitleState().segments.find(function(item) {
    return item.id === selectedSubtitleId;
  });
  if (segment) {
    try { videoEl.currentTime = segment.start; } catch (_) {}
    subtitlePreview.hidden = false;
    subtitlePreview.textContent = segment.text;
  }
  renderSubtitleEditor();
});

function saveSelectedSubtitle() {
  if (!selectedSubtitleId) return false;
  subtitleStore.updateText(getActiveProjectId(), selectedSubtitleId, subtitleTextInput.value);
  renderAllSubtitles();
  return true;
}

subtitleTextSave.addEventListener('click', saveSelectedSubtitle);
subtitleTextInput.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') { event.preventDefault(); saveSelectedSubtitle(); }
});
videoEl.addEventListener('timeupdate', renderCurrentSubtitle);
videoEl.addEventListener('loadedmetadata', renderAllSubtitles);

window.subtitleController = {
  replace: function(requestId, segments) {
    var state = subtitleStore.replace(getActiveProjectId(), requestId, segments);
    selectedSubtitleId = null;
    renderAllSubtitles();
    return state;
  },
  undo: function(requestId) {
    var state = subtitleStore.undo(getActiveProjectId(), requestId);
    selectedSubtitleId = null;
    renderAllSubtitles();
    return state;
  },
  canUndo: function(requestId) {
    return subtitleStore.canUndo(getActiveProjectId(), requestId);
  },
  count: function() { return currentSubtitleState().segments.length; },
  render: renderAllSubtitles
};

renderAllSubtitles();
```

- [ ] **Step 3: Prove a visible subtitle result with fixed segments**

创建 `tests/e2e/auto-subtitles-flow.spec.js`：

```js
const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function createVideoFixture(testInfo) {
  const file = testInfo.outputPath('subtitle-surface.mp4');
  await fs.promises.writeFile(file, Buffer.from('subtitle surface fixture'));
  return file;
}

async function openEditor(window, videoFixturePath) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(videoFixturePath);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

test.describe('subtitle surface', () => {
  test.use({ localCliMode: 'two' });

  test('shows fixed segments in one track and the preview', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await window.evaluate(() => {
      let id = 0;
      const store = window.SRTSubtitleState.createSubtitleStore(
        localStorage,
        () => `fixture-segment-${++id}`
      );
      store.replace(getActiveProjectId(), 'fixture-request', [
        { start: 0.2, end: 1.4, text: '大家好' },
        { start: 1.6, end: 3.0, text: '欢迎测试自动字幕' }
      ]);
      window.subtitleController.render();
    });
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await window.getByTestId('subtitle-block').first().click();
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好');
  });
});
```

Run:

```bash
npx playwright test tests/e2e/auto-subtitles-flow.spec.js
```

Expected: PASS. This is the mandatory minute-70 visible result; it proves only the real editor surface, not real transcription.

- [ ] **Step 4: Commit the visible subtitle surface**

```bash
git add app/剪辑.html app/editor-subtitles.js tests/e2e/auto-subtitles-flow.spec.js
git commit -m "feat: add subtitle track and preview"
```

**Mandatory early result:** If 70 minutes have been consumed and Task 6 cannot render the two fixed E2E segments in the track and preview, stop and report before continuing. Do not claim that real transcription is connected at this point.

---

### Task 7: Route the Conversation Card Through Subtitle Generation

**Files:**
- Modify: `app/editor-timeline.js`
- Modify: `tests/e2e/auto-subtitles-flow.spec.js`

**Interfaces:**
- Consumes: `window.srtAPI.translateSubtitleOrFadeIn`, `window.srtAPI.generateSubtitles`, `window.currentProjectVideoPath`, and `window.subtitleController`.
- Produces: one user message plus one two-row status card per request, with a request-bound one-level undo action.

- [ ] **Step 1: Add the successful chat-to-subtitle journey before changing renderer logic**

在 Task 6 已创建的 `tests/e2e/auto-subtitles-flow.spec.js` 中加入：

```js
test.describe('auto subtitle conversation', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'success' });

  test('generates, edits, persists and undoes the one subtitle track', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await expect(window.locator('#generateBtn')).toHaveText('发送');
    await window.locator('.input-editor').fill('给这个视频加上字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-user-message')).toHaveCount(1);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await window.getByTestId('subtitle-undo').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(0);
    await window.locator('.input-editor').fill('重新生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await window.getByTestId('subtitle-block').first().click();
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好');
    await window.getByTestId('subtitle-text-input').fill('大家好，已经修改');
    await window.getByTestId('subtitle-text-save').click();
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好，已经修改');
    await window.reload();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('大家好，已经修改');
    await window.locator('.input-editor').fill('再生成一次字幕');
    await window.locator('#generateBtn').click();
    await window.getByTestId('subtitle-undo').last().click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('大家好，已经修改');
  });
});
```

- [ ] **Step 2: Run the new E2E and verify orchestration is missing**

```bash
npx playwright test tests/e2e/auto-subtitles-flow.spec.js
```

Expected: FAIL because the chat still calls `translateLocalCliEffect` and never generates subtitles.

- [ ] **Step 3: Add one explicit subtitle variant to the existing compact card**

在 `app/editor-timeline.js` 把错误的“FFmpeg 导出”按钮文案改为真实动作。保留现有
`timelineStatus` 数据模型，只增加 `subtitleRequest` 布尔标记和 `generating` 状态；不创建
`operation`、`actionStatus`、任意 label factory 或通用操作框架：

```js
generateBtn.textContent = '发送';
requestStatusMeta.generating = { label: '生成中', icon: '·' };
var requestInFlight = false;

function setSubmitState() {
  generateBtn.disabled = requestInFlight || editorEl.textContent.trim().length === 0;
}

function createConversationRequest(text) {
  return {
    id: createLocalId(), text: text, submittedAt: Date.now(),
    instructionStatus: 'converting', timelineStatus: 'waiting', subtitleRequest: null
  };
}

function requestCardTitle(record) {
  if (record.instructionStatus === 'converting'
      || record.timelineStatus === 'applying' || record.timelineStatus === 'generating') {
    return '正在处理这次编辑';
  }
  if (record.instructionStatus === 'failed' || record.timelineStatus === 'failed') {
    return '这次编辑未完成';
  }
  if (record.subtitleRequest === true && record.timelineStatus === 'success') {
    return '字幕已生成';
  }
  return '这次编辑已完成';
}
```

`isFinalRequest()` 与 `updateRequestStatus()` 保持现有结构。只把
`renderRequestStatusCard()` 改成一个明确的字幕条件分支；旧历史记录没有
`subtitleRequest` 时继续按淡入卡渲染：

```js
function renderRequestStatusCard(card, record) {
  var isSubtitle = record.subtitleRequest === true;
  var secondLabel = isSubtitle ? '生成字幕'
    : (record.subtitleRequest === null ? '执行编辑' : '应用到时间轴');
  var secondTestId = isSubtitle ? 'subtitle-status' : 'timeline-status';
  var error = record.error
    ? '<div class="request-error">' + escapeConversationText(record.error) + '</div>' : '';
  var summary = isSubtitle && record.timelineStatus === 'success'
    ? '<div class="request-result">已生成 '
      + Number(record.resultCount || 0) + ' 条字幕</div>' : '';
  var canUndo = isSubtitle && window.subtitleController
    && subtitleController.canUndo(record.id);
  var undo = canUndo
    ? '<button type="button" class="request-undo" data-undo-request="'
      + escapeConversationText(record.id)
      + '" data-testid="subtitle-undo">撤销本次字幕</button>' : '';
  card.innerHTML = '<div class="request-status-head"><span>'
    + requestCardTitle(record) + '</span><span class="request-status-time">'
    + formatRequestTime(record.submittedAt) + '</span></div>'
    + statusRowHTML('instruction-status', '转换编辑指令', record.instructionStatus)
    + statusRowHTML(secondTestId, secondLabel, record.timelineStatus)
    + summary + error + undo;
}
```

- [ ] **Step 4: Route the two allowed instructions without adding a generic dispatcher**

实现固定路由：

```js
function subtitleErrorMessage(code) {
  if (code === 'VIDEO_PATH_UNAVAILABLE') return '当前视频路径不可用，请返回首页重新导入视频。';
  if (code === 'SUBTITLE_RUNTIME_NOT_READY') return '请先到检测页准备 Whisper 字幕。';
  if (code === 'SUBTITLE_NO_SPEECH') return '未检测到可生成字幕的清晰人声。';
  return '字幕生成失败，请重试。';
}

function instructionErrorMessage(code) {
  if (code === 'LOCAL_CLI_NOT_SELECTED' || code === 'LOCAL_CLI_NOT_AVAILABLE') {
    return '请先到检测页选择可用的本地 CLI。';
  }
  if (code === 'LOCAL_CLI_TRANSLATION_TIMEOUT') {
    return '编辑指令转换超时，请重试。';
  }
  if (code === 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT') {
    return '未能识别为当前可用的编辑指令。';
  }
  return '编辑指令转换失败，请重试。';
}

async function runSubtitleInstruction(record, card) {
  record.subtitleRequest = true;
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: 'generating', error: ''
  });
  if (!window.currentProjectVideoPath) {
    updateRequestStatus(record, card, {
      timelineStatus: 'failed', error: subtitleErrorMessage('VIDEO_PATH_UNAVAILABLE')
    });
    return;
  }
  var result = await window.srtAPI.generateSubtitles({
    videoPath: window.currentProjectVideoPath
  });
  if (!result.ok) {
    updateRequestStatus(record, card, {
      timelineStatus: 'failed', error: subtitleErrorMessage(result.errorCode)
    });
    return;
  }
  try {
    subtitleController.replace(record.id, result.segments);
  } catch (_) {
    updateRequestStatus(record, card, {
      timelineStatus: 'failed', error: '字幕暂时无法保存，请重试。'
    });
    return;
  }
  updateRequestStatus(record, card, {
    timelineStatus: 'success', resultCount: result.segments.length, error: ''
  });
}

async function translateAndApply(text, record, card) {
  var translated = await window.srtAPI.translateSubtitleOrFadeIn(text);
  if (!translated.ok) {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed', timelineStatus: 'not_run',
      error: instructionErrorMessage(translated.errorCode)
    });
    return;
  }
  record.instructionStatus = 'success';
  if (translated.instruction.type === 'generate_subtitles') {
    await runSubtitleInstruction(record, card);
    return;
  }
  record.subtitleRequest = false;
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: 'applying', error: ''
  });
  var applied = applyLocalCliEffect(translated.instruction);
  updateRequestStatus(record, card, applied
    ? { timelineStatus: 'success', error: '' }
    : { timelineStatus: 'failed', error: '编辑指令未能应用到时间轴。' });
}
```

点击提交后到最终状态前使用以下 handler 禁用 `generateBtn`；不要用关键词在 renderer 判断字幕意图：

```js
generateBtn.addEventListener('click', async function() {
  var text = editorEl.textContent.trim();
  if (!text || generateBtn.disabled) return;
  editorEl.textContent = '';
  setSubmitState();

  if (isCommand(text)) {
    addMsg('user', text);
    executeCommand(text);
    return;
  }

  var record = createConversationRequest(text);
  var card = appendRequestStatusCard(record);
  requestInFlight = true;
  setSubmitState();
  try {
    await translateAndApply(text, record, card);
  } catch (_) {
    updateRequestStatus(record, card, {
      instructionStatus: record.instructionStatus === 'success' ? 'success' : 'failed',
      timelineStatus: record.instructionStatus === 'success' ? 'failed' : 'not_run',
      error: '这次编辑未完成，请重试。'
    });
  } finally {
    requestInFlight = false;
    setSubmitState();
  }
});
```

- [ ] **Step 5: Bind request-specific one-level undo**

在 `chatArea` 加一个事件委托：

```js
chatArea.addEventListener('click', function(event) {
  var button = event.target.closest('[data-undo-request]');
  if (!button) return;
  var requestId = button.dataset.undoRequest;
  try {
    subtitleController.undo(requestId);
    for (var i = 0; i < conversationRecords.length; i++) {
      var card = chatArea.querySelector('[data-request-id="' + conversationRecords[i].id + '"]');
      if (card) renderRequestStatusCard(card, conversationRecords[i]);
    }
  } catch (_) {}
});
```

- [ ] **Step 6: Run the existing fade-in E2E unchanged**

不得修改 `tests/e2e/local-cli-effect-flow.spec.js`。它必须继续证明一个用户消息、一张状态卡、两行状态和一个淡入 marker；如果失败，只修复本计划对共享 renderer 造成的回归。

- [ ] **Step 7: Run focused E2E**

```bash
npx playwright test tests/e2e/auto-subtitles-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js
```

Expected: subtitle and fade-in journeys PASS.

- [ ] **Step 8: Commit the editor orchestration**

```bash
git add app/editor-timeline.js tests/e2e/auto-subtitles-flow.spec.js
git commit -m "feat: generate editable subtitles from chat"
```

---

### Task 8: Prove Undo, Failure Atomicity and Final Acceptance

**Files:**
- Modify: `tests/e2e/auto-subtitles-flow.spec.js`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-06-auto-subtitles-design.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: automated evidence for successful generation, project persistence, one-level undo and failure protection, plus one real-Mac manual acceptance record.

- [ ] **Step 1: Add one representative failure E2E that keeps the old subtitle state**

新增以下 helper 和一个“未识别人声”场景；预置字幕后再提交，失败不得改变原状态：

```js
async function seedExistingSubtitle(window) {
  await window.evaluate(() => {
    const store = window.SRTSubtitleState.createSubtitleStore(
      localStorage,
      () => 'seed-segment'
    );
    store.replace(getActiveProjectId(), 'seed-request', [
      { start: 0, end: 1, text: '原字幕不能丢失' }
    ]);
    window.subtitleController.render();
  });
}

test.describe('auto subtitles without speech', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'no-speech' });
  test('shows a readable result and preserves the old track', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await seedExistingSubtitle(window);
    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(window.getByText('未检测到可生成字幕的清晰人声')).toBeVisible();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-block')).toHaveText('原字幕不能丢失');
  });
});
```

子进程失败和非法输出已经由 `tests/subtitles.test.js` 覆盖；不再为每种错误复制完整 Electron E2E。

- [ ] **Step 2: Add the new journey to the existing E2E script**

把 `package.json` 的 `test:e2e` 改为包含：

```json
"tests/e2e/auto-subtitles-flow.spec.js"
```

不要创建第二套 E2E runner。

- [ ] **Step 3: Run the complete automated verification**

```bash
npm run test:unit
npm run test:e2e
```

Expected: all unit tests PASS; environment, CLI, fade-in, conversation, home and auto-subtitle E2E all PASS. `test-results/e2e` 不得加入 Git。

- [ ] **Step 4: Run one real-Mac acceptance without downloading anything in tests**

手动执行以下固定流程：

1. `npm start` 打开 SRT。
2. 检测页确认“Whisper 字幕”和“语音字幕”均显示“满足”。
3. 选择一个已检测到的本地 CLI。
4. 从首页选择一段 5–20 秒的中文口播 MP4，进入编辑器。
5. 输入“给视频加字幕”。
6. 确认同一张卡依次显示“转换编辑指令：成功”和“生成字幕：成功”。
7. 播放视频，确认画面字幕随时间变化；选中第一块并修改文字。
8. 刷新编辑器，确认修改仍存在。
9. 再次生成字幕后点击“撤销本次字幕”，确认恢复修改后的上一版。

Expected: 九步全部通过；期间不出现模型下载、不打开第二个弹窗、不生成导出文件。

- [ ] **Step 5: Record completion after acceptance without reopening the phase**

把设计稿状态更新为：

```text
状态：已实现并通过自动测试；真实 Mac 验收通过
```

在同一段记录实际单元测试数、E2E 数和真实验收结果；若真实验收未通过，不得写“已完成”。这是验收后的行政记录，不得作为延长 5 小时实施额度的理由。

- [ ] **Step 6: Commit verification evidence**

```bash
git add package.json tests/e2e/auto-subtitles-flow.spec.js docs/superpowers/specs/2026-09-06-auto-subtitles-design.md
git commit -m "test: verify auto subtitle workflow"
```

## Stop-Loss Checkpoints

- Task 2 若达到 70 分钟仍不能通过固定参数与结果校验单测，停止并报告实际阻塞，
  不增加第二种转录方案；真实模型只在 Task 8 的 Mac 验收中运行。
- Task 4 的当前项目路径若达到 30 分钟仍未接通，停止并报告；不迁移 Blob、不建设通用媒体资产层。
- Task 5 的两个窄 IPC 若达到 45 分钟仍未接通，停止并报告；不抽象通用任务或 IPC 框架。
- Task 4 与 Task 5 累计达到 75 分钟即停止支撑开发，即使单项尚未达到各自上限。
- Task 3 与 Task 6 到累计 70 分钟仍看不到固定字幕片段时，停止并报告，不继续做转录、IPC、持久化增强或撤销接线。
- 任一现有回归测试因字幕改动失败时，只修复本计划造成的回归，不顺便清理旧 AI、组件或 FFmpeg 代码。
- 达到 Stage Exit Conditions 后立即停止；导出、样式和高密度时间轴进入“以后再做”。

## Completion Report Template

最终报告必须同时给出：

- **用户可见完成度：** 真实字幕是否生成、同步、可修改、可撤销、刷新后是否保留。
- **内部完成度：** 严格指令、固定转录参数、结果校验、项目隔离和失败原子性分别是否通过。
- **未完成项：** 只列本计划明确排除的导出、样式、高密度时间轴及旧命令链，不把它们包装成本阶段缺陷。
- **验证证据：** 单元测试、E2E、真实 Mac 手检的命令或操作结果。
