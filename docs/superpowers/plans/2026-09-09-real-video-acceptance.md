# R8 真实视频验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 当前仅制定计划，未开始实施或真实调用。

**Goal:** 用用户参考视频前 35 秒的原画面、原声，验证一句自然语言可以完成口播提炼、定时重点文字、正式预览、MP4 导出与整次撤销，并交付可播放的实际结果。

**Architecture:** 复用现有本地 Codex CLI → prepare → 本地 ASR → 一次续推 → 项目事务 → Remotion Player／导出。只补现有验收脚本的原画面输入与证据保存，不新建执行器、监控或渲染框架。

**Tech Stack:** 现有 Electron、Playwright、Node.js、本地语音识别、Codex CLI、Remotion；FFmpeg/ffprobe 仅用于剪取样本和检查成片。

## 冻结范围与基线

- 唯一目的：完成 R8 的真实视频验收，不重新开发 R5–R7。
- 实际工作树：`/Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0`；分支 `feature/subtitle-export-cycle0`；计划核对基线 `fa989750d62f86119acb9c6f719bf82bba66e9ea`，核对时工作树干净。
- 现有事实：正式样式、素材及固定响应流程已有本地验证；stdin 修复后简单真实 CLI 连接通过。完整真实语义／成片仍未通过，不能用历史单测或连接测试替代。
- 输入：`/Users/mac/Downloads/37875025116-1-192.mp4` 前 35 秒，另存测试副本，不覆盖原文件。不是整部长片验收。
- 使用当前已选 Codex CLI 和已准备本地模型。仅将该片段的识别文字和现有项目上下文送给 CLI；不上传视频，不读取／展示认证秘密，不改用户模型或网络设置。
- 保持现有界面配色与已认可的文字、卡片样式；本轮主验收是自动提炼的重点文字，不新增卡片类型、不重做毛玻璃。
- 不做：平台化、自动重试系统、长期监控、换渲染核心、任意代码执行、视频人物跟踪、无语音画面理解、多平台发行、长视频全覆盖、额外效果库。
- 隔离测试项目，保留用户真实项目与当前预览服务。检测页／文件对话框的测试替身须在报告中说明；不称为人工桌面验收。
- 本轮不自动提交或推送 Git。实施后更新研发日志，再按用户指令备份。

## 执行检查点与退出条件

以下数字只用于检查进度，**不作为完成时间预测**。完整真实流程没有成功耗时样本；本轮投入硬上限为 **60 分钟**，包含模型和渲染等待。

| 小步骤 | 首次检查点 | 可检查成果 | 结束条件 |
| --- | --- | --- | --- |
| 1. 补齐验收入口 | 开工后 8 分钟 | 原视频测试副本、可落盘的证据路径 | 不再只使用纯色底片；撤销前数据可保留 |
| 2. 跑真实链路 | 入口就绪后立即开始 | 真实 AI 要点在编辑器显示并导出，或有证据的失败节点 | 真实结果进入正式预览和 MP4；失败则进入限定诊断 |
| 3. 核对成片并交付 | 成片出现后立即开始 | 可播放 MP4、画面前后对照、验收清单 | 语义／时间／画面／声音／撤销逐项有结论 |
| 记录与交接 | 验收有结论后立即开始 | 日志与明确完成边界 | 满足验收即停止 |

- 到第 20 分钟，应已有第一份真实可见结果；没有就报告卡在哪一步，不继续只堆内部代码。
- 准备、证据工具与记录属于支撑工作，按实际投入接近 25% 时检查；准备预计最多 8 分钟，超过 16 分钟立即停报。
- 默认一次真实流程，无字幕路径预期两次 CLI 调用。只有定位并修复实际阻断后才允许一次验证性复跑；本阶段最多两轮、四次 CLI 调用，不为挑选漂亮结果重复生成。
- 首轮实测证明 60 秒会在 Codex 已生成合法最终消息、但进程尚未正常退出时误杀；因此仅将单次 CLI 有界等待校准为 90 秒，64 KiB、一次 prepare＋一次续推、正常退出要求均不改。网络／证书问题不以关闭 TLS 校验解决。
- 阻断定位与最小修复合计最多 15 分钟，并计入 60 分钟总上限。第二轮仍失败、需要改全局配置／更换服务／重构架构、或到上限，即停止并报告，不能标记验收通过。
- 已有顺序敏感的预览会话编号测试记录为已知问题；除非本轮证据指向真实预览故障，不将其变成新工程任务。

## 文件职责

- 修改 `tests/e2e/real-keypoints-flow.spec.js`：原视频输入、撤销前快照／原文落盘、重开及撤销断言；沿用真实 CLI／ASR／Remotion 流程。
- 窄改 `tests/e2e/electron-main.js`：修正证据中失败但缺失 error.code 被记为 0 的歧义；不修改模型调用方式。
- 复用 `tests/e2e/keypoint-text-flow.spec.js`：已有字幕、草稿保留、旧编辑保留及无重复调用的固定响应检查，不新造测试平台。
- 复用 `tests/e2e/electron.fixture.js`：隔离项目及清理；原生对话框受控测试路径的限制保留并说明。
- 更新 `docs/DEVELOPMENT_LOG.md`：只记实际执行的结果、失败和证据位置。
- 产品代码默认不改；若真实失败证明必须改，只改已定位的最小入口，先补失败回归再修复。不能预先列入提示词、渲染器和状态系统的重写。

## Task 1：让现有测试留下可信的原视频证据

**接口：** 沿用 `SRT_REAL_KEYPOINT_SOURCE`、`SRT_REAL_KEYPOINT_USER_DATA`、`readScenarioState()`、`projectEditing.load(getActiveProjectId())` 和 `testInfo.outputPath()`。

- [ ] 只读确认上述基线、原片可读、已选 CLI 与已准备模型；不另做一轮收费连接探针。
- [ ] 将已有纯色画面输入替换为前 35 秒原画面与原声；保留 1280×720／30fps 的既有测试工作量。原片不是此比例时，以保持比例加留边方式缩放，不拉伸。

```js
await run(ffmpeg, ['-v', 'error', '-i', process.env.SRT_REAL_KEYPOINT_SOURCE,
  '-map', '0:v:0', '-map', '0:a:0', '-t', '35',
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
```

- [ ] 在点击生成前保存 `before.json`；成功应用后、导出和撤销前保存 `applied.json` 与 `real-ai-recipe.json`，不用仅正文附件。三个项目快照均取实际 `projectEditing.load()` 返回值，不手造编辑数据。

```js
const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
await fs.writeFile(testInfo.outputPath('before.json'), JSON.stringify(before, null, 2));
// 在既有 const snapshot = ... 之后：
await fs.writeFile(testInfo.outputPath('applied.json'), JSON.stringify(snapshot, null, 2));
const recipePath = testInfo.outputPath('real-ai-recipe.json');
await fs.writeFile(recipePath, JSON.stringify({
  edits: snapshot.document.edits,
  transcript: state.translationCalls[1].context.transcript
}, null, 2));
await testInfo.attach('real-ai-recipe', {path: recipePath, contentType: 'application/json'});
```

- [ ] 进程证据替换单个字段，只有无错误才记成功退出码；保留 killed、signal 和时长。

```js
code: error ? (error.code ?? null) : 0,
```

- [ ] 应用后增加重开验证，保存／恢复后不重新调用 CLI；撤销前后核对实际编辑列表，本次不会创建字幕轨。每次取得比较值都读取生产项目状态。

```js
const callsBeforeReload = state.translationCalls.length;
await window.reload();
await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
expect((await readScenarioState()).translationCalls.length).toBe(callsBeforeReload);
expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.edits))
  .toEqual(snapshot.document.edits);
// 接在既有撤销操作与等待之后：
const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
expect(undone.document.edits).toEqual(before.document.edits);
await fs.writeFile(testInfo.outputPath('undone.json'), JSON.stringify(undone, null, 2));
```

- [ ] 仅做脚本语法及差异检查。本任务没有产品行为实现，不为测试脚本再搭一套测试框架。

```sh
node --check tests/e2e/real-keypoints-flow.spec.js
node --check tests/e2e/electron-main.js
git diff --check
```

预期三个检查均退出 0；这只是入口准备，不计真实验收通过。

## Task 2：一次真实用户请求贯通正式预览与导出

- [ ] 记录开始时间，沿用现有请求，不提供答案样例或固定配方：

> 提炼整段视频口播中的关键观点，在对应讲述位置弹出重点文字。每个要点用醒目的大标题、简短说明和小标签组成，白色粗体，轻阴影，淡入并略微放大，结束淡出。放左右两侧，避开底部字幕区域，不生成字幕轨。只根据口播提炼，不要编造。

- [ ] 使用独立输出目录，零自动重试，运行现有 opt-in 入口。需额外进程／网络权限时按工具正常申请，不借其他机器或代理绕过。

```sh
acceptance_dir=$(mktemp -d /tmp/srt-real-video-acceptance.XXXXXX)
SRT_REAL_KEYPOINT_SOURCE=/Users/mac/Downloads/37875025116-1-192.mp4 \
SRT_REAL_KEYPOINT_USER_DATA='/Users/mac/Library/Application Support/srt' \
npx playwright test tests/e2e/real-keypoints-flow.spec.js \
  --workers=1 --retries=0 --output="$acceptance_dir/e2e" \
  > "$acceptance_dir/run.log" 2>&1
```

- [ ] 核对本轮真实证据：当前 CLI 身份一致、首轮 prepare、一次本地识别、完整定时原文进入续推、合法指令、事务一次提交、正式 Player、实际导出与撤销。不能以“成功”文案代替项目和文件检查。
- [ ] 预期为 1 个真实用例通过且未跳过；语义与画面仍须 Task 3 单独验收。保留失败结果；一次真实反问并不证明连接断开，但不满足本条明确请求的自动完成验收，也不能换固定输出冒充成功。
- [ ] 如果失败，先按连接／识别／解析／应用／渲染分类，保存原始退出状态和失败截图。只对已证明的本链路阻断做窄修复与相关回归；超出前述额度停止。60→90 秒的校准必须保留上述实际完成时间证据；不得再凭感觉延长或忽略失败退出。

## Task 3：成片、语义和项目行为验收

- [ ] 逐组对照实际口播、识别原文与 AI 标题／说明／标签：不颠倒含义、不编造事实；时间区间与对应语句有可解释的对应，不能只是落在 0–35 秒内。识别有错时以实际语音为准，不能改原文／答案来制造通过。
- [ ] 播放完整导出片段，逐组抽查入场／停留／退场和组间空白：文字清晰，没有溢出或严重遮挡，淡入、轻缩放、淡出确实可见。位置避让只是本样本观感验收，不宣称有人脸跟踪。
- [ ] 对同时间的源视频、Player 和导出帧做对照，区分原片烧录文字与本轮新生成图层。复查画面或重新渲染复用首次真实配方，不再次调用模型；不另建独立效果演示冒充正式成片。
- [ ] 用现有 ffprobe／媒体检查方法确认 MP4 可解码、时长接近 35 秒、包含原声，并播放听查开头／中段／结尾无明显音画错位。只存在音轨不等于声音正确。
- [ ] 实际证据确认保存重开不重跑模型、一次撤销移除本次所有要点、空项目未新增字幕。已有字幕／草稿／旧编辑保留沿用下方固定响应回归，清楚标为固定响应，不能冒充第二条真实模型路径。

```sh
npx playwright test tests/e2e/keypoint-text-flow.spec.js --workers=1 --retries=0
```

预期现有 9 项通过、未跳过。若只有验收脚本变更，不无差别复跑全项目；若修了产品，再加该改动直接相关的回归并记录实际范围。

- [ ] 将 MP4、关键帧、前后快照、原文与配方保存为可访问的本地验收产物；媒体和全文不入 Git，日志不含凭据或模型推理正文。报告明确产物为临时目录保存，长期备份另按用户指令办理。
- [ ] 更新研发日志，分别列出“内部完成度”“用户可见成果”“失败／未验收项”。报告测试使用隔离 Electron 与受控对话框，并请用户只需检查最终观感，不把工程验收留给用户代跑。

## 完成判定

只有真实语音提炼、逐组语义／时段核对、原画面预览与实际 MP4、原音检查、保存重开及整次撤销均有通过证据，才标记“本段真实视频工程验收通过”。用户最终审美确认单列，不能替用户宣布。

成果是前 35 秒的一条真实自动提炼闭环，不是“所有视频、所有效果、所有模型都已稳定”。失败时交付失败节点和证据，保持 R8 真实验收未完成。

## 本计划自检

- [x] 已核对实际基线和测试；纯色底片不足以代替原视频，已纳入原画面验收。
- [x] 没有重做卡片、增加监控平台或扩充未来效果；证据修正直接服务既定验收。
- [x] 测试替身、真实调用、用户观感三者分别记录；调用和时间均有止损线。
- [x] 本轮只新增本计划，不运行测试／模型、不改产品、不提交 Git。
