const {test} = require('node:test');
const assert = require('node:assert/strict');
const skills = require('../src/personal-skills');
const {buildPrompt} = require('../src/instruction-capabilities');

test('official workflow carries intent without a fixed video recipe', () => {
  const [template] = skills.listOfficialTemplates();
  assert.equal(template.name, '口播要点自动卡片');
  const context = skills.normalizeSkillContext(template.context);
  assert.equal(context.referenceRecipe, null);
  assert.deepEqual(context.capabilityVersions, []);
  assert.match(buildPrompt('使用模板', [], {}, context), /粉色/);
  assert.match(context.intent, /当前视频/);
  template.context.intent = 'mutated';
  assert.notEqual(skills.listOfficialTemplates()[0].context.intent, 'mutated');
});
