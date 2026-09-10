# Multitrack Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 正式编辑页提供只读分轨、缩放、滚动及准确播放定位。
**Architecture:** 新增纯布局/坐标模块与专用 DOM 控制器；原聊天脚本仅把项目投影交给控制器。项目存储、Remotion 与渲染顺序不变。
**Tech Stack:** 原生 JavaScript/UMD、CSS、Node test、既有 Electron Playwright。

## Global Constraints

- 沿用已批准设计 2026-09-10-multitrack-timeline-design.md。
- 不增加依赖、不搬 OpenCut 编辑核心；自主实现小型布局，不复制第三方代码。
- 时间轴内容视口最高 240px，初始全片，缩放不持久化。
- 不做拖动编辑、吸附、多选、AI修改或存储迁移。
- 保留未关联改动；不推送、不重启用户应用。
- 12:17 UTC 基线完成；12:47 可见检查，13:17 止损检查。

### Task 1：布局与时间坐标

Files: 新建 src/timeline-layout.js、tests/timeline-layout.test.js。
Interfaces: layout(items,duration) 返回 [{lane,label,items}]；items 引用只读。contentWidth(viewport,duration,zoom) 返回可用时间宽度；timeAt(clientX,left,scroll,width,duration) 返回合法秒数；zoomScroll(oldWidth,newWidth,scroll,viewport,playhead,duration) 返回滚动位置。

- [x] 写失败检查：空输入零行；主视频全长；同lane首尾相接共行、重叠分行、不同lane独立；输入JSON前后相等；同输入顺序变化布局稳定。
```js
assert.equal(layout([{editId:'a',lane:'visual',range:{start:0,end:2}},
 {editId:'b',lane:'visual',range:{start:2,end:4}}],4).length,2);
assert.equal(timeAt(250,100,200,800,8),3.5);
```
- [x] 运行 node --test tests/timeline-layout.test.js，确认因缺少功能失败。
- [x] 实现按lane再start/end/id排序，对每项选择 end<=start 的首行，否则新增行；range只读。坐标采取 clamp((clientX-left+scroll)/width*duration,0,duration)。缩放优先保持可见播放头，否则保持中心时间。
- [x] 同命令通过；复跑 project-editing.test.js、render-graph.test.js。

### Task 2：正式页面控制器

Files: 新建 app/editor-timeline-view.js；修改 app/剪辑.html、app/editor-timeline.js；新建 tests/e2e/multitrack-timeline-flow.spec.js。
Interfaces: SRTTimelineView.create({track,viewport,ruler,playhead,current,total,zoomIn,zoomOut,fit,seek}) 返回 render(items,duration)、setTime(seconds)、resize()。原 renderMarkers 将已就绪的项目 items 交给 render，播放订阅调用 setTime。

- [x] 先写 Electron 用例，使用隔离项目和固定媒体信息：检查缩放按钮、source行、同时间视觉项分行、视口限高、水平滚动后点击定位、fit还原、项目JSON不变。
```js
await expect(window.locator('#tlZoomIn')).toBeVisible();
await window.locator('#tlZoomIn').click();
expect(await window.locator('#tlViewport').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
```
- [x] 运行 npx playwright test tests/e2e/multitrack-timeline-flow.spec.js --output=/tmp/srt-multitrack-red，记录缺少控件的失败。
- [x] 添加 #tlViewport 包裹 #tlTrack，后者包含 sticky 标尺、绝对定位行、sticky 行标题及播放头；现有按钮之外新增 -/+/全片，沿用 CSS 变量。内容宽度=标签88px+左右各16px+模型timeWidth。内容最高240px，overflow:auto。source片段不使用旧 .tl-marker 类，保留已有编辑项计数语义。
- [x] 控制器用 textContent 绘制标签。播放头 x=88+16+seconds/duration*timeWidth；定位反向减去同一偏移并计入scrollLeft。mousedown左键在内容区域定位，标签不定位；移动仅更新播放时间，mouseup终止。缩放1..16，fit=1，按钮边界禁用。ResizeObserver观察视口并以rAF合并更新。
- [x] 原 editor-timeline.js 去除旧坐标与逐item行逻辑，保留项目准备与聊天事件。加载顺序为layout→view→原timeline。数据不可用时空内容与禁用控件，不写项目数据。
- [x] 复跑新Electron用例并截图正式页面。检查窄窗和窗口变宽后滚动范围、播放头与点击定位。

### Task 3：回归与交付

Files: package.json（将新用例加入现有test:e2e命令）、docs/DEVELOPMENT_LOG.md。
- [x] 运行 Node 定向检查与构建：node --test tests/timeline-layout.test.js tests/project-editing.test.js tests/render-graph.test.js；npm run build:remotion。
- [x] 运行新用例及 conversation-sidebar-flow.spec.js、project-editing-flow.spec.js、auto-subtitles-flow.spec.js。固定模型/识别结果不是新真实AI验收。
- [x] 查看正式页面截图，检查重叠不遮挡、颜色未变、页面没有无界撑高。
- [x] git diff --check；审查仅视图与测试改变，无项目格式和渲染逻辑变更。记录实际通过/失败及未验收事项，停止扩项。
- [x] 更新本计划复选框与研发日志。仅明确的本轮文件可提交，不包含既有报告改动和其他未跟踪笔记；不推送。
