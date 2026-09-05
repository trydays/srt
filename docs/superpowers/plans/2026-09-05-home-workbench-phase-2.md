# 工作台式首页阶段二 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变既有上传、项目和组件能力的前提下，把上传首页重排为紧凑、可导航的本地工作台。

**Architecture:** 运行时代码只修改 `app/主页.html`，复用已有 localStorage 项目、IndexedDB 素材、`openProject()`、头像偏好和 `组件展示.html`。新增一条 Playwright Electron 组合用例验证首页结构、两个组件库入口、上传闭环和最近项目入口；不新增数据层、模板引擎或共享 UI 抽象。

**Tech Stack:** Electron 33、HTML/CSS、原生 JavaScript、现有 localStorage/IndexedDB、Playwright Electron。

## Global Constraints

- 阶段二唯一目的：在不削弱上传入口的情况下，让首页承担继续项目、发现工作流和进入组件库的导航职责。
- 可见成果：紧凑上传条、作为视觉主体的最近项目、三个静态工作流参考、组件效果预览、顶部与预览区两个组件库入口、本地头像。
- 明确不做：账号、登录、会员、云同步、推荐算法、模板引擎、模板状态、组件运行时、组件库重写、缩略图/时长/FFmpeg 媒体分析、多项目 Blob 迁移、Agent 或编辑器扩展。
- 总实施硬上限 4 小时；2 小时时必须已有可手动查看的首页；支撑工作硬上限 1 小时且累计占比不得超过 25%。
- 达到“上传可用、最近项目可打开、两个组件库入口可达、头像偏好不退化、常用桌面宽度无遮挡”后立即结束。
- 运行时代码只改 `app/主页.html`；测试只新增 `tests/e2e/home-workbench-flow.spec.js` 并更新 `package.json` 的既有显式 E2E 列表。
- 不修改 `app/shared.js`、`app/shared.css`、`app/组件展示.html`、main、preload、CLI、fixture 或现有测试文件。
- 不新增依赖、网络请求、schema、通用组件层、测试延迟、截图金丝雀、精确像素断言或尺寸矩阵。
- 保留 `dropZone`、`.drop-zone__card`、`video-input`、`start-editing`、`recentGrid`、`localAvatar`、`preferencesPopover` 和 `data-project-id`，避免复制或改写既有数据流。
- 组件预览继续使用首页现有 CSS 动画和现有 `组件展示.html`；不新增第二份组件数据。
- 工作流卡仅用于解释可实现的剪辑方向，不保存选择、不声称已应用模板，也不创建项目。
- 不提交或修改 `.superpowers/brainstorm/`。

## Budget Ledger

| 检查点 | 总投入上限 | 支撑投入上限 | 必须出现的用户可见成果 |
|---|---:|---:|---|
| RED 用例与首页骨架 | 0.75 h | 0.15 h | 顶部工作台/组件库入口与四个首页区块 |
| 可操作首页 | 2.00 h | 0.40 h | 紧凑上传、最近项目、工作流、组件导航可手检 |
| 完整验收 | 3.00 h | 0.65 h | 组合 E2E、默认回归与桌面检查通过 |
| 验收阻塞缓冲 | 4.00 h | 1.00 h | 只修既定验收，不增加边界 |

任何检查点若支撑占比超过 25%，立即停止新增测试或审查工作并报告。组合 E2E 若因文件选择器或页面跳转调试超过 20 分钟，保留已有 `setInputFiles` 方式，把原生点击/拖入交给一次桌面手检，不新增 helper、重试或延迟。

## File Map

- Modify: `app/主页.html` — 顶栏、工作台信息层级、紧凑上传、最近项目、静态工作流与组件入口；保留既有脚本数据流。
- Create: `tests/e2e/home-workbench-flow.spec.js` — 一条阶段二组合验收。
- Modify: `package.json` — 把新增用例加入既有显式 `test:e2e` 命令。

---

### Task 1: 交付工作台式首页并停止

**时间盒:** 目标 3 小时，硬上限 4 小时；测试、审查与手检合计不超过 45 分钟，硬上限 1 小时。

**Files:**

- Modify: `app/主页.html`
- Create: `tests/e2e/home-workbench-flow.spec.js`
- Modify: `package.json`

**Interfaces:**

- Consumes: `renderTabs()`、`getProjects()`、`openProject(projectId)`、`createProject(videoInfo)`、既有 `handleFile()`/`startEditing()`、`组件展示.html`。
- Produces: `home-upload`、`recent-projects`、`template-workflows`、`component-preview`、`nav-workbench`、`nav-component-library`、`component-preview-library` 稳定验收锚点。

- [ ] **Step 1: 写唯一一条阶段二组合 E2E**

创建 `tests/e2e/home-workbench-flow.spec.js`：

```js
const { test, expect } = require('./electron.fixture');

async function expectHome(window) {
  await expect(window.getByTestId('home-page')).toBeVisible();
  await expect(window.locator('#splash')).toHaveClass(/is-done/);
}

async function returnHome(window) {
  await window.locator('.wtab.is-pinned .wtab__main').click();
  await expectHome(window);
}

test('工作台保留上传和最近项目闭环，两个入口都可进入组件库', async ({ window }) => {
  await window.getByTestId('continue').click();
  await expectHome(window);

  await expect(window.getByTestId('home-upload')).toBeVisible();
  await expect(window.getByTestId('recent-projects')).toBeVisible();
  await expect(window.getByTestId('template-workflows')).toBeVisible();
  await expect(window.getByTestId('component-preview')).toBeVisible();
  await expect(window.getByTestId('nav-workbench')).toHaveAttribute('aria-current', 'page');

  await window.getByTestId('nav-component-library').click();
  await expect(window.getByRole('heading', { name: '浏览全部组件' })).toBeVisible();
  await returnHome(window);

  await window.getByTestId('component-preview-library').click();
  await expect(window.getByRole('heading', { name: '浏览全部组件' })).toBeVisible();
  await returnHome(window);

  await window.getByTestId('video-input').setInputFiles({
    name: 'home-workbench.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('home workbench video')
  });
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  const projectId = await window.evaluate(() => getActiveProjectId());

  await returnHome(window);
  const recentProject = window.locator('[data-testid="recent-projects"] [data-project-id="' + projectId + '"]');
  await expect(recentProject).toContainText('home-workbench.mp4');
  await recentProject.click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.evaluate(() => getActiveProjectId())).toBe(projectId);
});
```

若当前 Playwright 版本不支持 `expect.poll()`，只允许把最后一行替换为：

```js
expect(await window.evaluate(() => getActiveProjectId())).toBe(projectId);
```

不得为此升级 Playwright或添加轮询 helper。

- [ ] **Step 2: 运行 RED，确认只因阶段二锚点缺失而失败**

Run:

```bash
npx playwright test tests/e2e/home-workbench-flow.spec.js
```

Expected: FAIL；首个失败应是 `home-upload`、`template-workflows` 或顶部导航锚点不存在。若失败来自基线启动、环境检测或 fixture，先停止并报告，不修改测试基础设施。

- [ ] **Step 3: 把顶栏收敛为品牌、工作台、组件库、头像**

在 `app/主页.html` 中保留 `.nav{position:relative}`，用以下结构替换当前 nav；偏好弹层保持原节点和内容不变：

```html
<nav class="nav">
  <a href="主页.html" class="nav-logo">
    <span class="nav-logo-mark">三</span>
    <span>三天remotion</span>
    <span class="nav-tag">AI 视频剪辑</span>
  </a>
  <div class="nav-links" aria-label="主要导航">
    <a class="nav-link is-active" data-testid="nav-workbench"
      href="主页.html" aria-current="page">工作台</a>
    <a class="nav-link" data-testid="nav-component-library"
      href="组件展示.html">组件库</a>
  </div>
  <div class="nav-r">
    <button class="local-avatar" id="localAvatar" data-testid="local-avatar"
      type="button" aria-label="打开本地偏好" aria-expanded="false">序</button>
  </div>
  <div class="preferences-popover" id="preferencesPopover"
    data-testid="preferences-popover" hidden>
    <div class="preferences-user"><strong>本地用户</strong><span>偏好保存在本机</span></div>
    <div class="preferences-label">偏好设置</div>
    <div class="preferences-row">
      <span>编辑器侧栏位置</span>
      <span class="sidebar-side-options">
        <button class="sidebar-side-option" id="sidebarSideLeft"
          data-testid="sidebar-side-left" type="button">左侧</button>
        <button class="sidebar-side-option" id="sidebarSideRight"
          data-testid="sidebar-side-right" type="button">右侧</button>
      </span>
    </div>
  </div>
</nav>
```

顶栏样式使用三列布局；不要把规则移到 `shared.css`：

```css
.nav{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:20px;padding:10px 20px;border-bottom:1px solid var(--border-soft);background:color-mix(in srgb,var(--bg) 92%,transparent)}
.nav-logo{justify-self:start;display:flex;align-items:center;gap:8px;font-family:var(--serif);font-weight:600;font-size:16px;color:var(--text-strong)}
.nav-links{justify-self:center;display:flex;align-items:center;gap:4px;padding:3px;border:1px solid var(--border-soft);border-radius:var(--radius-pill);background:var(--bg-panel)}
.nav-link{padding:7px 14px;border-radius:var(--radius-pill);font-size:12.5px;color:var(--text-muted)}
.nav-link:hover{color:var(--text-strong);background:var(--bg-subtle)}
.nav-link.is-active{color:var(--text-strong);background:var(--accent-tint);font-weight:650}
.nav-r{justify-self:end;display:flex;align-items:center}
```

删除顶部无实际目标的“文档 / GitHub”占位控件；页脚原链接保持现状，不为其补功能。

- [ ] **Step 4: 重排首页为四个语义区块**

用一个 `workbench-shell` 包住以下四块，保留既有 ID 和上传 SVG：

```html
<main class="main" data-testid="home-page">
  <div class="workbench-shell">
    <section class="drop-zone" id="dropZone" data-testid="home-upload"
      aria-label="导入视频素材">
      <div class="drop-zone__card">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <div class="drop-zone__copy">
          <div class="title">导入视频，开始剪辑</div>
          <div class="hint">点击选择或拖入 MP4 / MOV / WebM</div>
        </div>
        <span class="drop-zone__cta">选择视频</span>
      </div>
    </section>

    <section class="home-section recent-section" data-testid="recent-projects">
      <div class="sec-head">
        <div><div class="sec-kicker">继续创作</div><h2 class="sec-title">最近项目</h2></div>
      </div>
      <div class="grid" id="recentGrid">
        <div class="recent-empty">暂无项目，导入一段视频开始</div>
      </div>
    </section>

    <section class="home-section" data-testid="template-workflows">
      <div class="sec-head">
        <div><div class="sec-kicker">灵感起点</div><h2 class="sec-title">从工作流开始</h2></div>
      </div>
      <div class="workflow-grid">
        <article class="workflow-card"><span>01</span><strong>口播快剪</strong><p>整理节奏、字幕与重点信息。</p></article>
        <article class="workflow-card"><span>02</span><strong>产品展示</strong><p>突出卖点、数据与画面层次。</p></article>
        <article class="workflow-card"><span>03</span><strong>图文解说</strong><p>组合标题、卡片与转场提示。</p></article>
      </div>
    </section>

    <section class="home-section component-section" data-testid="component-preview">
      <div class="sec-head">
        <div><div class="sec-kicker">效果参考</div><h2 class="sec-title">探索组件效果</h2></div>
        <a class="sec-more" data-testid="component-preview-library"
          href="组件展示.html">浏览全部组件 →</a>
      </div>
      <div class="presets">
        <a class="preset" href="组件展示.html"><div class="preset__preview"><div class="pvw"><div class="pvw-card" style="animation:pvwCard 3s ease-in-out infinite,pvwBorder 3s ease-in-out infinite">卡片<span class="pvw-card__dot"></span></div></div></div><div class="preset__title">GlamCard · 5合1豪华信息卡</div></a>
        <a class="preset" href="组件展示.html"><div class="preset__preview"><div class="pvw"><div class="pvw-title" style="font-family:var(--sans);font-size:20px;color:var(--accent)">标题</div></div></div><div class="preset__title">GlamTitle · 弹跳+霓虹标题</div></a>
        <a class="preset" href="组件展示.html"><div class="preset__preview"><div class="pvw"><div class="pvw-stat">8.3<span style="font-size:12px;font-weight:500;color:var(--text-muted);margin-left:2px">x</span></div></div></div><div class="preset__title">GlamStat · 数字+边框光晕</div></a>
        <a class="preset" href="组件展示.html"><div class="preset__preview"><div class="pvw"><div class="pvw-overlay" style="background:radial-gradient(ellipse at 30% 50%,color-mix(in srgb,var(--accent-tint) 80%,transparent),transparent 70%)"></div><div class="pvw-card" style="background:transparent;border:none;box-shadow:none;animation:pvwCard 3s ease-in-out infinite">场景</div></div></div><div class="preset__title">GlamOverlay · 全屏氛围</div></a>
        <a class="preset" href="组件展示.html"><div class="preset__preview"><div class="pvw"><div class="pvw-reveal">理念</div></div></div><div class="preset__title">GlamReveal · 概念揭示</div></a>
        <a class="preset" href="组件展示.html"><div class="preset__preview"><div class="pvw"><div class="pvw-exit">退出</div></div></div><div class="preset__title">GlamExit · 模糊缩放退场</div></a>
      </div>
    </section>
  </div>
</main>
```

删除无行为的“查看全部”最近项目按钮。工作流卡必须保持 `article`，不得添加模板选择状态、点击处理器或新存储键。

- [ ] **Step 5: 调整首页层级而不改数据流**

用以下尺寸与响应式规则替换旧 `.main`、`.drop-zone`、`.sec`、`.grid`、`.pcard__preview` 和 `.presets` 的布局值；保留颜色 token、hover 和现有 `pvw*` 动画：

```css
.main{flex:1;display:block;padding:28px 24px 64px;overflow-y:auto;overflow-x:hidden}
.workbench-shell{width:min(1120px,100%);margin:0 auto;display:flex;flex-direction:column;gap:34px}
.drop-zone{width:100%;min-height:0;padding:0;cursor:pointer}
.drop-zone__card{width:100%;min-height:88px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;padding:18px 22px;border:1px dashed var(--accent);border-radius:var(--radius-lg);background:color-mix(in srgb,var(--accent) 8%,var(--bg-panel));text-align:left}
.drop-zone__card svg{width:28px;height:28px}
.drop-zone__copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.drop-zone__cta{padding:8px 14px;border-radius:var(--radius-pill);background:var(--accent);color:white;font-size:12px;font-weight:650;white-space:nowrap}
.drop-zone.has-file .drop-zone__card{min-height:88px;padding:16px 22px}
.home-section{display:flex;flex-direction:column;gap:14px;min-width:0}
.recent-section{padding:24px;border:1px solid var(--border-soft);border-radius:var(--radius-lg);background:var(--bg-panel);box-shadow:var(--shadow-xs)}
.sec-head{display:flex;align-items:end;justify-content:space-between;gap:16px}
.sec-kicker{margin-bottom:4px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.sec-title{font-family:var(--serif);font-size:22px;font-weight:600;color:var(--text-strong);letter-spacing:-.01em}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.pcard__preview{height:142px}
.recent-empty{grid-column:1/-1;padding:54px 20px;border:1px dashed var(--border);border-radius:var(--radius);color:var(--text-faint);text-align:center;font-size:13px}
.workflow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.workflow-card{min-height:126px;padding:18px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-panel)}
.workflow-card span{display:block;margin-bottom:22px;font-family:var(--mono);font-size:11px;color:var(--accent)}
.workflow-card strong{display:block;margin-bottom:6px;font-size:14px;color:var(--text-strong)}
.workflow-card p{font-size:12px;line-height:1.55;color:var(--text-muted)}
.component-section{min-width:0}
.presets{display:flex;gap:12px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;padding:1px 2px 8px}
.preset{flex:0 0 248px;text-decoration:none}
@media(max-width:900px){.main{padding:24px 18px 52px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.nav{grid-template-columns:auto 1fr auto}.nav-tag{display:none}.workflow-grid{grid-template-columns:1fr}.workflow-card{min-height:0}.recent-section{padding:20px}}
@media(max-width:640px){.nav{gap:8px;padding:9px 12px}.nav-links{justify-self:start}.nav-link{padding:7px 10px}.grid{grid-template-columns:1fr}.drop-zone__card{grid-template-columns:auto minmax(0,1fr)}.drop-zone__cta{display:none}}
```

在最近项目脚本中只把旧内联空态替换为 `.recent-empty`；卡片继续调用 `openProject(p.id)`，继续只显示项目名、现有视频文件名和现有日期文案。不得读取视频 Blob、生成缩略图或计算时长。

`handleFile()`、IndexedDB 写入、`doStartEditing()` 和 `startEditing()` 的控制流保持不变。动态选中文件状态继续使用现有 `.title`、`.hint`、`.drop-zone__actions` 和 `start-editing`；只允许为横向布局补 CSS，不改存储或导航逻辑。

- [ ] **Step 6: 把唯一新用例纳入默认 E2E**

将 `package.json` 的 `test:e2e` 改为：

```json
"test:e2e": "playwright test tests/e2e/environment-flow.spec.js tests/e2e/local-cli-flow.spec.js tests/e2e/local-cli-effect-flow.spec.js tests/e2e/conversation-sidebar-flow.spec.js tests/e2e/home-workbench-flow.spec.js"
```

保持显式列表，不扫描整个目录，不把 `real-mac-smoke.spec.js` 纳入默认测试。

- [ ] **Step 7: 运行聚焦 GREEN**

Run:

```bash
npx playwright test tests/e2e/home-workbench-flow.spec.js
```

Expected: 1 passed。若唯一失败来自 `expect.poll` 兼容性，使用 Step 1 中的直接值断言；不得增加 retry、sleep 或 fixture 分支。

- [ ] **Step 8: 运行默认回归**

Run:

```bash
npm test
npm run test:e2e
```

Expected: 102/102 unit/integration passed；13/13 Electron E2E passed。

- [ ] **Step 9: 做一次真实桌面手检**

Run:

```bash
npm start
```

只检查以下内容后立即结束：

1. 约 1280×900：最近项目是主要内容区，上传条明显收窄，顶部与组件区均能进入组件库。
2. 约 900×600：没有页面级横向滚动；上传主操作、最近项目和头像可访问；组件预览区允许自身横向滚动。
3. 点击上传区可打开文件选择器；取消选择不改变数据。
4. 将一个视频拖入上传条后出现文件名与“开始剪辑”，进入编辑器路径不变。
5. 头像弹层仍只有侧栏左/右偏好；组件页和编辑器仍无头像。

不做移动端矩阵、截图基准、动画计时或模板点击测试。

- [ ] **Step 10: 记录预算、复核范围并提交**

在忽略的 `.superpowers/sdd/progress.md` 记录实际总投入、支撑投入、内部完成度和用户可见成果。确认：

```bash
git diff --check
git status --short
git diff --name-only HEAD
```

Expected: 产品改动只包含 `app/主页.html`、`tests/e2e/home-workbench-flow.spec.js`、`package.json`；`.superpowers/brainstorm/` 保持未跟踪且未修改。

Commit:

```bash
git add app/主页.html tests/e2e/home-workbench-flow.spec.js package.json
git commit -m "feat: reshape the home workbench"
```

提交后做一次整段只读复核。若没有 Critical/Important 问题且验收通过，阶段二立即结束，不继续“完善”首页。
