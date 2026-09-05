# Whisper Small 检测页准备 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只在环境检测页完成固定 Whisper Small 模型的真实检测、准备入口与可读结果，让用户能够一次准备约 486 MB 的本地字幕模型。

**Architecture:** 沿用现有 `detectEnvironment()`、`describeInstall(toolId)`、`installTool(request)` 和安装 IPC。后端只增加固定模型目录的四文件检测与一个固定下载动作；前端只为 Whisper 保存 `preparing/failed` 两个临时显示状态，其他工具继续使用原交互。

**Tech Stack:** Electron 33、Node.js CommonJS、原生 HTML/CSS/JavaScript、Python 3.12、`faster-whisper`、`huggingface_hub`、`node:test`、Playwright Electron。

## Global Constraints

- 本计划只覆盖《自动字幕第一版设计》的“环境检测与模型准备”，编辑器字幕链路另开阶段。
- 本阶段唯一目的：在环境检测页准备固定 `Systran/faster-whisper-small`，并显示未准备、准备中、准备失败和已可用。
- 可直接查看成果：工具行显示“Whisper 字幕”“约 486 MB”；确认后弹窗立即关闭；原行显示结果；应用重启后仍能识别已准备模型。
- 明确不做：编辑器接线、自然语言字幕指令、真实转录、字幕轨、字幕样式、FFmpeg 字幕烧录、多模型选择、模型删除或更新、下载百分比、暂停/恢复、镜像、校验和、通用下载器和后台恢复协议。
- 保持现有暖白与陶土橙配色；不改 `app/环境检测.html` 的布局与颜色。
- 不改变 main/preload 的 IPC 形状；renderer 不能提供模型 ID、目录、Python 代码或命令参数。
- 固定模型目录为 `<userDataDir>/models/faster-whisper-small`。
- 就绪条件只有三个：应用管理的 Python 3.12 可用、`faster_whisper` 可导入、`model.bin`、`config.json`、`tokenizer.json`、`vocabulary.json` 都是非空文件。
- 自动测试不联网、不下载模型、不写入真实用户目录。
- 主动实施目标 50 分钟、硬上限 55 分钟；真实模型传输另给一次最多 20 分钟，总目标 60 分钟、总硬上限 75 分钟。
- 支撑工作仅限 `fsApi.stat`、单元测试 fixture 和一条 E2E 场景，累计上限 12 分钟，不得超过主动实施目标的 25%。
- 第 25 分钟应出现完整可用的主路径；第 30 分钟仍没有可见成果则停止并报告。
- 定向自动测试通过，且当前 Mac 完成一次真实准备并在重启后仍显示可用，即立即结束。
- 不提交或修改 `.superpowers/brainstorm/` 与 `docs/research/` 中已有未跟踪内容。

## Budget Ledger

| 任务 | 主动时间目标 | 硬上限 | 必须出现的结果 |
|---|---:|---:|---|
| 1. 完整主路径 | 25 分钟 | 30 分钟 | 能准备固定 Small；确认后关窗；原行显示准备中/失败/成功 |
| 2. 一条自动用户流程 | 20 分钟 | 20 分钟 | 取消、首次失败、重试成功全部通过 |
| 3. 当前 Mac 验收 | 5 分钟 | 5 分钟 | 启动、点击和重启检查完成 |
| 唯一一次真实传输等待 | 10 分钟 | 20 分钟 | 下载完成，或达到上限后停止并报告 |

支撑时间细分：`fsApi.stat` 注入最多 2 分钟，单测 fixture 最多 4 分钟，E2E 场景最多 6 分钟。任一项超额时不补建通用设施，只报告阻塞。

## Approved TDD Execution Order

用户已确认测试优先，Task 1 与 Task 2 作为一个不可拆分的实现单元执行：

1. 先执行 Task 2 Step 1，并写入 Task 2 Step 2 的唯一 E2E。
2. 再执行 Task 1 Step 1，并同时运行单元测试与 E2E，确认都因目标能力尚未实现而失败。
3. 然后执行 Task 1 Step 3–5，完成界面与后端最小实现。
4. 最后执行 Task 1 Step 4、Task 2 Step 3，并由 Task 2 Step 4 创建唯一实现提交。

Task 1 不创建中间提交，避免出现“界面宣称可准备、后端尚未下载模型”的可执行版本。本顺序只移动既有测试，不增加场景、功能或预算。

## File Map

- Modify: `src/environment/index.js` — 固定模型目录、四文件判真、固定下载动作、下载完成后的文件检查与动作级超时。
- Modify: `src/environment/node-adapter.js` — 注入普通文件 `stat`。
- Modify: `app/env-check.js` — Whisper 文案、确认后关窗、原行准备中/失败状态。
- Modify: `tests/environment.test.js` — 一个表驱动模型真值测试，并更新受新边界影响的旧断言。
- Modify: `tests/environment-install.test.js` — 固定 macOS 下载动作断言；保留现有确认与失败即停止测试。
- Modify: `tests/e2e/scenario-dependencies.js` — 一个“首次失败、第二次成功”的 Whisper 场景。
- Modify: `tests/e2e/environment-flow.spec.js` — 一条用户流程。
- No change: `app/环境检测.html`、`main.js`、`preload.js`、编辑器、时间轴。

---

### Task 1: 完成固定模型准备的可用主路径

**时间盒:** 目标 25 分钟，硬上限 30 分钟；结束时不能提交只有文案、没有真实下载的中间版本。

**Files:**

- Modify: `tests/environment.test.js`
- Modify: `tests/environment-install.test.js`
- Modify: `src/environment/index.js`
- Modify: `src/environment/node-adapter.js`
- Modify: `app/env-check.js`

**Interfaces:**

- Preserves: `detectEnvironment(): Promise<EnvironmentReport>`、`describeInstall(toolId)`、`installTool(request)` 及现有 IPC 结构。
- Produces: Whisper 的固定安装动作使用 `Systran/faster-whisper-small` 和 `<userDataDir>/models/faster-whisper-small`。
- Produces: `report.tools.whisper.status === 'ready'` 仅表示托管 Python 可导入且四文件非空。
- Produces: `whisperInstallState` 只取 `'' | 'preparing' | 'failed'`；非 Whisper 安装行为不变。

- [ ] **Step 1: 写模型真值与固定下载的失败测试**

  在 `tests/environment.test.js` 顶部增加：

  ```js
  const SUBTITLE_MODEL_FILES = [
    'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json'
  ];
  const FASTER_WHISPER_PROBE =
    'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';

  function completeSubtitleModelFiles() {
    return Object.fromEntries(SUBTITLE_MODEL_FILES.map((name) => [name, 1]));
  }
  ```

  在 `makeFixture()` 内提取 `userDataDir` 与 `modelFiles`，让返回对象使用 `userDataDir`，并把 `fsApi` 改为：

  ```js
  const userDataDir = options.userDataDir ||
    (platform === 'win32' ? 'C:\\user-data' : '/user-data');
  const modelFiles = options.modelFiles || {};

  fsApi: {
    statfs: () => options.statfs || { bsize: 1024 ** 3, blocks: 100, bfree: 40 },
    stat: async (filePath) => {
      const fileName = SUBTITLE_MODEL_FILES.find((name) => filePath.endsWith(name));
      if (!fileName || !Object.prototype.hasOwnProperty.call(modelFiles, fileName)) {
        throw commandError('ENOENT');
      }
      return { size: modelFiles[fileName], isFile: () => true };
    }
  },
  ```

  将 `macFixture()` 和 `windowsFixture()` 的 `whisperOutput` 改为：

  ```js
  const whisperOutput = settings.whisperVersion
    ? settings.whisperVersion
    : commandError('ECOMMAND');
  ```

  两个 fixture 只保留托管 Python 的导入探测结果：

  ```js
  // macFixture commandResults
  [`/user-data/python/bin/python -c ${FASTER_WHISPER_PROBE}`]: whisperOutput,

  // windowsFixture commandResults
  [`C:\\user-data\\python\\Scripts\\python.exe -c ${FASTER_WHISPER_PROBE}`]: whisperOutput,
  ```

  删除 fixture 中系统 `python`、`python3`、`py -3` 的 `pip show faster-whisper` 结果。用下面的测试替换旧的两项 Whisper 版本/错误分类测试：

  ```js
  test('Whisper 只在托管 Python 可导入且四文件非空时可用', async () => {
    const complete = completeSubtitleModelFiles();
    const cases = [
      { modelFiles: {}, expected: 'missing' },
      { modelFiles: { ...complete, 'model.bin': 0 }, expected: 'missing' },
      { modelFiles: complete, expected: 'ready' }
    ];

    for (const item of cases) {
      const report = await createEnvironmentModule(macFixture({
        managedPython: '3.12.4',
        whisperVersion: '1.2.3',
        modelFiles: item.modelFiles
      })).detectEnvironment();
      assert.equal(report.tools.whisper.status, item.expected);
      assert.equal(report.modes.subtitles.status, item.expected);
    }
  });
  ```

  在 `tests/environment-install.test.js` 中用下面的测试替换原来的“两平台按固定顺序安装依赖”测试；既有确认机制与失败即停止测试保持不动：

  ```js
  test('Whisper 只下载固定 Small 到固定应用目录', async () => {
    const { environment, calls } = installFixture('darwin');
    const plan = await environment.describeInstall('whisper');
    const result = await environment.installTool({
      toolId: 'whisper', confirmationId: plan.confirmationId
    });
    const download = calls.at(-1);

    assert.deepEqual(result, { ok: true, toolId: 'whisper' });
    assert.equal(calls.slice(1).length, 4);
    assert.equal(download.program, '/user-data/python/bin/python');
    assert.equal(download.args[0], '-c');
    assert.ok(download.args[1].includes('repo_id="Systran/faster-whisper-small"'));
    assert.ok(download.args[1].includes('target=Path("/user-data/models/faster-whisper-small")'));
    assert.match(download.args[1], /import faster_whisper/);
    assert.match(download.args[1], /model\.bin/);
    assert.match(download.args[1], /st_size > 0/);
    assert.equal(download.timeoutMs, 1200000);
  });
  ```

- [ ] **Step 2: 运行 RED**

  Run:

  ```bash
  node --test --test-name-pattern="Whisper 只" tests/environment.test.js tests/environment-install.test.js
  ```

  Expected: FAIL；当前检测不读取模型文件，安装也没有固定 Small 下载动作。

- [ ] **Step 3: 实现固定检测、下载和下载完成校验**

  在 `src/environment/index.js` 顶部增加：

  ```js
  const path = require('node:path');

  const SUBTITLE_MODEL_FILES = [
    'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json'
  ];
  const FASTER_WHISPER_PROBE =
    'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';
  ```

  在 `createEnvironmentModule(dependencies)` 开头计算固定路径，删除 `installationCatalog()` 内重复的托管路径声明：

  ```js
  const pathApi = dependencies.platform === 'win32' ? path.win32 : path.posix;
  const managedDirectory = pathApi.join(dependencies.userDataDir, 'python');
  const managedPython = dependencies.platform === 'win32'
    ? pathApi.join(managedDirectory, 'Scripts', 'python.exe')
    : pathApi.join(managedDirectory, 'bin', 'python');
  const subtitleModelDir = pathApi.join(
    dependencies.userDataDir, 'models', 'faster-whisper-small'
  );
  ```

  在 `installationCatalog()` 中定义固定 Python 程序，并在 macOS 与 Windows 的 Whisper `actions` 末尾使用同一个动作：

  ```js
  const downloadModelCode = [
    'from pathlib import Path',
    'from huggingface_hub import snapshot_download',
    'import faster_whisper',
    `target=Path(${JSON.stringify(subtitleModelDir)})`,
    `required=${JSON.stringify(SUBTITLE_MODEL_FILES)}`,
    'snapshot_download(repo_id="Systran/faster-whisper-small", local_dir=str(target), allow_patterns=required)',
    'assert all((target/name).is_file() and (target/name).stat().st_size > 0 for name in required), "incomplete model"'
  ].join('; ');

  const downloadModelAction = {
    program: managedPython,
    args: ['-c', downloadModelCode],
    timeoutMs: 1200000
  };
  ```

  Whisper 计划的可读字段统一为：

  ```js
  label: 'Whisper 字幕',
  downloadEstimate: '约 486 MB',
  installLocation: '应用管理的 Python 与模型目录',
  durationEstimate: '约 5–20 分钟',
  steps: [
    '准备应用专用的 Python 3.12 环境。',
    '安装 faster-whisper 运行依赖。',
    '下载固定的 Small 本地模型，完成后可离线使用。'
  ],
  ```

  在 `probeWhisper(python)` 前增加：

  ```js
  async function isSubtitleModelReady() {
    if (!dependencies.fsApi || typeof dependencies.fsApi.stat !== 'function') return false;
    try {
      const stats = await Promise.all(SUBTITLE_MODEL_FILES.map((fileName) => (
        dependencies.fsApi.stat(pathApi.join(subtitleModelDir, fileName))
      )));
      return stats.every((stat) => stat && stat.isFile() && stat.size > 0);
    } catch (_) {
      return false;
    }
  }
  ```

  用以下实现替换 `probeWhisper(python)`；不新增公开错误分类：

  ```js
  async function probeWhisper(python) {
    if (!python.installed || !python.compatible || python.source !== 'managed') {
      return blankTool(managedPython, 'managed', 'absent');
    }
    try {
      const output = await dependencies.run(
        managedPython, ['-c', FASTER_WHISPER_PROBE], runOptions
      );
      const text = output && output.stdout !== undefined ? output.stdout : output;
      const version = versionFrom(text);
      if (!await isSubtitleModelReady()) {
        return {
          installed: true, compatible: false, version, command: managedPython,
          source: 'managed', status: 'missing', reason: 'absent'
        };
      }
      return {
        installed: true, compatible: true, version, command: managedPython,
        source: 'managed', status: 'ready', reason: 'ok'
      };
    } catch (_) {
      return blankTool(managedPython, 'managed', 'probe_error');
    }
  }
  ```

  让安装循环只接受白名单动作自身的超时覆盖：

  ```js
  for (const action of installation.actions) {
    await dependencies.run(action.program, action.args.slice(), {
      ...installRunOptions,
      ...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {})
    });
  }
  ```

  在 `src/environment/node-adapter.js` 的生产依赖中补入：

  ```js
  fsApi: {
    statfs: fs.promises.statfs.bind(fs.promises),
    stat: fs.promises.stat.bind(fs.promises)
  },
  ```

- [ ] **Step 4: 更新受新“只用托管 Python”边界影响的旧测试**

  在 `tests/environment.test.js` 做以下限定修改：

  - “Python 按平台顺序选择候选项”保留 Python 候选断言，删除系统 Python 执行 `pip show faster-whisper` 的断言，并增加 `assert.equal(report.tools.whisper.status, 'missing')`。
  - “Windows 使用校验通过的捆绑 Python”保留捆绑 Python 选择断言，删除捆绑 Python 执行 Whisper 的假结果与调用断言，增加 Whisper 为 `missing` 的断言。
  - 删除重复的“Windows py 候选项以 -3 前缀探测 Whisper”测试；`py -3 --version` 已由前一项覆盖。
  - “app-managed Python 优先于系统 Python”传入 `modelFiles: completeSubtitleModelFiles()`，把调用断言改为托管 Python 的 `['-c', FASTER_WHISPER_PROBE]`。
  - 删除“macOS 安装 python@3.12”测试中已不会调用的 `pip show faster-whisper` fake 分支。

  两个系统 Python 断言分别使用现有局部变量：

  ```js
  assert.equal(macReport.tools.whisper.status, 'missing');
  assert.equal(mac.calls.some((call) => call.program === 'python' && call.args[0] === '-c'), false);
  assert.equal(windowsReport.tools.whisper.status, 'missing');
  assert.equal(windows.calls.some((call) => call.program === 'py' && call.args.includes('-c')), false);
  ```

  捆绑 Python 测试的结尾改为：

  ```js
  assert.equal(report.tools.whisper.status, 'missing');
  assert.equal(fixture.calls.some((call) => call.program === 'C:\\bundle\\python.exe'), false);
  ```

  “app-managed Python”调用断言使用：

  ```js
  assert.ok(fixture.calls.some((call) => (
    call.program === '/user-data/python/bin/python' &&
    call.args[0] === '-c' &&
    call.args[1] === FASTER_WHISPER_PROBE
  )));
  ```

- [ ] **Step 5: 实现 Whisper 专属的紧凑行内状态**

  在 `app/env-check.js` 中把 Whisper 定义改为：

  ```js
  { id: 'whisper', label: 'Whisper 字幕', description: 'faster-whisper + Small 本地模型' }
  ```

  在页面状态变量旁增加：

  ```js
  var currentReport = null;
  var whisperInstallState = '';
  ```

  在 `renderTools(report)` 中，取得 `status` 后加入：

  ```js
  var installState = definition.id === 'whisper' ? whisperInstallState : '';
  var isPreparing = installState === 'preparing';
  var isFailed = installState === 'failed';
  ```

  Whisper 的详情、状态和操作按钮使用下列完整计算；非 Whisper 值保持原样：

  ```js
  if (definition.id === 'whisper') {
    detailParts = ['约 486 MB，下载后可离线使用'];
  }

  var displayStatus = isPreparing ? '准备中' :
    isFailed ? '准备失败，可重试' : STATUS_LABELS[status];
  var displayClass = isPreparing ? 'warn' : isFailed ? 'bad' :
    (status === 'ready' ? 'ok' : status === 'limited' ? 'warn' : 'bad');
  var displayIcon = isPreparing ? '⏳' :
    status === 'ready' ? '✅' : status === 'limited' ? '⚠️' : '❌';
  var action = '<span class="tool-row__action"></span>';
  var installTarget = INSTALL_TARGETS[definition.id];

  if (installTarget && status !== 'ready') {
    var actionLabel = definition.id === 'whisper'
      ? isFailed ? '重新准备' : isPreparing ? '准备中' : '准备字幕能力'
      : '查看安装方案';
    action = '<span class="tool-row__action"><button class="btn-install' +
      (isPreparing ? ' installing' : '') + '" type="button" data-tool-id="' +
      installTarget + '"' + (isPreparing ? ' disabled' : '') + '>' +
      actionLabel + '</button></span>';
  }
  ```

  用下面的工具行模板替换现有模板：

  ```js
  html += '<div class="tool-row" data-testid="row-' + definition.id +
    '" data-status="' + status + '"' +
    (installState ? ' data-install-state="' + installState + '"' : '') + '>' +
    '<span class="tool-row__icon">' + displayIcon + '</span>' +
    '<span class="tool-row__name">' + escapeText(definition.label) + '</span>' +
    '<span class="tool-row__desc"><span class="tool-row__desc-text">' +
      escapeText(definition.description) + '</span></span>' +
    '<span class="tool-row__detail">' + escapeText(detailParts.join(' · ')) + '</span>' +
    '<span class="tool-row__status ' + displayClass + '">' + displayStatus + '</span>' +
    action + '</div>';
  ```

  在 `renderReport(report)` 开头保存最近报告：

  ```js
  currentReport = report || {};
  var renderedReport = currentReport;
  ```

  增加只重绘 Whisper 所在工具列表的临时状态函数：

  ```js
  function setWhisperInstallState(state) {
    whisperInstallState = state;
    if (currentReport) renderTools(currentReport);
  }
  ```

  在 `openInstallPlan(toolId)` 中使用：

  ```js
  installTitle.textContent = (toolId === 'whisper' ? '准备 ' : '安装 ') +
    installToolLabel(toolId);
  installConfirm.textContent = toolId === 'whisper' ? '确认准备' : '确认安装';
  ```

  在 `installConfirm` 点击处理器取得 `request` 并通过现有前置校验后，插入以下 Whisper 分支；后面的非 Whisper 逻辑保持原样：

  ```js
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
      whisperInstallState = '';
      detectEnvironment();
    }).catch(function() {
      setWhisperInstallState('failed');
    });
    return;
  }
  ```

  在 `describeInstall(toolId)` 的返回值中只为 Whisper 改写摘要：

  ```js
  summary: canAutomate
    ? toolId === 'whisper'
      ? '将在应用管理目录准备 faster-whisper 与固定 Small 模型。'
      : `${installation.label} 将通过 ${managerName} 安装。`
    : `未检测到 ${managerName}，无法自动安装 ${installation.label}。`,
  ```

- [ ] **Step 6: 运行 GREEN并打开页面检查完整主路径**

  Run:

  ```bash
  node --test tests/environment.test.js tests/environment-install.test.js
  npm run dev
  ```

  Expected: 单元测试全部 PASS；检测页显示“Whisper 字幕”“约 486 MB”“准备字幕能力”。本步只打开弹窗后取消，不点击“确认准备”，避免提前进入真实下载。

  本步不提交；继续完成 Task 2 的同一条 E2E 验收，避免产生测试尚未闭环的中间提交。

---

### Task 2: 用一条用户流程锁定取消、失败与重试

**时间盒:** 目标及硬上限均为 20 分钟；E2E 支撑达到 6 分钟立即停止扩写，只保留手动验收。

**Files:**

- Modify: `tests/e2e/scenario-dependencies.js`
- Modify: `tests/e2e/environment-flow.spec.js`
- Verify only: `app/env-check.js`、`src/environment/index.js`

**Interfaces:**

- Produces one scenario: `mac-whisper-retry`。
- User states: missing → preparing → failed → preparing → ready。
- Does not produce: 页面刷新恢复、并发安装、下载百分比、Windows E2E 或内部调用次数矩阵。

- [ ] **Step 1: 增加一个最终 E2E 场景**

  在 `tests/e2e/scenario-dependencies.js` 顶部增加：

  ```js
  const SUBTITLE_MODEL_FILES = [
    'model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json'
  ];
  const FASTER_WHISPER_PROBE =
    'import faster_whisper, importlib.metadata as m; print(m.version("faster-whisper"))';
  ```

  在 `scenarios` 中增加：

  ```js
  'mac-whisper-retry': {
    platform: 'darwin', arch: 'arm64', version: '15.6.1', chip: 'Apple M4', cores: 10,
    memoryGB: 24, diskFreeGB: 180, diskTotalGB: 494, graphics: 'ready'
  },
  ```

  在 `state` 中增加：

  ```js
  managedPythonReady: false,
  whisperPackageReady: false,
  whisperModelReady: false,
  whisperDownloadAttempts: 0
  ```

  用以下分支替换现有托管 Python `--version` 分支，并紧接着加入导入分支：

  ```js
  if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, ['--version'])) {
    if (name === 'mac-whisper-retry' && state.managedPythonReady) {
      return Promise.resolve(successful('Python 3.12.9'));
    }
    return Promise.reject(commandError('managed Python is absent', 'ENOENT'));
  }
  if (name === 'mac-whisper-retry' && managedMacPython &&
      sameArgs(callArgs, ['-c', FASTER_WHISPER_PROBE])) {
    return state.whisperPackageReady
      ? Promise.resolve(successful('1.2.1'))
      : Promise.reject(commandError('faster-whisper is absent', 'ECOMMAND'));
  }
  ```

  把现有 macOS venv 与托管 Python pip 分支改为：

  ```js
  if (program === 'python3.12' && callArgs[0] === '-m' && callArgs[1] === 'venv' && callArgs.length === 3) {
    if (name === 'mac-whisper-retry') state.managedPythonReady = true;
    return Promise.resolve(successful('environment created'));
  }
  if ((managedMacPython || managedWindowsPython) && sameArgs(callArgs, [
    '-m', 'pip', 'install', 'faster-whisper', 'soundfile', 'numpy'
  ])) {
    if (name === 'mac-whisper-retry') state.whisperPackageReady = true;
    return Promise.resolve(successful('dependencies installed'));
  }
  ```

  在通用 unexpected-command 分支前增加固定下载模拟：

  ```js
  if (name === 'mac-whisper-retry' && managedMacPython && callArgs[0] === '-c' &&
      /snapshot_download/.test(callArgs[1] || '')) {
    state.whisperDownloadAttempts += 1;
    return new Promise((resolve, reject) => setTimeout(() => {
      if (state.whisperDownloadAttempts === 1) {
        reject(commandError('model download failed', 'ECOMMAND'));
        return;
      }
      state.whisperModelReady = true;
      resolve(successful('model ready'));
    }, 300));
  }
  ```

  把 `fsApi` 改为：

  ```js
  fsApi: {
    statfs: async () => ({
      bsize: 4096,
      blocks: scenario.diskTotalGB * gibibyte / 4096,
      bavail: scenario.diskFreeGB * gibibyte / 4096,
      bfree: scenario.diskFreeGB * gibibyte / 4096
    }),
    stat: async (filePath) => {
      const required = SUBTITLE_MODEL_FILES.some((fileName) => filePath.endsWith(fileName));
      if (name !== 'mac-whisper-retry' || !state.whisperModelReady || !required) {
        throw commandError('model file is absent', 'ENOENT');
      }
      return { size: 1, isFile: () => true };
    }
  },
  ```

- [ ] **Step 2: 写一条完整用户流程并确认 RED**

  在 `tests/e2e/environment-flow.spec.js` 末尾增加：

  ```js
  test.describe('Whisper Small preparation', () => {
    test.use({ scenario: 'mac-whisper-retry' });

    test('取消不执行，失败可重试，成功后变为可用', async ({ window, readScenarioState }) => {
      const row = window.getByTestId('row-whisper');
      const dialog = window.getByTestId('install-dialog');

      await expect(row).toContainText('Whisper 字幕');
      await expect(row).toContainText('约 486 MB');
      await row.getByRole('button', { name: '准备字幕能力' }).click();
      await expect(window.locator('#installTitle')).toHaveText('准备 Whisper 字幕');
      await expect(window.getByTestId('install-confirm')).toHaveText('确认准备');
      await window.getByTestId('install-cancel').click();
      await expect(dialog).not.toBeVisible();
      expect((await readScenarioState()).whisperDownloadAttempts).toBe(0);

      await row.getByRole('button', { name: '准备字幕能力' }).click();
      await window.getByTestId('install-confirm').click();
      await expect(dialog).not.toBeVisible();
      await expect(row).toHaveAttribute('data-install-state', 'preparing');
      await expect(row.getByRole('button', { name: '准备中' })).toBeDisabled();
      await expect(row).toHaveAttribute('data-install-state', 'failed');
      await expect(row).toContainText('准备失败，可重试');

      await row.getByRole('button', { name: '重新准备' }).click();
      await window.getByTestId('install-confirm').click();
      await expect(row).toHaveAttribute('data-install-state', 'preparing');
      await expect(row).toHaveAttribute('data-status', 'ready');
      await expect(window.getByTestId('mode-subtitles')).toHaveAttribute('data-status', 'ready');
      expect((await readScenarioState()).whisperDownloadAttempts).toBe(2);
    });
  });
  ```

  Run:

  ```bash
  npx playwright test tests/e2e/environment-flow.spec.js --grep "Whisper Small preparation"
  ```

  Expected: FAIL，失败点是旧界面没有 Whisper 专属文案、关窗与行内状态，或旧后端没有固定模型下载；不得通过删减断言让测试变绿。

- [ ] **Step 3: 运行全部定向验收**

  Run:

  ```bash
  node --test tests/environment.test.js tests/environment-install.test.js
  npx playwright test tests/e2e/environment-flow.spec.js --grep "Whisper Small preparation"
  git diff --check
  ```

  Expected: 两组单元测试与一条 Whisper E2E 全部 PASS；不运行 Windows E2E、页面刷新测试或全量套件。失败时停止并报告，不扩大修复范围。

- [ ] **Step 4: 提交唯一 E2E 验收**

  ```bash
  git add src/environment/index.js src/environment/node-adapter.js app/env-check.js tests/environment.test.js tests/environment-install.test.js tests/e2e/scenario-dependencies.js tests/e2e/environment-flow.spec.js
  git commit -m "feat: prepare Whisper Small from environment check"
  ```

---

### Task 3: 当前 Mac 真实验收并停止

**主动时间盒:** 目标及硬上限均为 5 分钟。

**传输等待盒:** 只允许一次真实下载，目标 10 分钟、硬上限 20 分钟；它与主动时间合计后仍受总计 75 分钟硬上限约束。

**Files:**

- Verify only；既定验收通过后不再修改代码。

- [ ] **Step 1: 启动并执行一次真实用户流程**

  Run:

  ```bash
  npm run dev
  ```

  手动验收：

  1. 确认“Whisper 字幕”“约 486 MB”和“准备字幕能力”可见，颜色与原页面一致。
  2. 打开后先点一次取消，确认弹窗关闭且没有下载。
  3. 再次打开并确认；弹窗必须立即关闭，原行显示“准备中”，页面其他部分可操作。
  4. 只等待这一次固定 Small 下载。失败时确认原行显示“准备失败，可重试”；不增加镜像、断点续传或第二套下载方案。
  5. 成功后确认 Whisper 行和“语音字幕”均显示可用。关闭并重启应用，再确认仍为可用。
  6. 若模型在验收前已经存在，不删除用户模型；只验证现有模型与重启识别，首次下载交互由 Task 2 的 E2E 覆盖。

  Expected: 五项用户状态与重启识别成立；或达到传输硬上限后停止并如实报告外部阻塞。

- [ ] **Step 2: 输出双完成度与范围报告**

  Run:

  ```bash
  git status --short
  git log --oneline -3
  ```

  Expected: 只剩实施前已有的未跟踪目录。报告必须列出：

  - 用户可见完成度：入口、取消、准备中、失败重试、成功和重启识别。
  - 内部完成度：托管 Python 导入、四文件判真、固定下载及完成校验、定向测试结果。
  - 主动时间、传输等待与 75 分钟总上限的对比。
  - 明确未做：编辑器、真实转录、字幕轨、多模型、进度协议和后台恢复。

## Acceptance Checklist

- [ ] 第 25 分钟已有完整可用主路径；最迟第 30 分钟停止或报告。
- [ ] Whisper 行显示固定 Small 与约 486 MB，颜色和页面布局未改变。
- [ ] 只有托管 Python 可导入且四个固定文件非空时才显示可用。
- [ ] 下载动作固定模型 ID、固定目录和 20 分钟超时，renderer 无法改写。
- [ ] 下载程序返回成功前再次验证四文件为非空普通文件。
- [ ] 确认后弹窗立即关闭；原行显示准备中、失败可重试或可用。
- [ ] 定向单元测试与单条 Whisper E2E 通过。
- [ ] 当前 Mac 完成一次真实检查，重启后仍识别可用；网络阻塞则在时限内停止报告。
- [ ] 支撑工作不超过 12 分钟，主动实施不超过 55 分钟，总时间不超过 75 分钟。
- [ ] 没有新增编辑器、转录、模型管理、进度协议或后台恢复能力。

## Stop Condition

以上验收项满足后，本阶段立即结束。下一阶段的“给视频加字幕”真实转录与编辑器字幕轨必须另写计划，不能在本计划中顺手实现。
