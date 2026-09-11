# 时间轴代码质量修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复统一时间轴改动中已确认的参数脆弱性、错误分类不清和 UI 结构测试缺口。

**Architecture:** 保持现有 `SRTTimelineLayout → SRTTimelineView → editor-timeline` 分层，不重做时间轴数据模型。布局工具负责安全格式化，视图负责统一容器的 DOM 验收，编辑器入口只区分已知项目读取错误与未知程序错误。

**Tech Stack:** 原生 JavaScript、Electron、Node.js test、Playwright。

## Global Constraints

- 不新增依赖，不改变 Remotion 渲染链路。
- 不改变项目存储格式、撤销协议、编辑能力或时间轴缩放/滚动交互。
- 不把与本次时间轴无关的 `.superpowers/sdd/task-1-report.md` 或待办文档纳入提交。
- 本轮只处理代码质量和验收覆盖，不扩展产品功能。

---

### Task 1: 保护标尺格式化函数

**Files:**
- Modify: `src/timeline-layout.js`
- Test: `tests/timeline-layout.test.js`

**Interfaces:**
- 保持 `formatTick(seconds, step)` 的现有返回格式。
- 对 `step <= 0`、非有限值或非数字输入，使用固定的 `0` 位小数作为安全回退，不抛异常。

- [ ] **Step 1: Write the failing test**

```js
test('formatTick does not throw for invalid spacing', () => {
  assert.equal(model.formatTick(1.234, 0), '1s');
  assert.equal(model.formatTick(1.234, -1), '1s');
  assert.equal(model.formatTick(1.234, NaN), '1s');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/timeline-layout.test.js --test-name-pattern="invalid spacing"`

Expected: FAIL because the current precision calculation can produce an invalid `toFixed` precision.

- [ ] **Step 3: Write minimal implementation**

在 `formatTick` 开头将步长归一化：

```js
var safeStep = Number(step);
var precision = Number.isFinite(safeStep) && safeStep > 0
  ? Math.min(10, Math.max(0, Math.ceil(-Math.log10(safeStep))))
  : 0;
```

后续只使用 `precision`，不改变正常正数步长的格式。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/timeline-layout.test.js`

Expected: all timeline layout tests pass.

---

### Task 2: 收窄时间轴读取错误处理

**Files:**
- Modify: `app/editor-timeline.js`
- Test: `tests/e2e/multitrack-timeline-flow.spec.js`

**Interfaces:**
- 已知 `EDIT_STORAGE_CORRUPT` 继续调用现有 `projectErrorMessage()`。
- 未知错误继续抛出，避免把程序缺陷伪装成项目数据损坏。

- [ ] **Step 1: Write the failing test**

在 Electron 流程中增加未知渲染异常检查：调用一个只抛出普通 `Error` 的测试钩子，断言错误不会被写成“项目保存的数据无法读取”。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/multitrack-timeline-flow.spec.js --grep "unknown timeline error"`

Expected: FAIL because当前 catch 会把所有异常都传给项目读取错误提示。

- [ ] **Step 3: Write minimal implementation**

将 catch 改为按错误码分支：

```js
} catch (error) {
  timelineView.render([], 0);
  if (error && error.code === 'EDIT_STORAGE_CORRUPT') {
    addMsg('ai', projectErrorMessage(error));
    return;
  }
  throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/multitrack-timeline-flow.spec.js --grep "timeline error|stale"`

Expected: known corrupt storage clears markers and shows the existing readable message; unknown errors remain visible to the test runner.

---

### Task 3: 增加统一容器结构验收

**Files:**
- Modify: `tests/e2e/multitrack-timeline-flow.spec.js`
- Inspect only: `app/editor-timeline-view.js`, `app/剪辑.html`

**Interfaces:**
- 验收现有 DOM：一个 `#tlTrack` 容器、无 `.tl-row-label` 和 `.tl-ruler-label`、区域分隔线使用 `.tl-lane-divider`。
- 不改变测试夹具的编辑步骤和项目数据。

- [ ] **Step 1: Write the failing test**

在首次渲染后加入：

```js
await expect(window.locator('#tlTrack')).toHaveCount(1);
await expect(window.locator('.tl-row-label,.tl-ruler-label')).toHaveCount(0);
await expect(window.locator('.tl-lane-divider')).toHaveCount(3);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/multitrack-timeline-flow.spec.js --grep "packs effects"`

Expected: FAIL until the formal editor matches the approved unified-container structure.

- [ ] **Step 3: Verify the existing implementation**

确认 `editor-timeline-view.js` 不再创建标签节点，`app/剪辑.html` 不再为每行提供独立边框；只允许 `.tl-lane-divider` 作为区域分隔线。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/multitrack-timeline-flow.spec.js --grep "packs effects"`

Expected: combined subtitle/card/source-effect flow and unified container assertions pass.

---

### Task 4: 回归检查与日志

**Files:**
- Modify: `docs/DEVELOPMENT_LOG.md`

- [ ] **Step 1: Run focused tests**

```bash
node --test tests/timeline-layout.test.js
npx playwright test tests/e2e/multitrack-timeline-flow.spec.js tests/e2e/project-editing-flow.spec.js
git diff --check
```

- [ ] **Step 2: Record evidence**

在研发日志中记录通过数量、任何沙箱监听限制，以及未执行真实 AI/真实视频导出复测的边界。

- [ ] **Step 3: Stop condition**

只要上述聚焦测试通过，本轮结束；不继续扩展为完整版本管理、渲染性能或新效果开发。

## Self-review

- 范围仅覆盖检查中发现的四项质量问题。
- 没有新增能力注册、渲染器、存储字段或 UI 功能。
- `formatTick` 的接口在所有任务中保持一致。
- 未把无关工作区文件纳入任务。
