# Task 1 Report: 可见的默认左侧侧栏

## Status

DONE

## 实现内容

- 将编辑器根布局重排为 `editorSidebar`、`splitHandle`、`workspace` 三个直接子项；根节点默认标记 `data-sidebar-side="left"`。
- 新增“对话 / 组件”页签和 `setSidebarTab(name)`：默认显示对话，组件面板初始隐藏。
- 将既有聊天、输入、组件搜索、分类和卡片节点移动到对应页签面板，没有复制内部 ID 或功能节点。
- 侧栏默认宽度为 320px，以网格布局占用编辑器空间，不覆盖右侧视频；删除了 900px 时隐藏侧栏的规则。
- 将现有拖动改为左侧侧栏宽度变量（180–500px，且保留至少 400px 工作区），不做持久化。
- 时间轴 ResizeObserver 在重绘标记前清除宽度缓存，保证侧栏拖宽后标记位置随时间轴宽度更新。

## TDD

### RED

先创建 `tests/e2e/conversation-sidebar-flow.spec.js`，再运行：

```bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
```

首轮在受限环境无法启动 Electron；以本机应用权限重跑后按预期失败：

```text
expect(locator).toHaveAttribute(expected) failed
Locator: locator('#splitRoot')
Expected: "left"
Received: ""
```

失败原因是统一侧栏的 `data-sidebar-side="left"` 尚不存在，符合新增功能缺失的预期。

### GREEN

完成最小实现后运行：

```bash
npx playwright test tests/e2e/conversation-sidebar-flow.spec.js
```

结果：`1 passed (3.6s)`。烟测验证默认左侧对话面板、组件页签、搜索“缩放入场”、拖入时间轴产生一个标记，以及切回对话后标记仍存在。

## 验证与手检

- `npm test`：受限环境首轮的 7 个 server-security 用例因 loopback `EPERM` 失败；以本机 loopback 权限重跑后 `102 passed, 0 failed`。
- 启动 `npm start` 并手检：对话默认位于左侧且视频保持在右侧工作区；切换组件页签后，搜索框、分类和组件卡片可见。手检后已关闭 Electron。
- `git diff --check`：通过。

## 变更文件

- `app/剪辑.html`
- `app/editor-core.js`
- `app/editor-timeline.js`
- `tests/e2e/conversation-sidebar-flow.spec.js`
- `.superpowers/sdd/task-1-report.md`

## 自检

- 未修改 `tests/e2e/electron.fixture.js` 或 `tests/e2e/electron-main.js`。
- 未引入精确像素 E2E、测试延迟或 DOM 故障回退。
- 未迁移、复活或清理旧云端、Ollama 或直接命令分支。
- 未修改、暂存或提交 `.superpowers/brainstorm/`。
- 未进入阶段二：没有侧栏持久化、首页头像、项目历史或单卡状态。

## 投入与用户可见成果

- 实际总投入：约 35 分钟；支撑投入（Electron 权限、手检与全量单元回归）：约 12 分钟。
- 用户可见成果：编辑器打开后默认出现约 320px 的左侧“对话 / 组件”侧栏；视频不被覆盖，组件可继续搜索并拖到时间轴。

## 顾虑

无。全量端到端套件未重复运行：本任务的新增组合烟测已通过，且单元全量回归通过；基线的既有 E2E 已由主控在任务开始前验证。
