const test = require('node:test');
const assert = require('node:assert/strict');
const { createCapabilityRegistry } = require('../src/edit-capabilities');
const { createProjectEditing } = require('../src/project-editing');
const {
  createPersonalSkillStore,
  referenceFromTransaction,
  normalizeSkillContext,
  contextFromSkill
} = require('../src/personal-skills');

function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  const writes = [];
  return {
    writes,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); writes.push({ key, value }); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.has(key) ? values.get(key) : null; }
  };
}

const referenceRecipe = {
  kind: 'instruction',
  steps: [
    { capability: 'video.noise@1', range: { start: 1, end: 3 }, params: { amount: 0.4 } },
    { capability: 'subtitle.generate@1', params: {} },
    { capability: 'video.noise@1', params: { amount: 0.2 } }
  ]
};

function createBank(storage, extra) {
  return createPersonalSkillStore(Object.assign({
    storage,
    idFactory: () => 'skill-1',
    now: () => 123,
    capabilityRegistry: createCapabilityRegistry()
  }, extra));
}

test('saves an isolated exact record, derives ordered unique versions and returns defensive snapshots', () => {
  const storage = memoryStorage({ srt_project_edit_state: '{"project":"unchanged"}' });
  const beforeProject = storage.getItem('srt_project_edit_state');
  const bank = createBank(storage);
  const saved = bank.save({
    name: '  我的卡片  ',
    intent: '强调重点',
    preferences: { description: '白字黑底，轻微弹入' },
    referenceRecipe
  });

  assert.deepEqual(saved, {
    schemaVersion: 1,
    id: 'skill-1',
    name: '我的卡片',
    intent: '强调重点',
    preferences: { description: '白字黑底，轻微弹入' },
    referenceRecipe,
    capabilityVersions: ['video.noise@1', 'subtitle.generate@1'],
    createdAt: 123,
    updatedAt: 123
  });
  assert.notStrictEqual(bank.get(saved.id), saved);
  assert.deepEqual(bank.list()[0].referenceRecipe, referenceRecipe);
  bank.list()[0].referenceRecipe.steps[0].params.amount = 0.9;
  assert.equal(bank.get(saved.id).referenceRecipe.steps[0].params.amount, 0.4);
  assert.equal(storage.getItem('srt_project_edit_state'), beforeProject);
  assert.equal(bank.remove(saved.id), true);
  assert.equal(bank.remove(saved.id), false);
  assert.equal(bank.get(saved.id), null);
});

test('missing storage reads empty without writing and each save/delete uses one read-modify-write', () => {
  let reads = 0;
  const storage = memoryStorage();
  const originalGet = storage.getItem;
  storage.getItem = function(key) { reads += 1; return originalGet.call(storage, key); };
  const bank = createBank(storage);
  assert.deepEqual(bank.list(), []);
  assert.equal(storage.writes.length, 0);
  bank.save({ name: '卡片', intent: '强调', preferences: { description: '' }, referenceRecipe });
  assert.equal(reads, 2);
  assert.equal(storage.writes.length, 1);
  bank.remove('skill-1');
  assert.equal(reads, 3);
  assert.equal(storage.writes.length, 2);
});

test('rejects invalid fields and duplicate trimmed names without writing', () => {
  const storage = memoryStorage();
  let id = 0;
  const bank = createBank(storage, { idFactory: () => 'skill-' + (++id) });
  const valid = { name: '卡片', intent: '强调', preferences: { description: '' }, referenceRecipe };
  bank.save(valid);
  const before = storage.value('srt_personal_skills');
  for (const value of [
    { ...valid, name: '  卡片  ' },
    { ...valid, name: '' },
    { ...valid, name: 'x'.repeat(61) },
    { ...valid, intent: '' },
    { ...valid, intent: 'x'.repeat(4001) },
    { ...valid, preferences: { description: 'x'.repeat(2001) } },
    { ...valid, preferences: { description: '', extra: true } },
    { ...valid, referenceRecipe: { kind: 'instruction', steps: [{ capability: 'missing@1', params: {} }] } }
  ]) {
    assert.throws(() => bank.save(value), { code: 'SKILL_INVALID' });
    assert.equal(storage.value('srt_personal_skills'), before);
  }
});

test('corrupt storage is preserved and every CRUD operation reports storage corruption', () => {
  const storage = memoryStorage({ srt_personal_skills: '{broken' });
  const bank = createBank(storage);
  const before = storage.value('srt_personal_skills');
  assert.throws(() => bank.list(), { code: 'SKILL_STORAGE_CORRUPT' });
  assert.throws(() => bank.get('skill-1'), { code: 'SKILL_STORAGE_CORRUPT' });
  assert.throws(() => bank.save({ name: '卡片', intent: '强调', preferences: { description: '' }, referenceRecipe }),
    { code: 'SKILL_STORAGE_CORRUPT' });
  assert.throws(() => bank.remove('skill-1'), { code: 'SKILL_STORAGE_CORRUPT' });
  assert.equal(storage.value('srt_personal_skills'), before);
  assert.equal(storage.writes.length, 0);
});

test('failed writes preserve prior bytes and surface the original storage failure', () => {
  const storage = memoryStorage();
  const bank = createBank(storage);
  bank.save({ name: '卡片', intent: '强调', preferences: { description: '' }, referenceRecipe });
  const before = storage.value('srt_personal_skills');
  storage.setItem = () => { throw new Error('quota exceeded'); };
  assert.throws(() => bank.remove('skill-1'), /quota exceeded/);
  assert.equal(storage.value('srt_personal_skills'), before);

  const failingSaveStorage = memoryStorage({ srt_personal_skills: before });
  failingSaveStorage.setItem = () => { throw new Error('permission denied'); };
  assert.throws(() => createBank(failingSaveStorage, { idFactory: () => 'skill-2' }).save({
    name: '另一张卡片', intent: '另一种强调', preferences: { description: '' }, referenceRecipe
  }), /permission denied/);
  assert.equal(failingSaveStorage.value('srt_personal_skills'), before);
});

test('historical records with missing capability versions remain readable and deletable', () => {
  const record = {
    schemaVersion: 1, id: 'old', name: '旧技能', intent: '保留感觉',
    preferences: { description: '' },
    referenceRecipe: { kind: 'instruction', steps: [{ capability: 'retired.effect@1',
      range: { start: 0, end: 1 }, params: { nested: [{ value: true }] } }] },
    capabilityVersions: ['retired.effect@1'], createdAt: 1, updatedAt: 2
  };
  const storage = memoryStorage({ srt_personal_skills: JSON.stringify({ schemaVersion: 1, skills: [record] }) });
  const bank = createBank(storage);
  assert.deepEqual(bank.get('old'), record);
  assert.equal(bank.remove('old'), true);
});

function groupStep() {
  return { capability: 'visual.group@1', range: { start: 1, end: 4 }, params: {
    layers: [
      { kind: 'shape', params: { x: .1, y: .1, width: .4, height: .25, color: '#000000' } },
      { kind: 'text', params: { text: '重点', x: .12, y: .12, fontSize: .08, color: '#FFFFFF' } }
    ],
    opacity: { keyframes: [{ time: 0, value: 0 }, { time: 2, value: 1, easing: 'ease-out' }] },
    scale: 1
  } };
}

test('snapshots only enabled edits from one real applied transaction and survives project reload', async () => {
  const storage = memoryStorage();
  const registry = createCapabilityRegistry();
  let next = 0;
  const options = {
    storage, storageKey: 'srt_project_edit_state', capabilityRegistry: registry,
    idFactory: (prefix) => prefix + '-' + (++next),
    executionContext: {
      videoPath: '/private/source.mp4',
      generateSubtitles: async () => ({ ok: true, segments: [{ start: .5, end: 1.5, text: '秘密字幕正文' }] })
    }
  };
  const editing = createProjectEditing(options);
  editing.initializeProject({ projectId: 'p', mediaFacts: {
    duration: 8, canvas: { width: 1280, height: 720 },
    source: { id: 'main-video', assetId: '/private/asset.mp4' }
  } });
  const originalSteps = [groupStep(),
    { capability: 'video.noise@1', range: { start: 2, end: 6 }, params: { amount: .3 } },
    { capability: 'subtitle.generate@1', params: {} }];
  const applied = await editing.applyRecipe({ projectId: 'p', expectedRevision: 0,
    requestId: 'saved-request', recipe: { kind: 'instruction', steps: originalSteps } });
  await editing.applyRecipe({ projectId: 'p', expectedRevision: 1, requestId: 'later-request',
    recipe: { kind: 'instruction', steps: [{ capability: 'video.vignette@1', params: { strength: .4 } }] } });
  const reloaded = createProjectEditing(options).load('p');
  const reference = referenceFromTransaction(reloaded.document, 'saved-request', registry);

  assert.deepEqual(reference, { kind: 'instruction', steps: [
    { capability: 'visual.group@1', params: applied.document.edits[0].payload, range: { start: 1, end: 4 } },
    { capability: 'video.noise@1', params: { amount: .3 }, range: { start: 2, end: 6 } },
    { capability: 'subtitle.generate@1', params: {} }
  ] });
  const serialized = JSON.stringify(reference);
  assert.doesNotMatch(serialized, /saved-request|later-request|edit-|asset|source\.mp4|秘密字幕正文|subtitle-segment|target|enabled/);
  const savedAfterReload = createBank(storage, { storageKey: 'reloaded-skills' }).save({
    name: '重载后技能', intent: '沿用重点卡片风格', preferences: { description: '' }, referenceRecipe: reference
  });
  assert.deepEqual(savedAfterReload.referenceRecipe, reference);
  reloaded.document.edits[0].enabled = false;
  assert.equal(referenceFromTransaction(reloaded.document, 'saved-request', registry).steps.length, 2);
  reloaded.document.edits.forEach((edit) => { if (edit.transactionId === 'saved-request') edit.enabled = false; });
  assert.throws(() => referenceFromTransaction(reloaded.document, 'saved-request', registry),
    { code: 'SKILL_INVALID' });
});

test('normalizes only the exact short plain-data context and contextFromSkill excludes identity and timestamps', () => {
  const record = {
    schemaVersion: 1, id: 'skill-1', name: '卡片', intent: '强调',
    preferences: { description: '黑底白字' }, referenceRecipe,
    capabilityVersions: ['video.noise@1', 'subtitle.generate@1'], createdAt: 1, updatedAt: 2
  };
  const expected = {
    name: record.name, intent: record.intent, preferences: record.preferences,
    referenceRecipe: record.referenceRecipe, capabilityVersions: record.capabilityVersions
  };
  assert.equal(normalizeSkillContext(undefined), null);
  assert.equal(normalizeSkillContext(null), null);
  assert.deepEqual(contextFromSkill(record), expected);
  const context = normalizeSkillContext(expected);
  assert.deepEqual(context, expected);
  assert.notStrictEqual(context.referenceRecipe, expected.referenceRecipe);
  for (const invalid of [
    { ...expected, id: 'not-short' },
    { ...expected, capabilityVersions: ['video.noise@1', 'video.noise@1'] },
    { ...expected, referenceRecipe: { kind: 'instruction', steps: [] } },
    { ...expected, referenceRecipe: { kind: 'instruction', steps: [{ capability: 'old@1', params: {}, runtime: 'bad' }] } },
    { ...expected, referenceRecipe: { kind: 'instruction', steps: [{ capability: 'old@1', params: {}, range: { start: 2, end: 1 } }] } }
  ]) assert.throws(() => normalizeSkillContext(invalid), { code: 'SKILL_INVALID' });
});
