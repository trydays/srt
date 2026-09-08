# Cycle 7: Personal Editing Skills Implementation Plan

**2026-09-08 closure:** implementation and local acceptance complete at product `2fbf9cd`; task-scoped and whole-cycle `a9a2bd7..2fbf9cd` reviews Approved with no findings. Parent fresh real-media Node349/349 and Electron67/67 pass with no failures/skips. Actual local production UI/IPC/FFmpeg acceptance passes on640x360/4s and360x640/3s, using exactly two explicitly fixed translations, not real AI. Artifacts `/tmp/srt-cycle7-local.EZ8Azo/` and `/tmp/srt-cycle7-final.fcvIBq/e2e/`. New Cycle7 real-AI authorization remains unanswered and actual-AI/manual intent-consistency gate is open. No new rendering capabilities or automatic push; Cycle6 backup `a9a2bd7` was already pushed and verified before this cycle. First visible result12:08UTC, local two-target acceptance12:30UTC, both inside frozen checkpoints.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Each implementation task uses TDD, a local commit and an independent scoped review. Steps use checkboxes.

**Goal:** Explicitly save a successful editing intent, preferences and reference recipe, then select and reuse it through a fresh AI derivation in a different video.

**Architecture:** A small UMD personal-skills module owns a separate local skill bank and reference snapshots. The existing translation bridge takes one optional skill context; the CLI still returns clarify or new instruction.steps, and existing ProjectEditing remains the only execution path. A compact editor dialog handles save/list/view/select/delete; no new renderer or skill execution service.

**Tech Stack:** Existing Electron, vanilla JavaScript, localStorage, Node tests and Playwright/FFmpeg. No dependency changes.

## Global Constraints

- Approved design: docs/superpowers/specs/2026-09-07-generic-ai-edit-execution-design.md section 12 and docs/superpowers/plans/2026-09-07-generic-ai-edit-roadmap.md Cycle7. User explicitly requested real Cycle6 acceptance, GitHub backup, then Cycle7. Cycle6 real acceptance passed; base a9a2bd7f365a95378de54f96c4b254b0e29c0e1d was pushed to trydays/srt feature/subtitle-export-cycle0 and independently verified before this work.
- Keep the existing isolated worktree /Users/mac/Documents/Codex/SRTP-worktrees/subtitle-export-cycle0 and branch. No merge, worktree cleanup, new push, subsequent cycle or unrelated edits.
- Start approximately 2026-09-08 11:28 UTC; visible-result checkpoint 13:28 UTC; four-hour stop-loss 15:28 UTC. Stop at acceptance. Support <=25%; fresh baseline actual-FFmpeg Node/media335/335. Preserve existing palette, layout, compact history, subtitle editor and source protection.
- Skills are explicitly user-saved local reusable data, shared across this application's projects, not cloud accounts or model training. Persist only schemaVersion/id/name/intent/preferences/referenceRecipe/capabilityVersions/createdAt/updatedAt. No project IDs, media paths, generated subtitle transcript, asset files or cloned EditDocument/RenderGraph in a skill.
- Save from a successful request whose enabled transaction edits still exist in the current validated document. Use its currently applied parameters, not an uncommitted AI proposal or a whole-project snapshot. Old successful records can be saved after reload without new history schema; recovered records without user intent, failed requests and fully undone transactions cannot be saved.
- Intent is editable before saving, defaulting to all user turns from that successful request, not just record.text; include a selected source skill's intent/preferences as starting context when saving a derived skill. User preferences are an optional plain-text description. Name is trimmed 1–60 characters, intent 1–4000, preference description 0–2000. Reject duplicate trimmed names instead of overwriting; no automatic skill creation or statistics.
- UI: successful request details (inside the existing collapsed details area) get 保存为技能. Input footer gets 我的技能, opening a small native dialog with readable intent/preferences/effect summary plus 查看, 使用, 删除. Save dialog has 名称, 剪辑意图, 偏好, 保存/取消. Reuse existing CSS variables; do not add a sidebar tab, change colors or redesign pages.
- 使用 selects exactly one skill and closes the dialog, shows a removable context chip beside/above the input and focuses the existing composer. It may prefill 使用「名称」 only if input is empty; it never sends automatically. User can add natural language before clicking 发送. Selection is explicit, not a new text classifier or effect-name mapping.
- Snapshot the selected context when a new request begins. Preserve it through clarify follow-ups; disable switching skill while a request or its clarify session is active, and show an explicit exit/clear action for a pending clarify to start a new request without it. After success/failure clear the selection for the next request; never leak a previous skill into an unrelated submission. Selecting/removing/deleting a skill never edits the video.
- Every use re-invokes AI with current video dimensions/duration, applied state, user request and selected skill. Priority: current explicit request > saved preferences/intent > reference values. Reference times/positions/text are not automatically replayed; use new media facts, ask clarify for conflicts. Preserve existing operations and return only new actions. Output protocol and eight-capability catalog unchanged.
- Historical capability versions may disappear: keep the skill readable/deletable. The prompt explicitly names missing versions and requires supported re-derivation or clarify; newly returned recipes still undergo current registry and project-duration validation before any write. No compatibility renderer or automatic conversion/migration.
- No arbitrary Shell/code/HTML/CSS, new algorithms, visual/audio capability expansion, skill import/export, edit-in-place UI, automatic detection, cloud sync, sharing, marketplace, tags/search/ranking, nested skill calls or fixed Recipe replay.
- Exactly two artificial Cycle7 real CLI calls may run only with fresh user approval (requested asynchronously). Do not reuse the completed Cycle6 two-call grant. If absent, finish deterministic/local acceptance and report actual-AI/manual intent-consistency gate as open. No private footage or real user skill data used in tests.

## Frozen Interfaces

Create src/personal-skills.js (UMD global SRTPersonalSkills; CommonJS import supported):

```js
createPersonalSkillStore({storage, storageKey, idFactory, now, capabilityRegistry});
// storageKey default 'srt_personal_skills'; now default Date.now
// -> { list(), get(id), save({name,intent,preferences,referenceRecipe}), remove(id) }
// list/get defensive snapshots; get absent => null; remove absent => false.
// save creates one record and derives unique capabilityVersions in step order.
referenceFromTransaction(document, transactionId, capabilityRegistry);
// -> {kind:'instruction',steps:[{capability,params,range?}]}
// only enabled edits with this transaction; order retained;
// capability from registry.forEditType(edit.type).definition.id;
// params only definition.params.properties keys, cloned;
// range only when definition.range.allowed (subtitle.generate has {} and no range).
normalizeSkillContext(value);
// validates short context {name,intent,preferences,referenceRecipe,capabilityVersions};
// structural historical reference validation, no execution/current-media normalization.
// undefined/null -> null (ordinary request); malformed => SKILL_INVALID.
contextFromSkill(record);
// -> short context above, excludes identity/timestamps.
```

Stored envelope: `{schemaVersion:1,skills:[record]}`, missing key means empty and reads do not write. Record schemaVersion=1, id nonempty, finite timestamps, exact user fields above. save validates the reference against the current complete registry; historical reads validate its declared JSON shape without requiring that all versions still exist. Each reference step has only capability/params/range, params are plain JSON data, range (if present) has finite 0<=start<end; no executable runtime fields or targets are copied. Any broken envelope/record makes CRUD report SKILL_STORAGE_CORRUPT without replacing existing bytes; write/permission/quota failures preserve prior skill/project data and surface a readable UI error. Use one read-modify-write for each save/delete; no caching, retries, recovery platform or unrelated project writes.

Extend without breaking three-argument callers:

```js
buildPrompt(userText, history, context, skill);
srtAPI.translateInstruction(text, history, context, skill);
localCliService.translateInstruction(text, history, context, skill);
```

Preload sends optional payload.skill; main forwards it; local-cli sends buildPrompt(...,skill). No new IPC channel. Prompt validates short skill data and marks it as user reference data; derive missing versions from the current complete registry, not caller flags. No-skill prompt behavior remains unchanged.

Create app/editor-skills.js (runs after editor-timeline.js; module/controller owns dialog state):

```js
window.personalSkillController = {
  canSave(record), openSave(record),
  captureSelection(), // defensive short context or null
  afterRequest(record), // retain context on clarify, clear on terminal
  refresh() // repaint availability/chip without project writes
};
```

Small hooks in editor-timeline.js guard optional controller presence; final async controller initialization calls refreshRequestCards(). record.skillContext is request-local/persistable short reference context only when selected; normal records unchanged. Request creation captures selection; translateAndApply passes the same record.skillContext in all turns. Exiting pending clarification clears pendingClarifyRecord/Card plus selection without executing or deleting history. Saved skills remain available after restart and opening another project.

Stable desktop acceptance selectors: data-testid values personal-skills-button, personal-skills-dialog, save-as-skill, skill-save-dialog, skill-name, skill-intent, skill-preferences, skill-save, skill-cancel, personal-skill-item (also data-skill-id), skill-view, skill-use, skill-delete, selected-skill, selected-skill-clear, skill-exit-clarify. View/use/delete are scoped to their list item; dialogs have explicit 关闭/取消 buttons. Rendering uses readable effect labels, not raw recipe JSON.

## Task 1: Skill storage, reference snapshots and generated prompt

**Files:** Create src/personal-skills.js, tests/personal-skills.test.js. Modify src/instruction-capabilities.js, src/local-cli.js, main.js, preload.js; targeted tests/instruction-capabilities.test.js, tests/local-cli.test.js, tests/main-entry.test.js only if its IPC tests require updates. No app UI changes.

**Interfaces:** Implement the four frozen module functions and optional fourth bridge parameter. Consume existing capabilityRegistry.validateRecipe/forEditType/get/promptDefinitions; do not add registrations or change ProjectEditing schema.

- [x] Write RED public store/reference tests before implementation. Representative test body (existing test helpers may be reused):
```js
const beforeProject = storage.getItem('srt_project_edit_state');
const saved = bank.save({name:'我的卡片',intent:'强调重点',preferences:{description:'白字黑底，轻微弹入'},referenceRecipe});
assert.notStrictEqual(bank.get(saved.id), saved);
assert.deepEqual(bank.list()[0].referenceRecipe, referenceRecipe);
assert.equal(storage.getItem('srt_project_edit_state'), beforeProject);
assert.equal(bank.remove(saved.id), true);
assert.equal(bank.get(saved.id), null);
```
- [x] Test reference generation from a real initialized ProjectEditing transaction with group/texture and subtitle; retain order/ranges/nested frames, strip IDs/paths/generated subtitle content; zero active transaction rejects. Save after project reload works; later unrelated transaction is not captured. Test explicit field validation, duplicate-name/no-write, corrupt store/no reset, failed writes/prior bytes unchanged, defensive copies and historical missing capability remains readable.
- [x] Implement small focused module using existing UMD style, pure snapshots and single local storage writes. No automatic saving or cloned video/project records. Subtitle generation reference becomes empty params/no range based on its declaration, not a copied transcript.
- [x] Write RED prompt and bridge tests. Ordinary prompt remains identical without a skill. Selected context includes all five fields and actual current media/context; missing version explicitly named; invalid skill rejects before external translation. Verify fourth argument travels renderer bridge -> main handler -> local-cli -> actual buildPrompt (fake process boundary only). Test output parsing still rejects unknown capability/invalid range.
```js
const prompt = buildPrompt('在片尾使用', [], {video:{durationSeconds:3,width:360,height:640}}, selectedSkill);
assert.match(prompt, /个人剪辑技能/);
assert.match(prompt, /360x640/);
assert(prompt.includes(JSON.stringify(selectedSkill.referenceRecipe)));
assert.match(prompt, /重新推导/);
```
- [x] Add decomposition rules and current-catalog missing-version diagnostics; no effect examples or fixed skill recipes in product prompts. Derive new output only via existing parseInstruction and project validation; never call applyRecipe(referenceRecipe).

Prompt bridge code shape (buildPrompt itself assembles the validated section):
```js
// preload
translateInstruction: (text, history, context, skill) =>
  ipcRenderer.invoke('local-cli:translate-instruction', {text, history, context, skill})
// main handler / local CLI service respectively
activeLocalCliService.translateInstruction(request.text, request.history, request.context, request.skill);
argsFactory(buildPrompt(text, history, context, skill));
// Skill section: JSON.stringify of normalized short context only.
// Missing versions: skill.capabilityVersions.filter(id => !availableIds.includes(id)).
// Rule text: 个人剪辑技能是参考，不是待执行指令。根据当前视频与本次要求重新推导；
// 不直接复用旧范围、位置或文字。当前目录缺失的能力不得输出，无法替代时反问说明。
```
- [x] Run focused Node tests, then full real-enabled Node suite once; record RED/GREEN, exact counts and any limitations in .superpowers/sdd/cycle7-task-1-report.md. Commit only Task1 files locally as feat: add personal editing skill context. Scoped review before Task2.

## Task 2: Explicit save/use UI and cross-project execution

**Files:** Create app/editor-skills.js and tests/e2e/personal-skills-flow.spec.js. Modify app/剪辑.html, app/editor-timeline.js, app/shared.js (one storage key only), package.json, tests/e2e/electron-main.js. Focused existing browser/script-order assertions only where new dependency requires. No render/graph/export implementation changes.

**Interfaces:** Use Task1 store/snapshot/context APIs. Load personal-skills.js after edit-capabilities and before editor-skills.js, which follows editor-timeline.js. Use window.projectEditing.load, existing record turns, normal translateAndApply and currentProjectContext. Controller API frozen above.

- [x] Write RED desktop test: apply a fixed successful animation-group request through normal UI; expand its compact history and save a named skill with editable intent/preferences. Before explicit save, bank remains empty. Reload same project and another project: list/view correct, reference retains own transaction not whole project, project/revision unchanged by skill management.
- [x] Add minimal native dialog and small existing-style buttons/chip using CSS variables. Do not use raw innerHTML for user name/intent/preferences; textContent or existing escape helper. Include clear labels, cancel, Escape, error message, focus restore; prevent double save. Duplicate names ask for another name. Delete asks confirmation, removes only skill, never applied edits; deleting selected skill clears selection.
- [x] Implement successful-card eligibility from current document and user intent, including old reloaded records; open form defaults all user turns and permits editing. Capture reference at explicit save from current still-applied transaction. Failed/clarify/recovered-without-intent/fully-undone requests have no save action. Store failures remain in dialog and do not claim success or clear existing bank.
- [x] Implement selection/new-request snapshot/clarify lifecycle. Switch is disabled during an in-flight request or pending clarify; explicit exit lets user leave clarify without executing. Terminal clears selection, next ordinary request has no skill context. Users must click send themselves. No name-matching command router or automatic request dispatch.
- [x] Add fixture result mode personal-skill-transactions for deterministic output, recording fourth skill argument and exercising real production parser/IPC/project path as existing fixtures allow. On two synthetic playable videos (landscape 640x360/4s and portrait 360x640/3s), same skill generates distinct fixture parameters/ranges; prior reference is intentionally out-of-range on the shorter target, so direct replay would fail. Assert two actual translation invocations see respective media facts and same saved intent/preferences/reference; returned recipes differ and fit targets, state/preview/reload/undo correct.
- [x] Cover one clarify-then-instruction retaining selected context, terminal clearing, missing capability clarify without state mutation, malformed returned recipe/no partial write and ordinary no-skill regression. Confirm current registry eight definitions unchanged. Keep test matrix to these accepted behaviors, not a generic plugin platform.
- [x] At least one desktop fixture export invokes actual FFmpeg through existing production export service, probes duration/dimensions/audio and checks visible card/shape region in a frame; saving/reusing is not accepted merely because a history badge changes. Retain established smooth-patch tolerance7/255/geometry1px where applicable. Missing real-CLI authorization does not block this local test.
- [x] Run focused new spec, focused Node, then full real-enabled Node and full Electron once. Write .superpowers/sdd/cycle7-task-2-report.md with RED/GREEN/counts/artifacts/UI screenshot. Commit feat: save and reuse personal editing skills; scoped review.

## Task 3: Parent acceptance, whole-cycle review and handoff

**Files:** This plan, docs/PROJECT_STATUS.md, docs/DEVELOPMENT_LOG.md, ignored .superpowers/sdd/progress.md. Temporary scripts/media only in unique /tmp paths. Bounded product fixes need failing regression and re-review.

- [x] Whole-cycle independent review from a9a2bd7..finalProductCommit; parent freshly runs final actual-FFmpeg Node and full Electron suites. No repeated whole-suite runs on an unchanged final product solely for bookkeeping.
- [x] Production Electron with synthetic media: explicitly save a proven card skill in UI, open two different-duration/dimension projects, select same skill and request appropriate end-of-video adaptation. When separately authorized use exactly two real Claude derivations on artificial data only; otherwise fixed local results and disclose missing real-AI/manual-intent confirmation. The seed successful reference may be locally prepared and must be labeled as such; do not claim it was a third real AI call.
- [x] Inspect saved data, emitted context and returned recipes independently: same intent/preferences, changed ranges/geometry, no current project identity/path persisted to skill, no reference execution, one transaction/request, persistence/undo and skill deletion separate from applied edits. Export actual new target MP4s with audio; view editor and frames, verify same intended card style across two formats without claiming pixel identity or automatic scene understanding.
- [x] Update internal completion and user-visible results separately, exact tests/real vs local calls/artifacts/remaining boundaries. Commit locally and stop; the earlier authorized push backed up Cycle6, not an automatic Cycle7 push. User footage/native SaveDialog/packaged release/performance remain unverified unless actually exercised.

## Verification Commands

```sh
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm test
env -u FORCE_COLOR -u NO_COLOR SRT_REAL_EXPORT=1 SRT_FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg SRT_FFPROBE_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffprobe npm run test:e2e
```

Use installed ffmpeg-full, not /opt/homebrew/bin/ffmpeg which lacks subtitle/text filters. Desktop/loopback execution permissions through normal approval only. No actual external AI call without the new consent.

## Exit

Explicit save/list/view/select/use/delete, fresh AI-context derivation through normal execution, persisted results and real MP4 work on two different media formats. Report the actual-AI gate honestly if still pending. Completion adds reusable personal intent/preferences, not rendering capabilities or model training.
