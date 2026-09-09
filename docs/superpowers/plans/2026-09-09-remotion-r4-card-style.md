# Remotion R4 通用底板样式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让 AI 可组合圆角、描边、半透明底板，与既有文字/组动画一起在同一 Remotion 场景预览并导出。

**Architecture:** 在现有 shape 参数声明/几何转换中增加样式；独立矩形与组合子层共享 VisualLayer。参数自动进入注册表、提示词、解析和项目图，不新增卡片能力 ID、模板或执行链。

**Tech Stack:** 现有 JavaScript、React/SVG、Remotion 4.0.522、Node test、Playwright/Electron；零新依赖。

## Global Constraints

- 用户已认可参考分析的第 2 项：只补圆角、描边、底板填充透明度；复用既有组、时间区间、淡入/缩放。参考为 02:11–02:24 信息卡，不承诺逐像素复制。
- 不改 UI 配色/布局，不加图标、图片、阴影、背景模糊、字体系统、画中画、自动排版、平移/新动画引擎、效果名查表。
- 保持能力 @1、项目 schemaVersion 1，新增参数均可省略；缺省时保持旧矩形外观。加载旧项目/技能不迁移、不写回；最近一次请求整次撤销不变。
- 正常预览/导出继续共用 Remotion；不建设第二条 FFmpeg 卡片渲染链，不让历史入口悄悄降级新样式。
- 保留全部 R1/R2/R3 未提交成果。本轮不提交/推送、不下载依赖、不上传参考视频、截图、私人字幕。
- 本地固定翻译回归与真实 AI 必须分开报告。真实 AI 上限 2 次，仅人工请求和合成项目摘要；待用户对本轮调用问题明确答复后才能调用，未答复则不得调用或宣称真实 AI 通过。

## 阶段冻结

1. 唯一目的：上述通用底板样式从参数到可见成片贯通。
2. 可查看成果：横/竖版短片及 Player 截图，展示同类型卡片、修改文案/时段后的变化；用合成视频而非把私人参考整片作为测试输入。
3. 不做项：Global Constraints 所列扩展；不重新设计注册表、文档、模型协议或渲染架构。
4. 额度：17:26:29 UTC 开始，18:11:29 前有可见画面，18:56:29 止损（90 分钟）；支撑准备不超过约 20 分钟，超过双倍预估立即报告；不精确虚报交叠工作的工时占比。
5. 退出条件：样式/兼容单测、横竖版真实桌面预览与导出、保存重开/整次撤销、参数自动暴露、独立审查通过即停止。真实 AI 未获授权或未通过时单独保留该验收门，不冒称整轮最终验收通过。

工作树 `/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`；基线快照 `/tmp/srt-remotion-r4.bX0Rwi/baseline/`。R4 以该快照为差异基准，不把 Git HEAD 之后的全部 R1–R3 改动算成本轮。

## 参数约定

| 字段 | 取值/默认 | 语义 |
| --- | --- | --- |
| cornerRadius | number 0–0.5，默认 0 | 相对底板较短边的圆角半径 |
| borderWidth | number 0–0.1，默认 0 | 相对底板较短边的内描边厚度；0 为无描边 |
| borderColor | #RRGGBB，默认 #FFFFFF | 描边颜色；独立于填充颜色 |
| fillOpacity | number 0–1，默认 1 | 只改变底板填充透明度，不改变描边或同组文字 |

较短边取既有几何转换后的 min(pixelWidth,pixelHeight)。描边位于原外框以内；SVG 描边路径内缩厚度一半、圆角为 max(0,外圆角−厚度/2)。填充使用原外框/外圆角；描边另画，无填充，以免使描边随填充透明。组 opacity 仍只在组层整体合成一次。参数非数值、NaN/Infinity、超界、非法颜色/未知字段按既有错误协议拒绝。

### Task 1: 样式声明、共同场景和兼容性

**Files:** 修改 `src/visual-layers.js`、`app/remotion/layers.jsx`；必要的能力文案/历史入口不降级保护位于 `src/edit-capabilities.js` 或 `src/render-recipe.js`，仅在实际接点需要时修改。测试使用 `tests/visual-layers.test.js`、`tests/remotion-scene.test.js`、`tests/project-editing.test.js`、`tests/instruction-capabilities.test.js`，现有固定默认值断言随中性字段扩展调整，不放宽旧行为断言。

**Interfaces:** 沿用 `normalizeParams(kind, params, requireExplicit)`、`geometry(kind, params, width, height)`、`VisualLayer({layer,width,height})`。shape 规范值/几何值增加四字段；text 不变。派生 graph 可补默认值，持久化旧 document 不写回。

- [x] RED：在 shape normalize/geometry 测试加入以下输入，先见现实现拒绝新增字段；补单独非法值断言。

```js
const p = {x:.1,y:.1,width:.5,height:.25,color:'#101820',
  cornerRadius:.1,borderWidth:.02,borderColor:'#268AFF',fillOpacity:.75};
const g = layers.geometry('shape', p, 640, 360);
assert.equal(g.cornerRadius, 9);
assert.equal(g.borderWidth, 1.8);
assert.equal(g.fillOpacity, .75);
```

- [x] GREEN：SHAPE_PARAMETERS 新增四项约定及清晰中文单位说明；既有规范化循环完成校验，几何转换中从较短边计算圆角/描边，其余参数原样传递。

```js
const shorter = Math.min(geometry.width, geometry.height);
// geometry 的圆角/描边最终为像素；归一化 payload 仍是比例。
geometry.cornerRadius = params.cornerRadius * shorter;
geometry.borderWidth = params.borderWidth * shorter;
geometry.borderColor = params.borderColor;
geometry.fillOpacity = params.fillOpacity;
```

- [x] RED→GREEN：共同 VisualLayer 测试检查填充 rx/ry/fillOpacity 和内描边的实际 SVG；实现普通填充 rect 加有条件的描边 rect，独立 shape 与 group 共用，text 不加透明度。0 半径/0 描边/1 填充保持旧图形面积和像素行为。

```jsx
// w 是几何描边厚度；r 是外圆角。边框四边不得超出 g 外框。
<rect x={g.x+w/2} y={g.y+w/2} width={g.width-w} height={g.height-w}
  rx={Math.max(0,r-w/2)} ry={Math.max(0,r-w/2)}
  fill="none" stroke={g.borderColor} strokeWidth={w} />
```

- [x] RED→GREEN：通过真实解析器验证独立/嵌套参数和生成提示词均包含四个字段；不添加效果样例表。旧图/旧撤销快照可读，读取前后 storage 原字节与 document 不变；新样式保存重开及撤销正确。已有严格深比较只增加明确中性默认值，不删除断言。
- [x] 执行 `node --test tests/visual-layers.test.js tests/visual-group.test.js tests/edit-capabilities.test.js tests/project-editing.test.js tests/instruction-capabilities.test.js tests/remotion-input.test.js tests/remotion-scene.test.js`；修复本轮引入回归，记录完整 RED/GREEN。基线缺陷单列，不扩展成重构。
- [x] 任务独立审查（规格与质量）通过后进入 Task 2。本轮不 commit，报告快照相对差异和变动文件。

### Task 2: 桌面可见成果与整体验收

**Files:** 新增 `tests/e2e/remotion-card-style-flow.spec.js` 和可选独立固定配方文件；沿用 `tests/e2e/electron.fixture.js`，只在 `tests/e2e/electron-main.js` 接入明确固定 R4 场景标记；`package.json` 把该 spec 纳入两个既有 Remotion/完整桌面脚本。更新本计划、状态和研发日志，不新增测试平台。

**Interfaces:** 使用正式编辑输入框→现有 IPC/解析→ProjectEditing→同一 Player/导出按钮。固定配方只存在于测试层。读取已有 `window.editorPlayback`、`window.projectEditing` 及既有页面 test id，优先复用现有测试模式。

- [x] 先加入并运行桌面用例，验证尚无对应固定场景时失败；新增测试配方与测试入口后再 GREEN。横版合成片 640×360、竖版 360×640，24fps、4 秒；保留源音频，无测试媒体入库。
- [x] 用多组/不同开始时间演示参考信息卡结构；至少一组同时含底板和白色文字。检查圆角外侧透出源、填充混色、描边颜色独立于填充、文字不被底板 alpha 改淡、区间外消失；在显式全透明填充时仍看见描边。画幅改变后尺寸按比例计算。
- [x] 同一项目第二请求在另一时段新增一组不同文案/样式的卡片，保存重开保持，撤销只移除第二请求、保留第一组。这里验证参数可调整与已有 append/undo 语义，不宣称已有卡片可原位改字。检查旧项目中没有新字段的卡片仍能打开。个人技能保存/读取沿用现有入口，参考参数保留；不新增技能管理功能。
- [x] 从真实导出按钮产出 MP4，检查源时长/画幅/音轨与样式；至少对静止期的圆角、描边、填充区域做 Player/导出对照，避免取抗锯齿边缘作为纯色采样。沿用每通道 12/255 编码容差，不用放宽容差使测试通过。主代理打开截图和成片抽帧观察。
- [x] 运行 `npm run test:e2e:remotion`，再最终全真实开关 Node 测试与完整 `npm run test:e2e`；记录实际数量、失败和跳过，不照搬 R3 历史结果。若未获真实 AI 授权，不触发模型；已获授权则最多两次人工指令联调，单独记录。
- [x] 全轮快照差异审查及必要修复通过；更新 `docs/PROJECT_STATUS.md`、`docs/DEVELOPMENT_LOG.md`，报告内部验收与用户可见文件，并停止。不自行推送、继续扩展或延长预算。

## 进度记录

- [x] 设计依据/用户确认：参考分析三种路径已呈现，用户本轮确认第 2 项。
- [x] 已确认隔离工作树与写入权限，R1–R3 完整基线快照保留。
- [x] Task 1 完成并独立审查。
- [x] Task 2 本地闭环完成并独立审查。
- [ ] 真实 AI 联调：等待本轮授权；未授权不执行。
- [x] 最终本地验证、可见成果和记录完成；真实 AI 门保持待授权。

Task 1 于 17:32 UTC 交由 `r4_style_implementation` 执行，报告路径 `/tmp/srt-remotion-r4.bX0Rwi/task-1-report.md`。已完成且独立规格/质量审查 Approved，无待修问题；主代理全真实开关 Node/媒体 **418/418**，13.553 秒，零失败/跳过（`task-1-all-real.log`）。17:39 UTC 已产出并查看 1280×720、24fps、4 秒含音轨示范片 `r4-card-style-preview.mp4`，早于半程检查点；它是固定配方服务渲染，不等同于桌面/真实 AI 验收。Task 2 进入桌面验收。最终差异审查使用上述 pre-R4 快照，不更动分支或索引。

基线说明：普通沙箱测试遭本地监听 EPERM；批准沙箱外复跑后网络权限失败消失，但既有 `main-entry.test.js:228` 并发会话断言出现一次 actual[2]/expected[1]。独立诊断确认测试错误假设异步文件检查/会话创建顺序等于请求发起顺序，生产结果仍为 [false,true]；聚焦 1/1 通过。随后完整未改代码复跑 **384 通过 / 0 失败 / 13 个可选真实媒体跳过**（397 项，2.459 秒），日志 `baseline-rerun.log`；未改该基线测试，不拿此计作 R4 修复。

### 最终本地验收（2026-09-09）

- 主代理最终全真实 Node/媒体 **418/418，12.883 秒，零失败/跳过**（`node-final.log`）；Remotion 桌面 **16/16，1.8 分钟**。补强音频识别与重开技能入口断言后，最终完整桌面 **83/83，5.3 分钟，零失败/跳过**（`e2e-final.log`）。其中 16 项新引擎、67 项显式旧路径回归；定向补强结果 1/1，13.2 秒。
- Task 1、Task 2 复审及全轮产品审查均 Approved，无待修项。曾为真实五字段 recipe 兼容回归增加 `src/render-recipe.js` 窄兼容，同时让 `src/video-export.js`、`src/visual-group-export.js` 明确拒绝非中性新样式；没有第二套样式渲染。审查补强只涉及本轮原音频与技能保存/读取验收，未增加产品范围。
- 最终 `e2e-final/remotion-card-style-flow-R-1309b-cards-in-both-aspect-ratios/` 含两份桌面预览与 MP4。主代理独立探测并阅片：640×360 / 360×640、24fps、96 帧、视频 4 秒、AAC 4.010667 秒。五类静态区域仍以内容 sRGB 12/255 容差对照，白字和透明底板边框可见；不宣称屏幕 ICC 或字形抗锯齿逐像素相同。
- 17:39 首份示范提前满足可见检查，18:08 完整回归结束，随后完成日志/状态和差异核对，墙钟约 45 分钟内收尾；未用满 90 分钟。准备/基线约前 5 分钟，之后实现、兼容修正、验收与审查并行；不虚报有效工时或支撑百分比。
- 本轮 AI 问题没有收到明确答复，因此 **0 次真实 AI**，没有视频上传。用户个人参考观感、真实模型推导和跨项目重新适配仍不以固定配方替代；本地功能到此停止，未提交或推送。
