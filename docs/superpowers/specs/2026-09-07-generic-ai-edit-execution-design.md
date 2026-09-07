# 通用 AI 剪辑执行链设计

**日期：** 2026-09-07  
**状态：** 已确认方向，进入实施规划

## 1. 产品目标

用户每次用自然语言描述当前视频想要的剪辑结果。AI 根据当前视频、项目状态、已有编辑和用户偏好，实时推导底层积木、参数、时间范围与执行顺序。软件将这份声明式配方转换成可保存、可预览、可撤销并可真实导出的编辑结果。

用户效果不是预设名称。只要现有底层积木可以表达，AI 可以产生新的组合，不需要开发一条与该效果同名的执行链。

个人剪辑技能采用“意图 + 偏好 + 上次成功配方参考”的形式。每次使用技能仍由 AI 针对新视频重新推导，不原样重放旧配方。

## 2. 当前基线

当前系统存在三份互不一致的能力范围：

- AI 推导层声明字幕、淡入、淡出、调色、颗粒和暗角六种能力。
- 时间轴只接受淡入与淡出，并把它们保存为页面内存 marker。
- 真实导出只接受一个 `subtitle.burn@1` 字幕步骤。

字幕是当前唯一贯通生成、编辑、预览、按项目保存、撤销和导出的能力。第一阶段必须先消除三份能力目录之间的漂移。

## 3. 已确认的设计决策

1. 采用“AI Recipe → ProjectEditing → EditDocument → RenderGraph → 各目标 Adapter”的结构。
2. AI 只输出声明式 JSON，不输出 Shell、FFmpeg 命令、HTML、CSS 或 JavaScript。
3. AI 可见能力必须已经同时具备参数校验、项目写入、时间轴展示、画面预览和真实导出。
4. 一条自然语言指令产生一个事务。全部步骤准备、校验和编译成功后才写入项目。
5. `EditDocument` 是已应用编辑的唯一事实来源。
6. `RenderGraph` 从指定版本的 `EditDocument` 即时编译，不单独持久化。
7. 时间轴只显示 `EditDocument` 的通用投影，不保存另一份效果状态。
8. 预览与导出使用同一份标准化参数语义；运行时失败不会修改已提交的项目状态。
9. 用户撤销时，以整条自然语言指令为单位撤销。
10. 字幕“保存但尚未应用”的文字属于项目草稿，不进入 `EditDocument` 或 `RenderGraph`。

## 4. 核心业务流程

```text
用户自然语言
  → 注入当前项目快照和可执行能力目录
  → AI 返回 clarify 或有序 Recipe
  → ProjectEditing 预检全部步骤
  → 准备字幕等异步资源
  → 生成候选 EditDocument
  → 编译并校验候选 RenderGraph
  → 原子写入 document + undo transaction
  → 时间轴、预览、导出和下一轮 AI 上下文读取同一 revision
```

如果任何一步不能执行，文档版本不增加，也不留下部分编辑。项目保存成功而预览临时失败时，界面显示“编辑已保存，预览暂时不可用”，预览可以从同一文档重新加载。

## 5. 深模块及 Interface

统一 seam 位于 AI 已产生有效 `instruction.steps` 之后。调用者只使用 `ProjectEditing`：

```js
projectEditing.load(projectId)
// => { document, graph }

projectEditing.applyRecipe({
  projectId,
  expectedRevision,
  requestId,
  recipe
})
// => Promise<{ document, graph, transactionId }>

projectEditing.replaceEdit({
  projectId,
  expectedRevision,
  requestId,
  editId,
  payload
})
// => { document, graph, transactionId }

projectEditing.undo({
  projectId,
  expectedRevision,
  transactionId
})
// => { document, graph }
```

`translateAndApply`、字幕编辑区、时间轴和导出按钮都不判断 capability ID。能力校验、时间补全、资源准备、事务提交、撤销、RenderGraph 编译和项目上下文投影全部隐藏在该 seam 后。

## 6. 三种数据的职责

### 6.1 AI Recipe

AI Recipe 是不可信提案。第一周期兼容现有 `capability + params + start/end` 输入，进入 `ProjectEditing` 后立即标准化。长期形状为：

```json
{
  "kind": "instruction",
  "steps": [
    {
      "capability": "video.color.adjust@1",
      "target": { "kind": "projectSource", "id": "main-video" },
      "range": { "start": 5, "end": 10 },
      "params": { "temperature": -0.8, "brightness": 0.25 }
    }
  ]
}
```

AI 不得提供项目 revision、事务 ID、本地路径、Adapter 名称或执行命令。这些可信字段由软件补充。

### 6.2 EditDocument

`EditDocument` 保存项目已经应用的编辑：

```json
{
  "schemaVersion": 1,
  "projectId": "project-1",
  "revision": 7,
  "timeline": {
    "duration": 18.4,
    "canvas": { "width": 1920, "height": 1080 }
  },
  "sources": [
    {
      "id": "main-video",
      "assetId": "asset-video-1",
      "kind": "video",
      "range": { "start": 0, "end": 18.4 }
    }
  ],
  "edits": [
    {
      "id": "edit-1",
      "transactionId": "transaction-4",
      "type": "subtitle.track@1",
      "target": { "kind": "source", "id": "main-video" },
      "range": { "start": 0, "end": 18.4 },
      "payload": { "segments": [], "style": {} },
      "order": 10,
      "enabled": true
    }
  ]
}
```

同一用户请求产生的 edits 共用一个 `transactionId`。时间统一放在外层 `range`，参数和内容放在对应 edit type 的 `payload`。素材只使用项目内 `assetId`，AI 不能提供文件路径。

### 6.3 RenderGraph

`RenderGraph` 是指定 document revision 的临时施工图：

```json
{
  "schemaVersion": 1,
  "projectId": "project-1",
  "documentRevision": 7,
  "duration": 18.4,
  "nodes": [
    {
      "id": "node-video",
      "type": "source.video@1",
      "range": { "start": 0, "end": 18.4 },
      "inputs": [],
      "props": { "assetId": "asset-video-1" }
    }
  ],
  "outputs": {
    "video": { "nodeId": "node-video", "port": "video" },
    "audio": null
  }
}
```

节点 ID 唯一；节点按拓扑顺序排列，只能引用更早的节点；端口类型必须匹配；时间和关键帧必须位于项目时长内；所有 `props` 拒绝未知字段；图必须有一个视频输出，音频输出可选。

## 7. Capability Catalog

Catalog 是 AI 提示、Recipe 校验和执行支持的唯一能力来源。每个定义包含：

```js
{
  id: 'video.color.adjust@1',
  label: '画面调色',
  description: '调整色温、亮度、饱和度和对比度',
  params: { /* 类型、范围、默认值 */ },
  range: { allowed: true, default: 'wholeTarget' },
  prepareAdapter: null,
  compileAdapter: 'compile.video.color.adjust@1',
  editTypes: ['video.color@1'],
  graphNodeTypes: ['video.color@1'],
  presentation: {
    lane: 'video-effects',
    label: '调色',
    summaryKeys: ['temperature', 'brightness']
  }
}
```

某项能力只有同时满足以下条件才加入 AI 提示：

```text
参数与时间 schema 可用
AND prepareAdapter（如需要）可用
AND compileAdapter 可用
AND timeline presentation 可用
AND 所有 graphNodeTypes 有 Preview Adapter
AND 所有 graphNodeTypes 有 Export Adapter
```

这项判断由程序和契约测试完成，不依赖手工维护一个独立的 `enabled` 开关。

## 8. 通用底层积木

底层积木按可组合的视觉和音频变化设计，不按用户效果名称设计：

- `video.color@1`：色温、亮度、曝光、饱和度、对比度和色彩矩阵。
- `video.transform@1`：位移、缩放、旋转、翻转和裁剪。
- `visual.shape@1`、`visual.text@1`、`visual.image@1`：覆盖层内容。
- `video.composite@1`：图层顺序、遮罩和混合。
- 通用关键帧值：静态值或 `{kind:'keyframes', frames:[...]}`。
- `video.noise@1`、`video.vignette@1`、`video.blur@1`：基础质感。
- `audio.gain@1`、`audio.mix@1`：音量和混音。
- `visual.subtitle@1`：可编辑字幕轨。

“跳出卡片”由形状、文字、合成、缩放、位移和透明度关键帧组成，不注册同名预设能力。

## 9. Adapters

- `ProjectStore Adapter`：生产使用按项目的 localStorage；测试使用内存实现。
- `Prepare Adapter`：字幕生成使用现有 Whisper IPC；将生成结果变为可信 edit payload。
- `Timeline Projection`：把 edits 转为统一 `{editId, transactionId, lane, range, label, summary}`，不判断具体 capability。
- `Preview Adapter`：根据当前播放时间解释 RenderGraph，驱动视频变换、滤镜和覆盖层。
- `Export Adapter`：把相同 RenderGraph 编译成受控 FFmpeg 参数数组和辅助资源，继续使用 `shell:false`。

新增用户效果组合不会改变这些调用流程。新增真正的底层节点时，只新增其 schema、lowering 以及目标 Adapter 实现。

## 10. 撤销与版本

项目状态外壳保存有限撤销记录：

```json
{
  "document": {},
  "undoStack": [
    {
      "transactionId": "transaction-4",
      "requestId": "request-8",
      "beforeRevision": 6,
      "afterRevision": 7,
      "inverse": { "put": [], "remove": ["edit-1"] }
    }
  ]
}
```

第一周期沿用一次撤销，不建设无限历史。异步资源准备结束后必须再次检查 `expectedRevision`，避免旧任务覆盖新编辑。

AI Recipe、EditDocument、RenderGraph 和 CapabilityDefinition 分别使用 `schemaVersion`。能力、edit type 和 graph node type 使用 `@1` 版本；参数含义或视觉语义不兼容时升级版本。RenderGraph 不需要迁移，因为它可以从 EditDocument 重新生成。

## 11. 错误语义

- Recipe 结构、目标、时间、参数或引用非法：不修改项目。
- 能力未完整接通或目录版本变化：不修改项目并重新推导。
- 字幕生成等准备失败：不修改项目。
- RenderGraph 编译或目标支持检查失败：不修改项目。
- 项目 revision 冲突或保存失败：保留旧 revision。
- 预览运行失败：编辑保持已保存，可重试预览。
- 导出运行失败：编辑保持已保存，可重新导出。

界面显示失败阶段和用户可采取的动作，不显示内部命令、路径或原始异常。

## 12. 个人剪辑技能

个人技能独立保存：

```json
{
  "schemaVersion": 1,
  "id": "skill-1",
  "name": "重点提示卡",
  "intent": "强调一句重要内容",
  "preferences": {
    "description": "黑色圆角卡片、白字、快速弹入、轻微回弹"
  },
  "referenceRecipe": {},
  "capabilityVersions": ["visual.shape.create@1", "visual.text.create@1"],
  "createdAt": 0,
  "updatedAt": 0
}
```

用户明确保存成功编辑后才创建技能。再次使用时，把意图、偏好和参考配方注入 AI，AI 根据新项目重新推导，再走普通 `ProjectEditing.applyRecipe()`。技能不拥有另一条执行路径。

## 13. 受控 AI 渲染扩展

现有通用积木无法表达新的底层算法时，可以在未来实验周期探索受控扩展。扩展生成、校验、预览和导出全部完成前，不得加入 AI 的常规能力目录。第一阶段不执行 AI 返回的任意 Shell、FFmpeg 字符串或程序代码。

## 14. 开发周期

| 周期 | 唯一目标 | 用户可检验结果 | 止损上限 |
|---|---|---|---:|
| 1 | 统一执行主干 | 字幕通过 ProjectEditing 完整运行；刷新、撤销、导出一致；未接通能力不再假成功 | 6 小时 |
| 2 | 通用颜色 | 冷暖、亮度、饱和度、对比度可按区间预览、保存、撤销、导出 | 5 小时 |
| 3 | 通用变换 | 翻转、旋转、缩放、位置变化可完整执行 | 5 小时 |
| 4 | 文字与形状图层 | AI 可临时组合静态提示卡片并完整导出 | 6 小时 |
| 5 | 通用关键帧动画 | 卡片可通过缩放、位移和透明度形成跳出、滑入和淡出 | 6 小时 |
| 6 | 质感与合成 | 颗粒、暗角、模糊及多积木氛围组合完整执行 | 4 小时 |
| 7 | 音频积木 | 音量、音频淡入淡出和基础混音进入同一项目状态 | 5 小时 |
| 8 | 内容定位 | 支持依据字幕、镜头和音频事件定位编辑区间 | 6 小时 |
| 9 | 个人剪辑技能 | 保存意图、偏好和参考配方，在新视频中重新推导 | 4 小时 |
| 10 | 受控扩展实验 | 用一个隔离实验验证 AI 生成新底层算法的可行性，再决定是否产品化 | 8 小时 |

这些时间是单周期止损上限，不是必须花满的预估。周期 1–9 的累计上限为 47 小时；周期 10 独立计算。每个周期验收通过后立即结束，后续能力进入自己的周期。

依赖关系：

```text
周期 1
├─ 周期 2 ─ 周期 6
├─ 周期 3 ─ 周期 4 ─ 周期 5
├─ 周期 7
├─ 周期 8
└─ 周期 9（建议在周期 4–5 后实施）

周期 10 独立实验
```

## 15. 总体验收

1. AI 能力目录中的每项能力都可以产生时间轴项目、实时预览和真实导出。
2. 用户可以把多个积木组成一条自然语言编辑，整条提交或整条失败。
3. 刷新、重新打开项目、撤销和导出后，用户看到的编辑保持一致。
4. 下一条指令能够引用前面的项目状态和编辑结果。
5. 冷色、提亮、翻转和跳出卡片都由通用积木组合产生，不存在同名固定效果脚本。
6. 个人技能在不同视频上生成不同配方，但保持同一用户意图和偏好。
7. AI 输出始终是声明式数据，执行器不会运行 AI 返回的任意命令或代码。
