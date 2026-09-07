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
3. AI 可见的每个 capability 版本必须已经同时具备其全部声明参数的校验、项目写入、时间轴展示、画面预览和真实导出；不完整参数不能提前写进 schema。
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
projectEditing.initializeProject({
  projectId,
  mediaFacts,
  legacySubtitleState
})
// => { document, graph }

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
  editId,
  payload
})
// => { document, graph }

projectEditing.canUndo({ projectId, transactionId })
// => boolean

projectEditing.undo({
  projectId,
  expectedRevision,
  transactionId
})
// => { document, graph }

projectEditing.timelineItems(projectId)
// => [{ editId, transactionId, lane, range, label, summary }]

projectEditing.aiContext(projectId)
// => { revision, edits, subtitleSummary }
```

`translateAndApply`、字幕编辑区、时间轴和导出按钮都不判断 capability ID。能力校验、时间补全、资源准备、事务提交、撤销、RenderGraph 编译和项目上下文投影全部隐藏在该 seam 后。

`applyRecipe` 是 Recipe 标准化的唯一所有者，renderer 不预先转换另一份中间结构。`initializeProject` 是新项目媒体事实和旧字幕迁移的唯一入口；新项目必须等待视频 metadata 就绪，不能创建时长为 0 的文档。

`replaceEdit` 用于字幕文稿和未来属性面板的“应用”。它增加 document revision，但不创建新事务。若被修改的 edit 属于当前可撤销事务，则推进该 undo 记录的 `afterRevision` 并保留原 inverse；否则清空旧的一次撤销，避免 inverse 应用到不匹配状态。

## 6. 三种数据的职责

### 6.1 AI Recipe

AI Recipe 是不可信提案。进入 `ProjectEditing` 后才标准化。支持时间范围的能力使用长期形状：

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

第一周期的 `subtitle.generate@1` 只生成全片字幕，`range.allowed` 为 `false`，不接受 `start/end`。这样不会出现时间轴显示局部区间、导出却烧录全片字幕的双重语义。局部字幕需要单独定义后才能开放。

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
    },
    {
      "id": "node-subtitles",
      "type": "visual.subtitle@1",
      "range": { "start": 0, "end": 18.4 },
      "inputs": [
        { "port": "base", "nodeId": "node-video" }
      ],
      "props": { "segments": [], "style": {} }
    }
  ],
  "outputs": {
    "video": { "nodeId": "node-subtitles", "port": "video" },
    "audio": { "nodeId": "node-video", "port": "audio" }
  }
}
```

第一周期只实现并校验上面的线性图：节点 ID 唯一、节点类型已注册、字幕节点连接当前 video head、范围位于项目时长内、只有一个视频输出。任意分支、通用端口类型、向后引用和关键帧校验在图层或关键帧周期真正需要时再加入。

## 7. Capability Catalog

Catalog 是 AI 提示、Recipe 校验和执行支持的唯一能力来源。它不只保存描述，而是把同一 capability 版本的定义与真实 Adapter 函数注册在一起：

```js
{
  definition: {
    schemaVersion: 1,
    id: 'video.color.adjust@1',
    label: '画面调色',
    description: '调整色温、亮度、饱和度和对比度',
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        temperature: { type: 'number', minimum: -1, maximum: 1, default: 0 },
        brightness: { type: 'number', minimum: -1, maximum: 1, default: 0 }
      }
    },
    range: { allowed: true, default: 'wholeTarget' }
  },
  prepare: Function,
  toEdit: Function,
  toGraph: Function,
  toTimeline: Function,
  preview: Function,
  toExport: Function
}
```

某项能力只有同时满足以下条件才加入 AI 提示：

```text
完整参数与时间 schema 可用
AND prepare 函数可用（不需要准备的能力使用明确的 no-op）
AND toEdit 函数可用
AND toGraph 函数可用
AND toTimeline 函数可用
AND preview 函数可用
AND toExport 函数可用
```

这项判断直接从 registration 上的实际函数计算，并由契约测试删除任一函数后验证能力会消失；不依赖手工维护的 `enabled` 或支持 ID 集合。

## 8. 通用底层积木

当前核心底层积木按可组合的视觉变化设计，不按用户效果名称设计：

- `video.color@1`：色温、亮度、曝光、饱和度、对比度和色彩矩阵。
- `video.transform@1`：首版只开放翻转和中心缩放；旋转、位置和裁剪在各自 Adapter 完整后再扩展 schema。
- `visual.shape@1`、`visual.text@1`：覆盖层内容。
- `video.composite@1`：图层顺序、遮罩和混合。
- 关键帧值：首版只用于透明度和缩放，并只开放固定缓动；其他属性后续按真实需求加入。
- `video.noise@1`、`video.vignette@1`：基础质感。
- `visual.subtitle@1`：可编辑字幕轨。

“跳出卡片”首版由形状、文字、合成、缩放和透明度关键帧组成，不注册同名预设能力。

## 9. Adapters

- `ProjectStore Adapter`：生产使用按项目的 localStorage；测试使用内存实现。
- `Prepare Adapter`：字幕生成使用现有 Whisper IPC；将生成结果变为可信 edit payload。
- `Timeline Projection`：registration 的 `toTimeline` 把 edit 转为统一 `{editId, transactionId, lane, range, label, summary}`。
- `Preview Adapter`：registration 的 `preview` 根据当前播放时间解释 RenderGraph，不能绕过 graph 直接维护第二份状态。
- `Export Adapter`：registration 的 `toExport` 把相同 RenderGraph 编译成受控 FFmpeg 参数数组和辅助资源，继续使用 `shell:false`。

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

第一周期沿用一次撤销，不建设无限历史。异步资源准备结束后必须再次检查 `expectedRevision`，避免旧任务覆盖新编辑。`subtitle.generate@1` 使用 `replaceByType`：重复生成替换项目唯一字幕轨，inverse 保存生成前的完整字幕轨或空状态。

AI Recipe、EditDocument、RenderGraph 和 CapabilityDefinition 分别使用 `schemaVersion`。能力、edit type 和 graph node type 使用 `@1` 版本；参数含义或视觉语义不兼容时升级版本。RenderGraph 不需要迁移，因为它可以从 EditDocument 重新生成。

旧字幕迁移由 renderer composition root 读取旧状态，再交给 `initializeProject`。只有新 EditDocument 不存在且视频 metadata 已就绪时才迁移；先成功写入新状态，再迁移独立字幕草稿。旧 key 保持只读，任何一次失败都可在下次打开时幂等重试。

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

现有通用积木无法表达新的底层算法时，可以在未来重新立项探索受控扩展。扩展生成、校验、预览和导出全部完成前，不得加入 AI 的常规能力目录。核心开发路线不执行 AI 返回的任意 Shell、FFmpeg 字符串或程序代码。

## 14. 开发周期

| 周期 | 唯一目标 | 用户可检验结果 | 止损上限 |
|---|---|---|---:|
| 1 | 统一执行主干 | 字幕通过 ProjectEditing 完整运行；刷新、撤销、导出一致；未接通能力不再假成功 | 6 小时 |
| 2 | 通用颜色 | 冷暖、亮度、饱和度、对比度可按区间预览、保存、撤销、导出 | 5 小时 |
| 3 | 基础画面变换 | 水平/垂直翻转与中心缩放可完整执行 | 5 小时 |
| 4 | 文字与形状图层 | AI 可临时组合静态提示卡片并完整导出 | 6 小时 |
| 5 | 最小关键帧动画 | 卡片可通过缩放和透明度形成跳出和淡入淡出 | 6 小时 |
| 6 | 质感积木 | 颗粒、暗角及其与颜色的组合完整执行 | 4 小时 |
| 7 | 个人剪辑技能 | 保存意图、偏好和参考配方，在新视频中重新推导 | 4 小时 |

这些时间是单周期止损上限，不是必须花满的预估。核心周期累计上限为 36 小时。每个周期验收通过后立即结束，后续能力进入自己的周期。

依赖关系：

```text
周期 1
├─ 周期 2 ─ 周期 6
└─ 周期 3 ─ 周期 4 ─ 周期 5 ─ 周期 7
```

音频编辑、内容定位和受控 AI 扩展不属于当前核心 83% 的交付承诺：音频以后先从源视频音量开始；内容定位先从现有字幕语义开始，镜头与音频事件分别立项；受控扩展仅在基础积木无法满足高频需求后做独立实验。

## 15. 总体验收

1. AI 能力目录中的每项能力都可以产生时间轴项目、实时预览和真实导出。
2. 用户可以把多个积木组成一条自然语言编辑，整条提交或整条失败。
3. 刷新、重新打开项目、撤销和导出后，用户看到的编辑保持一致。
4. 下一条指令能够引用前面的项目状态和编辑结果。
5. 冷色、提亮、翻转、跳出卡片和复古氛围都由通用积木组合产生，不存在同名固定效果脚本。
6. 个人技能在不同视频上生成不同配方，但保持同一用户意图和偏好。
7. AI 输出始终是声明式数据，执行器不会运行 AI 返回的任意命令或代码。
