# Whisper Small 检测页准备 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只在环境检测页完成 Whisper 字幕能力的真实检测、固定 Small 模型准备、行内状态反馈与验收，使用户能够一次准备约 486 MB 的本地模型，并在重启后仍被正确识别为可用。

**Architecture:** 保留现有 `detectEnvironment()`、`describeInstall(toolId)`、`installTool(request)` 三个公开接口和现有安装 IPC。环境模块把 `whisper` 的“可用”收紧为“应用管理的 Python 3.12 + 可导入的 faster-whisper + 四个非空 Small 模型文件”；安装白名单追加一个固定模型下载动作。检测页只为 Whisper 维护临时 `preparing/failed` 显示状态，确认后立即关闭弹窗，并继续复用现有一次性安装 Promise；FFmpeg、Node、npm 的既有安装交互保持不变，不建立下载管理器或进度协议。

**Tech Stack:** Electron 33、Node.js CommonJS、原生 HTML/CSS/JavaScript、Python 3.12、`faster-whisper`/`huggingface_hub`、`node:test`、Playwright Electron。

## Global Constraints

- 本阶段唯一目的：在环境检测页把固定 `Systran/faster-whisper-small` 准备好，并准确显示未准备、准备中、准备失败和已可用。
- 用户可见成果：工具行名称为“Whisper 字幕”，说明固定模型约 486 MB；确认后弹窗立刻关闭、工具行显示“准备中”；成功后工具行与“语音字幕”能力均显示可用；失败后原行显示“准备失败，可重试”。
- 明确不做：编辑器接线、自然语言指令、视频路径、真实转录、字幕轨、字幕样式、FFmpeg 字幕烧录、多模型选择、模型删除、模型更新、下载百分比、暂停/恢复、镜像切换、校验和、通用资源下载器或后台任务队列。
- 不改变产品暖白与陶土橙配色；只复用 `app/环境检测.html` 现有 `ok/warn/bad`、按钮和设计令牌。
- 不修改 main/preload 的 IPC 形状；renderer 继续只调用 `describeInstall(toolId)` 与 `installTool(toolId, confirmationId)`。
- 不让 renderer 传模型 ID、模型目录、Python 代码、程序或命令参数；这些值全部由主进程固定。
- 不在单元测试或 CI E2E 中联网、下载模型或写入真实用户目录；测试只模拟程序结果和文件状态。
- 当前基线 `node --test tests/environment.test.js tests/environment-install.test.js` 为 39/39 通过；若实施前基线改变，先停下核对，不把既有失败归入本阶段。
- 目标用时 90 分钟，硬上限 2 小时；第 45 分钟前必须在模拟场景看到“确认后弹窗关闭 + 行内准备中”。到 2 小时仍未通过既定验收则停止并报告，不自行延长。
- 支撑性修改上限 30 分钟，仅计算 `fsApi.stat` 注入和 E2E 场景模拟；模型真值、固定下载动作与行内反馈是本子阶段的核心成果，不计作支撑底座。
- 不为页面刷新、离开检测页后继续展示进度建设后台恢复协议；本次可见状态验收要求用户在准备完成前留在检测页，下载本身仍由主进程中的现有安装 Promise 执行。
- 满足“检测真实、固定模型可准备、弹窗不卡住、成功/失败均可读、重启仍识别”后立即结束。
- 不提交或修改 `.superpowers/brainstorm/` 与 `docs/research/` 中已有未跟踪内容。

## Budget Ledger

| 检查点 | 累计目标 | 硬上限 | 必须出现的结果 |
|---|---:|---:|---|
| 模型真值检测 | 25 分钟 | 35 分钟 | 缺模型不再误报可用，四文件齐全才可用 |
| 固定模型准备动作 | 45 分钟 | 60 分钟 | 安装计划只会下载固定 Small 到固定目录 |
| 检测页可见状态 | 70 分钟 | 95 分钟 | 确认后立即关闭弹窗，原行显示准备中/失败 |
| 自动与本机验收 | 90 分钟 | 120 分钟 | 定向测试、回归和一次真实页面验收完成 |

任一检查点超过硬上限，只允许修复阻碍本检查点验收的问题。不得以“顺手支持更多模型”“增加下载进度”或“为后续字幕编辑先搭底座”为理由扩展范围。

## File Map

- Modify: `src/environment/index.js` — 固定 Small 模型事实、四文件就绪检测、固定下载动作和动作级超时。
- Modify: `src/environment/node-adapter.js` — 向现有环境模块补充普通文件 `stat` 能力。
- Modify: `app/env-check.js` — “Whisper 字幕”文案、确认后立即关闭弹窗、工具行准备中/失败状态。
- Modify: `tests/environment.test.js` — 模型缺失、空文件、完整模型与应用管理 Python 的检测真值。
- Modify: `tests/environment-install.test.js` — 固定模型 ID、固定目录、固定动作顺序和专用超时。
- Modify: `tests/e2e/scenario-dependencies.js` — 仅增加可控的 Whisper 未准备/成功/失败模拟，不发起网络请求。
- Modify: `tests/e2e/environment-flow.spec.js` — 检测页准备、取消、行内状态、成功复检和失败重试验收。
- No change: `app/环境检测.html` — 现有 dialog、按钮、`aria-live` 与配色类已经足够，本阶段不重排页面。
- No change: `main.js`、`preload.js` — 复用现有环境检测与安装接口。

---

### Task 1: 让 Whisper 就绪状态反映真实 Small 模型

**时间盒:** 目标 25 分钟，硬上限 35 分钟。

**Files:**

- Modify: `tests/environment.test.js`
- Modify: `src/environment/index.js`
- Modify: `src/environment/node-adapter.js`

**Interfaces:**

- Consumes: `dependencies.userDataDir`、`dependencies.platform`、`dependencies.run(program, args, options)`、`dependencies.fsApi.stat(path)`。
- Preserves: `detectEnvironment(): Promise<EnvironmentReport>` 及既有 report 字段。
- Produces: `report.tools.whisper.reason` 可新增 `managed_python_absent` 或 `model_absent`；仅全部条件满足时 `status === 'ready'`。
- Fixed model directory: `<userDataDir>/models/faster-whisper-small`；Windows 使用同构反斜线路径。
- Fixed required files: `model.bin`、`config.json`、`tokenizer.json`、`vocabulary.json`，每个经 `stat` 后都必须满足 `isFile()` 且 `size > 0`；本阶段不新增拒绝符号链接的安全边界。

- [ ] **Step 1: 先扩充测试 fixture 的模型文件状态**

  在 `tests/environment.test.js` 顶部加入固定测试事实，并把 `makeFixture()` 的 `fsApi` 改为同时提供 `statfs` 与 `stat`：

  ```js
  const SUBTITLE_MODEL_FILES = [
    'model.bin',
    'config.json',
    'tokenizer.json',
    'vocabulary.json'
  ];
  const FASTER_WHISPER_PROBE =
    'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';

  function subtitleModelPath(platform, userDataDir, fileName) {
    const separator = platform === 'win32' ? '\\' : '/';
    return [userDataDir, 'models', 'faster-whisper-small', fileName].join(separator);
  }
  ```

  `makeFixture()` 中使用以下精确 `stat` 行为；`options.modelFiles` 是 `{ [fileName]: byteSize }`，未列出即视为缺失：

  ```js
  const userDataDir = options.userDataDir || (platform === 'win32' ? 'C:\\user-data' : '/user-data');
  const modelFiles = options.modelFiles || {};

  fsApi: {
    statfs: () => options.statfs || { bsize: 1024 ** 3, blocks: 100, bfree: 40 },
    stat: async (filePath) => {
      const fileName = SUBTITLE_MODEL_FILES.find((name) => (
        filePath === subtitleModelPath(platform, userDataDir, name)
      ));
      if (!fileName || !Object.prototype.hasOwnProperty.call(modelFiles, fileName)) {
        throw commandError('ENOENT');
      }
      return {
        size: modelFiles[fileName],
        isFile: () => true
      };
    }
  },
  ```

  同一 fixture 内把 faster-whisper 的成功输出改为真正的导入探测结果：

  ```js
  const whisperOutput = settings.whisperVersion
    ? settings.whisperVersion
    : Object.assign(commandError('ECOMMAND'), {
        stderr: "ModuleNotFoundError: No module named 'faster_whisper'"
      });
  ```

  macOS 命令键改为：

  ```js
  '/user-data/python/bin/python -c import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))': whisperOutput,
  ```

  Windows 命令键改为：

  ```js
  'C:\\user-data\\python\\Scripts\\python.exe -c import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))': whisperOutput,
  ```

- [ ] **Step 2: 写入失败优先的模型真值用例并保留版本解析保障**

  追加下面的模型真值测试；不要删除原有“版本输出不可解析时为不兼容”和“不公开错误输出”两项回归语义：

  ```js
  test('Whisper 需要应用管理 Python、可导入依赖和四个非空 Small 模型文件', async () => {
    const completeModel = Object.fromEntries(SUBTITLE_MODEL_FILES.map((name) => [name, 1]));

    const systemOnly = await createEnvironmentModule(macFixture({
      versions: { python3: '3.12.4' },
      whisperVersion: '1.2.3',
      modelFiles: completeModel
    })).detectEnvironment();
    assert.deepEqual(
      [systemOnly.tools.whisper.status, systemOnly.tools.whisper.reason],
      ['missing', 'managed_python_absent']
    );

    const packageOnly = await createEnvironmentModule(macFixture({
      managedPython: '3.12.4',
      whisperVersion: '1.2.3'
    })).detectEnvironment();
    assert.deepEqual(
      [packageOnly.tools.whisper.status, packageOnly.tools.whisper.reason],
      ['missing', 'model_absent']
    );

    const zeroByteModel = await createEnvironmentModule(macFixture({
      managedPython: '3.12.4',
      whisperVersion: '1.2.3',
      modelFiles: { ...completeModel, 'model.bin': 0 }
    })).detectEnvironment();
    assert.deepEqual(
      [zeroByteModel.tools.whisper.status, zeroByteModel.tools.whisper.reason],
      ['missing', 'model_absent']
    );

    const ready = await createEnvironmentModule(macFixture({
      managedPython: '3.12.4',
      whisperVersion: '1.2.3',
      modelFiles: completeModel
    })).detectEnvironment();
    assert.deepEqual(
      [ready.tools.whisper.status, ready.tools.whisper.reason, ready.tools.whisper.version],
      ['ready', 'ok', '1.2.3']
    );
    assert.deepEqual(ready.modes.subtitles, { status: 'ready', reason: 'ok', blockers: [] });
  });
  ```

  把原有版本解析用例迁移到托管 Python 和完整模型场景：

  ```js
  test('Whisper 解析导入版本，成功但不可解析的输出为不兼容', async () => {
    const completeModel = Object.fromEntries(SUBTITLE_MODEL_FILES.map((name) => [name, 1]));
    const probe = '/user-data/python/bin/python -c import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';
    const ready = await createEnvironmentModule(macFixture({
      managedPython: '3.12.4',
      whisperVersion: '1.2.3',
      modelFiles: completeModel
    })).detectEnvironment();
    const malformed = await createEnvironmentModule(macFixture({
      managedPython: '3.12.4',
      modelFiles: completeModel,
      commandResults: { [probe]: 'unknown-version' }
    })).detectEnvironment();

    assert.deepEqual(
      [ready.tools.whisper.status, ready.tools.whisper.reason, ready.tools.whisper.version],
      ['ready', 'ok', '1.2.3']
    );
    assert.deepEqual(
      [malformed.tools.whisper.status, malformed.tools.whisper.reason],
      ['limited', 'incompatible']
    );
  });
  ```

  同时按新语义改写依赖旧 `pip show` 行为的断言，不能为了让测试通过而继续允许系统或捆绑 Python 充当字幕运行环境：

  ```js
  test('系统 Python 仍可作为通用 Python，但不能代替应用专用字幕环境', async () => {
    const mac = macFixture({ versions: { python: '3.12.4' } });
    const macReport = await createEnvironmentModule(mac).detectEnvironment();
    const windows = windowsFixture({ versions: { py: '3.12.4' } });
    const windowsReport = await createEnvironmentModule(windows).detectEnvironment();

    assert.equal(macReport.tools.python.command, 'python');
    assert.equal(macReport.tools.whisper.reason, 'managed_python_absent');
    assert.equal(mac.calls.some((call) => call.program === 'python' && call.args[0] === '-c'), false);
    assert.equal(windowsReport.tools.python.command, 'py');
    assert.equal(windowsReport.tools.whisper.reason, 'managed_python_absent');
    assert.equal(windows.calls.some((call) => call.program === 'py' && call.args[0] === '-3' && call.args[1] === '-c'), false);
  });

  test('捆绑 Python 不代替 Windows 的应用专用字幕环境', async () => {
    const fixture = windowsFixture({
      bundled: {
        python: { available: true, version: '3.12.4', path: 'C:\\bundle\\python.exe' }
      }
    });
    const report = await createEnvironmentModule(fixture).detectEnvironment();
    assert.deepEqual(
      [report.tools.python.status, report.tools.python.source, report.tools.python.command],
      ['ready', 'bundled', 'C:\\bundle\\python.exe']
    );
    assert.equal(report.tools.whisper.reason, 'managed_python_absent');
    assert.equal(fixture.calls.some((call) => call.program === 'C:\\bundle\\python.exe'), false);
    assert.equal(fixture.calls.some((call) => call.program === 'py'), false);
  });
  ```

  另做以下机械更新，不增加新分支：

  - “模式只由各自所需的兼容工具决定”中，把字幕 mode 的 reason 从 `absent` 改为 `managed_python_absent`。
  - 把“Whisper 区分 pip 的正常未安装结果”改为下面的导入缺失/运行失败用例；两个 fixture 都使用托管 Python，且技术输出不进入 report：

    ```js
    test('Whisper 区分导入缺失与真实运行失败且不公开错误输出', async () => {
      const probe = `/user-data/python/bin/python -c ${FASTER_WHISPER_PROBE}`;
      const notFound = commandError('ECOMMAND');
      notFound.stderr = "ModuleNotFoundError: No module named 'faster_whisper'";
      const missing = await createEnvironmentModule(macFixture({
        managedPython: '3.12.4',
        commandResults: { [probe]: notFound }
      })).detectEnvironment();

      const runtimeError = commandError('ECOMMAND');
      runtimeError.stderr = 'private runtime diagnostics should stay internal';
      const failed = await createEnvironmentModule(macFixture({
        managedPython: '3.12.4',
        commandResults: { [probe]: runtimeError }
      })).detectEnvironment();

      assert.deepEqual([missing.tools.whisper.status, missing.tools.whisper.reason], ['missing', 'absent']);
      assert.deepEqual([failed.tools.whisper.status, failed.tools.whisper.reason], ['missing', 'probe_error']);
      assert.equal('stderr' in missing.tools.whisper, false);
      assert.equal('stderr' in failed.tools.whisper, false);
      assert.doesNotMatch(JSON.stringify(failed.tools.whisper), /private runtime diagnostics/);
    });
    ```
  - “app-managed Python 优先于系统 Python”中的命令断言改为 `call.args[0] === '-c' && call.args[1] === FASTER_WHISPER_PROBE`，并给 fixture 传入四个非空模型文件。
  - 删除 macOS 安装普通 `python` 用例中不会再触发的 `-m pip show faster-whisper` fake 分支；该用例只验证通用 Python 安装，不扩展为字幕准备测试。
  - 用上面的“系统 Python 仍可作为通用 Python”覆盖原“Windows py 候选项以 -3 前缀探测 Whisper”，因为新规格明确禁止系统 Python 探测 Whisper。

- [ ] **Step 3: 运行 RED，确认当前假阳性被测试捕获**

  Run:

  ```bash
  node --test --test-name-pattern="Whisper 需要应用管理" tests/environment.test.js
  ```

  Expected: FAIL；当前实现会把只有 `pip show` 结果的环境误判为 ready，且不会检查四个模型文件。若失败来自 fixture 语法或无关环境测试，先修正测试本身，不改生产实现。

- [ ] **Step 4: 在环境模块中实现固定路径与四文件检测**

  在 `src/environment/index.js` 文件顶部加入：

  ```js
  const path = require('node:path');

  const SUBTITLE_MODEL_FILES = [
    'model.bin',
    'config.json',
    'tokenizer.json',
    'vocabulary.json'
  ];
  const FASTER_WHISPER_PROBE =
    'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';
  ```

  在 `createEnvironmentModule(dependencies)` 开头集中计算固定运行目录，供检测和 Task 2 安装共同复用：

  ```js
  const pathApi = dependencies.platform === 'win32' ? path.win32 : path.posix;
  const managedDirectory = pathApi.join(dependencies.userDataDir, 'python');
  const managedPython = dependencies.platform === 'win32'
    ? pathApi.join(managedDirectory, 'Scripts', 'python.exe')
    : pathApi.join(managedDirectory, 'bin', 'python');
  const subtitleModelDir = pathApi.join(
    dependencies.userDataDir,
    'models',
    'faster-whisper-small'
  );
  ```

  从 `installationCatalog()` 删除它当前重复声明的 `managedPython` 和 `managedDirectory`。在 `probeWhisper(python)` 前新增：

  ```js
  async function isSubtitleModelReady() {
    if (!dependencies.fsApi || typeof dependencies.fsApi.stat !== 'function') return false;
    try {
      const stats = await Promise.all(SUBTITLE_MODEL_FILES.map((fileName) => (
        dependencies.fsApi.stat(pathApi.join(subtitleModelDir, fileName))
      )));
      return stats.every((stat) => (
        stat && typeof stat.isFile === 'function' && stat.isFile() && stat.size > 0
      ));
    } catch (_) {
      return false;
    }
  }
  ```

  用以下实现替换 `probeWhisper(python)`；保持公共 report 结构不变：

  ```js
  async function probeWhisper(python) {
    if (python.source !== 'managed' || !python.installed || !python.compatible) {
      return blankTool(managedPython, 'managed', 'managed_python_absent');
    }
    try {
      const output = await dependencies.run(
        managedPython,
        ['-c', FASTER_WHISPER_PROBE],
        runOptions
      );
      const text = output && output.stdout !== undefined ? output.stdout : output;
      const version = versionFrom(text);
      if (!version) {
        return {
          installed: true,
          compatible: false,
          version: null,
          command: managedPython,
          source: 'managed',
          status: 'limited',
          reason: 'incompatible'
        };
      }
      if (!await isSubtitleModelReady()) {
        return {
          installed: true,
          compatible: false,
          version,
          command: managedPython,
          source: 'managed',
          status: 'missing',
          reason: 'model_absent'
        };
      }
      return {
        installed: true,
        compatible: true,
        version,
        command: managedPython,
        source: 'managed',
        status: 'ready',
        reason: 'ok'
      };
    } catch (error) {
      return blankTool(managedPython, 'managed', whisperErrorReason(error));
    }
  }
  ```

  把 `whisperErrorReason()` 的包缺失识别改为只接受导入错误，不把任意程序失败误报成未安装：

  ```js
  function whisperErrorReason(error) {
    if (errorReason(error) === 'absent') return 'absent';
    const output = `${error && error.stdout || ''}\n${error && error.stderr || ''}`;
    return error && error.code === 'ECOMMAND' &&
      /(?:ModuleNotFoundError|No module named)[^\r\n]*faster_whisper/i.test(output)
      ? 'absent'
      : 'probe_error';
  }
  ```

  在 `src/environment/node-adapter.js` 的生产依赖中只增加普通文件检查能力：

  ```js
  fsApi: {
    statfs: fs.promises.statfs.bind(fs.promises),
    stat: fs.promises.stat.bind(fs.promises)
  },
  ```

- [ ] **Step 5: 运行检测单测并提交真值修正**

  Run:

  ```bash
  node --test tests/environment.test.js
  ```

  Expected: PASS；所有环境检测用例通过，且新用例明确证明包已安装但模型缺失时 `modes.subtitles.status === 'missing'`。

  Commit:

  ```bash
  git add src/environment/index.js src/environment/node-adapter.js tests/environment.test.js
  git commit -m "fix: require the local Small model for subtitle readiness"
  ```

---

### Task 2: 在现有安装白名单中准备固定 Small 模型

**时间盒:** 目标 20 分钟，硬上限 25 分钟。

**Files:**

- Modify: `tests/environment-install.test.js`
- Modify: `src/environment/index.js`

**Interfaces:**

- Preserves: `describeInstall('whisper')` 与 `installTool({ toolId: 'whisper', confirmationId })`。
- Produces: Whisper 固定安装序列的最后一步为 `<managedPython> -c <fixedScript> <fixedModelDir>`。
- Fixed model ID: `Systran/faster-whisper-small`；不接受 renderer 或调用方传参。
- Fixed model timeout: `1_200_000 ms`；其他既有安装动作保持 `300_000 ms`。

- [ ] **Step 1: 写入固定下载动作的失败测试**

  在 `tests/environment-install.test.js` 的 `installFixture()` 依赖中保持固定 `userDataDir`，然后把现有跨平台 Whisper 动作测试扩展为以下断言：

  ```js
  function assertFixedModelDownload(call, expectedProgram, expectedModelDir) {
    assert.equal(call.program, expectedProgram);
    assert.equal(call.args[0], '-c');
    assert.match(call.args[1], /Systran\/faster-whisper-small/);
    assert.match(call.args[1], /model\.bin/);
    assert.match(call.args[1], /config\.json/);
    assert.match(call.args[1], /tokenizer\.json/);
    assert.match(call.args[1], /vocabulary\.json/);
    assert.equal(call.args[2], expectedModelDir);
    assert.equal(call.args.length, 3);
    assert.equal(call.timeoutMs, 1200000);
  }

  test('Whisper 在两个平台最后只准备固定 Small 模型', async () => {
    const mac = installFixture('darwin');
    const macPlan = await mac.environment.describeInstall('whisper');
    assert.equal(macPlan.downloadEstimate, 'Small 模型约 486 MB，另含首次运行依赖');
    await mac.environment.installTool({ toolId: 'whisper', confirmationId: macPlan.confirmationId });
    assertFixedModelDownload(
      mac.calls.at(-1),
      '/user-data/python/bin/python',
      '/user-data/models/faster-whisper-small'
    );

    const windows = installFixture('win32');
    const windowsPlan = await windows.environment.describeInstall('whisper');
    await windows.environment.installTool({ toolId: 'whisper', confirmationId: windowsPlan.confirmationId });
    assertFixedModelDownload(
      windows.calls.at(-1),
      'C:\\user-data\\python\\Scripts\\python.exe',
      'C:\\user-data\\models\\faster-whisper-small'
    );
  });
  ```

  同时把原动作顺序测试的期望调用数从三步改为四步，并保留前三步原断言，防止为了模型下载重写现有 Python 安装流程。

- [ ] **Step 2: 运行 RED，确认当前没有模型下载动作**

  Run:

  ```bash
  node --test --test-name-pattern="固定 Small 模型" tests/environment-install.test.js
  ```

  Expected: FAIL；当前最后一个动作仍是 `pip install`，没有固定模型目录或 20 分钟专用超时。

- [ ] **Step 3: 实现固定且幂等的模型下载脚本**

  在 `src/environment/index.js` 顶层、Task 1 常量旁加入：

  ```js
  const SUBTITLE_MODEL_ID = 'Systran/faster-whisper-small';
  const SUBTITLE_MODEL_DOWNLOAD_TIMEOUT_MS = 1_200_000;
  const SUBTITLE_MODEL_DOWNLOAD_SCRIPT = [
    'import os',
    'import sys',
    'from pathlib import Path',
    'os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"',
    'from huggingface_hub import snapshot_download',
    `required = ${JSON.stringify(SUBTITLE_MODEL_FILES)}`,
    'output = Path(sys.argv[1])',
    'def ready():',
    '    return all((output / name).is_file() and (output / name).stat().st_size > 0 for name in required)',
    'if not ready():',
    `    snapshot_download(repo_id="${SUBTITLE_MODEL_ID}", local_dir=str(output), allow_patterns=required)`,
    'raise SystemExit(0 if ready() else 1)'
  ].join('\n');
  ```

  这段脚本只在四文件不完整时下载；失败时不删除残留文件，下一次由 `huggingface_hub` 自身继续利用已有缓存。本阶段不增加自定义断点、清理或校验和逻辑。

  把 macOS 与 Windows 的 `whisper` catalog 项均改为：

  ```js
  label: 'Whisper 字幕',
  downloadEstimate: 'Small 模型约 486 MB，另含首次运行依赖',
  installLocation: '应用管理的 Python 环境与本地模型目录',
  durationEstimate: '约 5–20 分钟',
  steps: [
    '确保 Python 3.12 可用。',
    '创建应用专用的隔离 Python 环境。',
    '安装 faster-whisper 字幕依赖。',
    '下载固定 Small 本地模型，完成后可离线使用。'
  ]
  ```

  在原三条固定动作后追加：

  ```js
  {
    program: managedPython,
    args: ['-c', SUBTITLE_MODEL_DOWNLOAD_SCRIPT, subtitleModelDir],
    timeoutMs: SUBTITLE_MODEL_DOWNLOAD_TIMEOUT_MS
  }
  ```

  `installTool()` 的循环只增加动作级超时覆盖，不改变请求协议：

  ```js
  for (const action of installation.actions) {
    const actionRunOptions = action.timeoutMs
      ? { timeoutMs: action.timeoutMs }
      : installRunOptions;
    await dependencies.run(action.program, action.args.slice(), actionRunOptions);
  }
  ```

  `describeInstall()` 对 Whisper 使用准确摘要，其余工具沿用现有包管理器摘要：

  ```js
  summary: canAutomate
    ? toolId === 'whisper'
      ? 'Whisper 字幕将准备应用专用环境和固定 Small 模型。'
      : `${installation.label} 将通过 ${managerName} 安装。`
    : `未检测到 ${managerName}，无法自动安装 ${installation.label}。`,
  ```

- [ ] **Step 4: 运行安装单测并提交固定准备动作**

  Run:

  ```bash
  node --test tests/environment-install.test.js
  ```

  Expected: PASS；Whisper 为四个固定动作，最后一步只含固定脚本和固定目录；现有确认一次性、未知工具拒绝、失败停止和错误脱敏用例继续通过。

  Commit:

  ```bash
  git add src/environment/index.js tests/environment-install.test.js
  git commit -m "feat: prepare the fixed Whisper Small model"
  ```

---

### Task 3: 把长任务状态从弹窗移到 Whisper 工具行

**时间盒:** 目标 25 分钟，硬上限 35 分钟。

**Files:**

- Modify: `tests/e2e/scenario-dependencies.js`
- Modify: `tests/e2e/environment-flow.spec.js`
- Modify: `app/env-check.js`

**Interfaces:**

- Consumes unchanged: `window.srtAPI.describeInstall(toolId)`、`window.srtAPI.installTool(toolId, confirmationId)`。
- Produces DOM state: `[data-testid="row-whisper"][data-install-state="preparing|failed"]`。
- Produces visible labels: “准备字幕能力”、“准备中…”、“准备失败，可重试”、“重新准备”。
- Preserves: Whisper 尚未确认时，鼠标取消和 Escape 均可用；确认后不再使用弹窗承载 Whisper 运行状态。非 Whisper 安装交互不在本阶段改动。

- [ ] **Step 1: 增加不联网的 Whisper E2E 场景**

  在 `tests/e2e/scenario-dependencies.js` 的 scenarios 中增加：

  ```js
  'mac-whisper-missing': {
    platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
    memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
  },
  'mac-whisper-install-fails': {
    platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
    memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
  }
  ```

  在 `state` 中加入三个有限状态和一个计数器；其他既有场景从 ready 开始，避免改变其测试语义：

  ```js
  const whisperStartsMissing = name === 'mac-whisper-missing' ||
    name === 'mac-whisper-install-fails';
  state.managedPythonReady = !whisperStartsMissing;
  state.whisperPackageReady = !whisperStartsMissing;
  state.subtitleModelReady = !whisperStartsMissing;
  state.whisperDownloadCount = 0;
  ```

  把托管 Python 探测、包导入、venv、pip 与模型动作的 fake 固定为：

  ```js
  if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, ['--version'])) {
    return state.managedPythonReady
      ? Promise.resolve(successful('Python 3.12.9'))
      : Promise.reject(commandError('managed Python is absent', 'ENOENT'));
  }
  if ((managedMacPython || managedWindowsPython) &&
      callArgs[0] === '-c' &&
      callArgs[1] === 'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))') {
    if (state.whisperPackageReady) return Promise.resolve(successful('1.2.1'));
    const error = commandError('import failed', 'ECOMMAND');
    error.stderr = "ModuleNotFoundError: No module named 'faster_whisper'";
    return Promise.reject(error);
  }
  if (program === 'python3.12' && callArgs[0] === '-m' && callArgs[1] === 'venv' && callArgs.length === 3) {
    state.managedPythonReady = true;
    return Promise.resolve(successful('environment created'));
  }
  if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, [
    '-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'
  ])) {
    state.whisperPackageReady = true;
    return Promise.resolve(successful('dependencies installed'));
  }
  if ((managedMacPython || managedWindowsPython) &&
      callArgs.length === 3 &&
      callArgs[0] === '-c' &&
      callArgs[1].includes('Systran/faster-whisper-small') &&
      /[\\/]models[\\/]faster-whisper-small$/.test(callArgs[2])) {
    state.whisperDownloadCount += 1;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (name === 'mac-whisper-install-fails') {
          reject(commandError('simulated model download failure', 'ECOMMAND'));
          return;
        }
        state.subtitleModelReady = true;
        resolve(successful('model prepared'));
      }, 600);
    });
  }
  ```

  给 scenario 的 `fsApi` 增加模型文件 fake；不读磁盘：

  ```js
  stat: async (filePath) => {
    const isModelFile = /[\\/]models[\\/]faster-whisper-small[\\/](model\.bin|config\.json|tokenizer\.json|vocabulary\.json)$/.test(filePath);
    if (!isModelFile || !state.subtitleModelReady) {
      throw commandError('model file is absent', 'ENOENT');
    }
    return { size: 1, isFile: () => true };
  }
  ```

- [ ] **Step 2: 先写成功、取消与失败的页面验收**

  在 `tests/e2e/environment-flow.spec.js` 增加：

  ```js
  test.describe('Whisper 字幕准备成功', () => {
    test.use({ scenario: 'mac-whisper-missing' });

    test('取消不执行；确认后弹窗关闭并在原行完成准备', async ({ window, readScenarioState }) => {
      const row = window.getByTestId('row-whisper');
      const dialog = window.getByTestId('install-dialog');
      await expect(row).toHaveAttribute('data-status', 'missing');
      await expect(row).toContainText('Whisper 字幕');
      await expect(row).toContainText('约 486 MB，下载后可离线使用');

      await row.getByRole('button', { name: '准备字幕能力' }).click();
      await expect(dialog).toContainText('Small 模型约 486 MB');
      await expect(window.getByTestId('install-confirm')).toHaveText('确认准备');
      await expect(window.getByTestId('install-cancel')).toBeEnabled();
      await window.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      expect((await readScenarioState()).installMethodCount).toBe(0);

      await row.getByRole('button', { name: '准备字幕能力' }).click();
      await window.getByTestId('install-cancel').click();
      await expect(dialog).not.toBeVisible();
      expect((await readScenarioState()).whisperDownloadCount).toBe(0);

      await row.getByRole('button', { name: '准备字幕能力' }).click();
      await window.getByTestId('install-confirm').click();
      await expect(dialog).not.toBeVisible();
      await expect(row).toHaveAttribute('data-install-state', 'preparing');
      await expect(row).toContainText('准备中');
      await expect(row).toContainText('⏳');
      await expect(row.getByRole('button', { name: '准备中…' })).toBeDisabled();
      await expect(window.getByTestId('continue')).toBeEnabled();

      await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 5000 });
      await expect(row).not.toHaveAttribute('data-install-state', 'preparing');
      await expect(window.getByTestId('mode-subtitles')).toHaveAttribute('data-status', 'ready');
      const state = await readScenarioState();
      expect(state.whisperDownloadCount).toBe(1);
      expect(state.installMethodCount).toBe(1);
      expect(state.detectionCount).toBe(2);

      const detectionsBeforeReload = state.detectionCount;
      await window.reload();
      await window.locator('[data-testid="environment-page"][data-state="loaded"]').waitFor();
      await expect(window.getByTestId('row-whisper')).toHaveAttribute('data-status', 'ready');
      await expect(window.getByTestId('row-whisper')).not.toHaveAttribute('data-install-state');
      await expect(window.getByTestId('mode-subtitles')).toHaveAttribute('data-status', 'ready');
      expect((await readScenarioState()).detectionCount).toBe(detectionsBeforeReload + 1);
    });
  });

  test.describe('Whisper 字幕准备失败', () => {
    test.use({ scenario: 'mac-whisper-install-fails' });

    test('准备失败留在原行并允许重新打开方案', async ({ window }) => {
      const row = window.getByTestId('row-whisper');
      await row.getByRole('button', { name: '准备字幕能力' }).click();
      await window.getByTestId('install-confirm').click();
      await expect(window.getByTestId('install-dialog')).not.toBeVisible();
      await expect(row).toHaveAttribute('data-install-state', 'failed', { timeout: 5000 });
      await expect(row).toContainText('准备失败，可重试');
      await expect(row.getByRole('button', { name: '重新准备' })).toBeEnabled();
      await expect(window.getByTestId('mode-subtitles')).toHaveAttribute('data-status', 'missing');
      await row.getByRole('button', { name: '重新准备' }).click();
      await expect(window.getByTestId('install-dialog')).toBeVisible();
      await window.getByTestId('install-cancel').click();
    });
  });
  ```

  两个独立 describe 使用固定 scenario，不增加通用场景 DSL。

- [ ] **Step 3: 运行 RED，确认当前弹窗锁死行为被捕获**

  Run:

  ```bash
  npx playwright test tests/e2e/environment-flow.spec.js --grep "Whisper 字幕准备"
  ```

  Expected: FAIL；当前页面找不到“准备字幕能力”，且确认后会把取消按钮禁用并留在弹窗中等待。

- [ ] **Step 4: 在现有工具行中呈现准备状态，不新增页面结构**

  在 `app/env-check.js` 的原因与工具定义中只改文案：

  ```js
  var REASON_LABELS = {
    ok: '检测正常',
    absent: '未安装或未在系统路径中找到',
    incompatible: '版本不兼容，请升级后重试',
    probe_error: '检测失败，请重试或手动确认',
    unsupported: '当前系统或硬件不支持',
    managed_python_absent: '尚未准备应用专用字幕环境',
    model_absent: 'Small 本地模型尚未准备'
  };
  ```

  ```js
  { id: 'whisper', label: 'Whisper 字幕', description: 'faster-whisper + Small 本地模型 · 约 486 MB，下载后可离线使用' }
  ```

  在当前 `pendingInstall` 附近只增加 Whisper 的 renderer 内存状态；刷新应用后仍以真实文件检测为准，不持久化运行状态：

  ```js
  var pendingInstall = null;
  var lastEnvironmentReport = null;
  var whisperInstallState = '';

  function setWhisperInstallState(state) {
    whisperInstallState = state || '';
    if (lastEnvironmentReport) renderTools(lastEnvironmentReport);
  }
  ```

  `renderReport(report)` 在调用各渲染函数前保存报告：

  ```js
  lastEnvironmentReport = renderedReport;
  ```

  在 `renderTools(report)` 的循环内，只给 Whisper 合并临时状态；其他工具继续使用原渲染逻辑：

  ```js
  var installState = definition.id === 'whisper' ? whisperInstallState : '';
  var displayIcon = installState === 'preparing'
    ? '⏳'
    : status === 'ready' ? '✅' : status === 'limited' ? '⚠️' : '❌';
  var displayStatus = STATUS_LABELS[status];
  var displayClass = status === 'ready' ? 'ok' : status === 'limited' ? 'warn' : 'bad';
  if (installState === 'preparing') {
    detailParts = ['正在准备应用专用环境和 Small 本地模型'];
    displayStatus = '准备中';
    displayClass = 'warn';
  } else if (installState === 'failed') {
    detailParts.push('准备失败，可重试');
  }

  var action = '<span class="tool-row__action"></span>';
  var installTarget = INSTALL_TARGETS[definition.id];
  if (installTarget && status !== 'ready') {
    var isPreparing = installState === 'preparing';
    var actionLabel = isPreparing
      ? '准备中…'
      : installState === 'failed'
        ? '重新准备'
        : definition.id === 'whisper' ? '准备字幕能力' : '查看安装方案';
    action = '<span class="tool-row__action"><button class="btn-install' +
      (isPreparing ? ' installing' : '') + '" type="button" data-tool-id="' +
      installTarget + '"' + (isPreparing ? ' disabled' : '') + '>' +
      actionLabel + '</button></span>';
  }
  ```

  把现有工具图标表达式替换为 `displayIcon`，避免出现“❌ 准备中”的冲突状态：

  ```js
  '<span class="tool-row__icon">' + displayIcon + '</span>'
  ```

  工具行开标签增加稳定状态，不改其网格或颜色：

  ```js
  '<div class="tool-row" data-testid="row-' + definition.id +
    '" data-status="' + status + '"' +
    (installState ? ' data-install-state="' + installState + '"' : '') + '>'
  ```

  状态文字改用上面计算出的变量：

  ```js
  '<span class="tool-row__status ' + displayClass + '">' +
    displayStatus + '</span>' + action + '</div>';
  ```

  在 `openInstallPlan(toolId)` 中替换当前固定的标题和 `installConfirm.textContent = '确认安装'` 赋值；仅 Whisper 使用“准备”，其他工具文字不变：

  ```js
  installTitle.textContent = (toolId === 'whisper' ? '准备 ' : '安装 ') + installToolLabel(toolId);
  installConfirm.textContent = toolId === 'whisper' ? '确认准备' : '确认安装';
  ```

  `cancelInstall()` 保持现状；Whisper 尚未确认时，鼠标取消与原生 Escape `cancel` 事件都能关闭弹窗。确认后 Whisper 弹窗已经关闭，因此不提供中途取消下载。用以下完整处理替换 `installConfirm` 点击逻辑，只给 Whisper 增加行内分支，非 Whisper 保留原行为：

  ```js
  installConfirm.addEventListener('click', function() {
    var request = pendingInstall;
    if (!request || !request.plan || !request.plan.confirmationId || installConfirm.disabled) return;

    if (request.toolId === 'whisper') {
      pendingInstall = null;
      installError.textContent = '';
      closeInstallDialog();
      setWhisperInstallState('preparing');
      window.srtAPI.installTool(request.toolId, request.plan.confirmationId).then(function(result) {
        if (!result || !result.ok) {
          setWhisperInstallState('failed');
          return;
        }
        setWhisperInstallState('');
        detectEnvironment();
      }).catch(function() {
        setWhisperInstallState('failed');
      });
      return;
    }

    installConfirm.disabled = true;
    installConfirm.textContent = '安装中…';
    installCancel.disabled = true;
    installError.textContent = '';
    window.srtAPI.installTool(request.toolId, request.plan.confirmationId).then(function(result) {
      if (pendingInstall !== request) return;
      if (!result || !result.ok) {
        installError.textContent = (result && result.error || '安装失败，请稍后重试。') +
          ' 请按安装方案手动处理后重新检测。';
        installConfirm.textContent = '安装未完成';
        installCancel.disabled = false;
        return;
      }
      pendingInstall = null;
      installCancel.disabled = false;
      closeInstallDialog();
      detectEnvironment();
    }).catch(function(error) {
      if (pendingInstall !== request) return;
      installError.textContent = (error && error.message || '安装失败，请稍后重试。') +
        ' 请按安装方案手动处理后重新检测。';
      installConfirm.textContent = '安装未完成';
      installCancel.disabled = false;
    });
  });
  ```

  不给准备任务增加全局遮罩，不禁用“继续进入主页”和“重新检测”，也不增加下载百分比。若用户在准备过程中主动重新检测，`whisperInstallState` 仍覆盖 Whisper 工具行显示为“准备中”，直到原 Promise 完成。FFmpeg、Node 和 npm 不进入这个新分支。

- [ ] **Step 5: 运行页面验收并提交行内反馈**

  Run:

  ```bash
  npx playwright test tests/e2e/environment-flow.spec.js --grep "Whisper 字幕准备"
  ```

  Expected: PASS；取消不执行、确认后弹窗立即关闭、600 ms 模拟期间能看到行内准备中、成功后完整复检、失败后原行可重试。

  Commit:

  ```bash
  git add app/env-check.js tests/e2e/scenario-dependencies.js tests/e2e/environment-flow.spec.js
  git commit -m "feat: show Whisper preparation status on the detection page"
  ```

---

### Task 4: 回归、真实模型验收与止损收尾

**时间盒:** 目标 20 分钟，硬上限 25 分钟；约 486 MB 模型的网络传输等待不计入编码时间，但不得借等待时间增加功能。

**Files:**

- Verify only;除非既定验收失败，不再修改文件。

- [ ] **Step 1: 运行环境单元与页面定向回归**

  Run:

  ```bash
  node --test tests/environment.test.js tests/environment-install.test.js
  npx playwright test tests/e2e/environment-flow.spec.js
  ```

  Expected: PASS；环境单元全部通过，环境页 macOS/Windows、缺失工具、取消安装、Whisper 准备成功与失败场景全部通过。

- [ ] **Step 2: 运行全量现有回归**

  Run:

  ```bash
  npm test
  npm run test:e2e
  ```

  Expected: PASS；不存在因 Whisper 就绪语义或异步弹窗行为导致的旧流程退化。若失败与本阶段无关，记录原始失败并停止，不扩大修复范围。

- [ ] **Step 3: 在当前 Mac 做一次真实检测页验收**

  Run:

  ```bash
  npm run dev
  ```

  手动验收顺序：

  1. 打开环境检测页，确认工具行显示“Whisper 字幕”和“约 486 MB，下载后可离线使用”。
  2. 若模型尚未准备，点击“准备字幕能力”，核对确认弹窗的体积、位置和四个步骤；先点一次取消，确认页面正常恢复且没有开始下载。
  3. 再次打开并确认。弹窗必须立即关闭，原行显示“准备中”，同时“继续进入主页”和“重新检测”仍可操作。
  4. 允许固定 Small 模型完成一次约 486 MB 的下载；期间不要求百分比、暂停或恢复按钮。
  5. 完成后工具行与“语音字幕”均显示可用。退出并重新启动应用，再次检测仍显示可用，证明状态来自真实模型文件而非临时 UI。
  6. 如果模型已经存在，不删除用户模型来重演首次下载；只验证重启仍为可用，首次下载与失败状态由无网络 E2E 覆盖。

  Expected: 用户不会再被锁在安装弹窗内；只有四个固定模型文件均存在且非空时才显示可用。

- [ ] **Step 4: 执行范围控制终检并立即结束**

  Run:

  ```bash
  git status --short
  git diff --check
  git log --oneline -4
  ```

  Expected:

  - 运行时代码只触及 `src/environment/index.js`、`src/environment/node-adapter.js`、`app/env-check.js`。
  - 测试只触及 `tests/environment.test.js`、`tests/environment-install.test.js`、`tests/e2e/scenario-dependencies.js`、`tests/e2e/environment-flow.spec.js`。
  - `.superpowers/brainstorm/` 与 `docs/research/` 仍为未跟踪且未提交。
  - 最近三个实施提交依次对应“检测真值”“固定模型准备”“行内状态”，没有第四个功能提交。
  - 未出现 editor、timeline、transcription、download manager、model selector、progress、pause、resume、mirror、checksum 等新增实现。

  达到以上条件即宣布本阶段完成。任何后续“给视频加字幕”链路必须另开阶段、重新冻结目的与额度。

## Acceptance Checklist

- [ ] 只有系统 Python 或只有 faster-whisper 包时，Whisper 字幕仍显示未准备。
- [ ] 任一必需模型文件缺失、`stat.isFile()` 为 false 或大小为零时，Whisper 字幕显示未准备；本阶段不额外拒绝指向文件的符号链接。
- [ ] 四文件齐全且非空时，Whisper 字幕和语音字幕能力显示可用。
- [ ] renderer 无法选择模型 ID、目录或命令；下载动作固定为 `Systran/faster-whisper-small`。
- [ ] 准备方案明确显示 Small 模型约 486 MB、应用管理位置和离线可用。
- [ ] 取消弹窗不执行安装；确认后弹窗立即关闭，不再出现取消失灵。
- [ ] 准备期间只在原工具行显示“准备中”，页面其他操作保持可用。
- [ ] 成功后自动复检；失败后原行显示“准备失败，可重试”。
- [ ] 重启应用后仍根据真实文件状态判断，不持久化虚假的“成功”标志。
- [ ] 自动测试不联网、不下载模型、不接触真实用户模型目录。
- [ ] 没有新增模型中心、下载管理器、进度协议、字幕转录或编辑器代码。

## Completion Report Contract

完成报告必须同时列出：

- 用户可见完成度：Whisper 字幕行的未准备/准备中/失败/可用、弹窗可取消、确认后不锁页、重启后状态正确。
- 内部完成度：托管 Python 导入探测、四文件判真、固定 Small 下载动作、定向与全量测试结果。
- 实际用时与 2 小时硬上限对比；模型网络传输等待单独列出。
- 明确列出未做项：编辑器、真实转录、字幕轨、多模型和下载管理能力。
