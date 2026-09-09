# 官方要点技能 Implementation Plan

**Goal:** 我的技能展示官方口播要点模板，选择后沿用现有请求链路。
**Architecture:** personal-skills 提供独立内置模板列表，editor-skills 合并展示但不写入个人存储。无固定配方的上下文使用 referenceRecipe:null、capabilityVersions:[]；个人保存仍要求成功配方。
**Tech Stack:** JavaScript、Node test、Electron Playwright。

- [ ] 添加测试：内置模板可正规化且无时间配方、可进入 buildPrompt、返回副本隔离修改。
- [ ] 执行 node --test tests/official-skills.test.js，确认缺少接口失败。
- [ ] 实现 listOfficialTemplates()，为无参考配方上下文提供明确 null 支持，不放宽个人存储校验。
- [ ] editor-skills 合并展示官方条目，添加标记，不提供删除；选择传入 context，不改自动提交行为。
- [ ] 回归个人技能单元测试，并检查模板 UI 选择与个人技能兼容；不执行真实付费 AI，不宣称真实视频验收。
- [ ] 更新研发日志，报告结果，不自动推送或重启。
