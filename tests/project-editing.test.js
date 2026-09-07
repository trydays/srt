const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectEditing } = require('../src/project-editing');
const { SUBTITLE_STYLE } = require('../src/render-recipe');
const { createCapabilityRegistry, createSubtitleRegistration, createColorRegistration } = require('../src/edit-capabilities');
const { createRenderGraphCompiler } = require('../src/render-graph');
const facts = { duration: 8, canvas: { width: 1280, height: 720 }, source: { id: 'main-video', assetId: 'asset-1' } };
const recipe = { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
function fixture(extra) {
  let raw = null, writes = 0, next = 0;
  const control = { fail: false, segments: [{ start: 1, end: 2, text: 'hello' }] };
  const storage = { getItem: () => raw, setItem: (key, value) => { if(control.fail) throw new Error('quota'); raw=value; writes++; } };
  const editing = createProjectEditing(Object.assign({ storage, storageKey: 'edits', idFactory: p => p + '-' + (++next), now: () => 123,
    executionContext: { videoPath: '/private/video.mp4', generateSubtitles: async () => { if(control.prepareFail) throw new Error('prepare'); if(control.duringPrepare) control.duringPrepare(); return { ok: true, segments: control.segments }; } } }, extra));
  return { editing, control, storage, raw: () => raw, writes: () => writes,
    init: (projectId='p1', legacySubtitleState) => editing.initializeProject({ projectId, mediaFacts:facts, legacySubtitleState }),
    generate: (requestId, expectedRevision=0) => editing.applyRecipe({projectId:'p1',expectedRevision,requestId,recipe}) };
}
test('initializes valid projects once and loads with no writes and defensive copies', () => {
  const f=fixture(); assert.throws(()=>f.editing.load('p1'),{code:'EDIT_PROJECT_NOT_READY'});
  const result=f.init(); assert.equal(result.document.revision,0); assert.deepEqual(result.document.edits,[]);
  f.init(); f.editing.load('p1').document.timeline.duration=99; assert.equal(f.editing.load('p1').document.timeline.duration,8); assert.equal(f.writes(),1);
  assert.throws(()=>f.editing.initializeProject({projectId:'bad',mediaFacts:{...facts,duration:0}}));
});
test('regeneration replaces one track and undo restores the full previous track once', async () => {
  const f=fixture(); f.init(); const first=await f.generate('r1'); f.control.segments=[{start:3,end:4,text:'second'}];
  const second=await f.generate('r2',1); assert.equal(second.document.edits.length,1); assert.notEqual(second.document.edits[0].id,first.document.edits[0].id);
  assert.equal(second.transactionId,'r2'); assert.equal(f.editing.canUndo({projectId:'p1',transactionId:'r1'}),false);
  const result=f.editing.undo({projectId:'p1',expectedRevision:2,transactionId:'r2'});
  assert.deepEqual(result.document.edits,first.document.edits); assert.equal(result.document.revision,3);
  assert.equal(f.editing.canUndo({projectId:'p1',transactionId:'r2'}),false);
});
test('replacing full payload preserves current inverse and undo removes first generated track', async () => {
  const f=fixture(); f.init(); const generated=await f.generate('r1'); const edit=generated.document.edits[0];
  const replacement={segments:[{id:'custom',start:2,end:3,text:'changed'}],style:SUBTITLE_STYLE};
  const result=f.editing.replaceEdit({projectId:'p1',expectedRevision:1,editId:edit.id,payload:replacement});
  assert.deepEqual(result.document.edits[0].payload,replacement); assert.equal(result.document.revision,2);
  assert.deepEqual(f.editing.undo({projectId:'p1',expectedRevision:2,transactionId:'r1'}).document.edits,[]);
});
test('preparation, compilation, storage and stale revision failures leave old JSON intact', async () => {
  const f=fixture(); f.init(); const original=f.raw(); f.control.prepareFail=true;
  await assert.rejects(f.generate('r1')); assert.equal(f.raw(),original); f.control.prepareFail=false; f.control.fail=true;
  await assert.rejects(f.generate('r1')); assert.equal(f.raw(),original); f.control.fail=false;
  await assert.rejects(f.generate('r1',9),{code:'EDIT_REVISION_CONFLICT'}); assert.equal(f.raw(),original);
  const broken=fixture({graphCompiler:{compile:document=>{if(document.edits.length)throw new Error('graph'); return {};}}}); broken.init(); const before=broken.raw();
  await assert.rejects(broken.generate('r')); assert.equal(broken.raw(),before);
});
test('rechecks same-project revision and preserves another project written during prepare', async () => {
  const f=fixture(); f.init(); f.control.duringPrepare=()=>f.init('p2'); await f.generate('r1'); assert.equal(f.editing.load('p2').document.revision,0);
  f.control.duringPrepare=()=>f.editing.replaceEdit({projectId:'p1',expectedRevision:1,editId:f.editing.load('p1').document.edits[0].id,payload:{segments:[{id:'x',start:1,end:2,text:'concurrent'}],style:SUBTITLE_STYLE}});
  await assert.rejects(f.generate('r2',1),{code:'EDIT_REVISION_CONFLICT'}); assert.equal(f.editing.load('p1').document.edits[0].payload.segments[0].text,'concurrent');
});
test('migrates legacy IDs and undo once without rewriting on load', () => {
  const f=fixture(); const segments=[{id:'legacy1',start:1,end:2,text:' original '}];
  const result=f.init('p1',{segments,undo:{requestId:'legacy-request',segments:[]}});
  assert.equal(result.document.edits[0].id,'legacy-subtitles-legacy1'); assert.deepEqual(result.document.edits[0].payload.segments,segments);
  f.init('p1',{segments:[]}); assert.equal(f.writes(),1); assert.equal(f.editing.canUndo({projectId:'p1',transactionId:'legacy-request'}),true);
  assert.deepEqual(f.editing.undo({projectId:'p1',expectedRevision:0,transactionId:'legacy-request'}).document.edits,[]);
});
test('does not recreate a previously observed project if its persisted document goes missing', () => {
  const f=fixture(); f.init(); f.storage.setItem('edits','{}'); const before=f.raw();
  assert.throws(()=>f.init(),{code:'EDIT_PROJECT_NOT_READY'}); assert.equal(f.raw(),before);
});
test('validates legacy inverse before the first write', () => {
  const f=fixture(); assert.throws(()=>f.init('p1',{segments:[],undo:{requestId:'r',segments:[{id:'bad',start:1,end:99,text:'bad'}]}})); assert.equal(f.writes(),0);
});
test('rejects corrupt existing store and exposes bounded path-free AI and timeline context', async () => {
  assert.throws(()=>createProjectEditing({storage:{getItem:()=>'{bad',setItem:()=>assert.fail('write')}}).initializeProject({projectId:'p1',mediaFacts:facts}),{code:'EDIT_STORAGE_CORRUPT'});
  const f=fixture();f.init();await f.generate('r');const context=f.editing.aiContext('p1');assert.equal(context.video.durationSeconds,8);assert.equal(context.subtitleTotal,1);assert.equal(context.edits.length,1);assert.equal(f.editing.timelineItems('p1')[0].editId,context.edits[0].id);assert.equal(JSON.stringify(context).includes('/private'),false);
});

function colorStep(start = 2, end = 5) {
  return { capability: 'video.color.adjust@1', params: { temperature: 0.4 }, range: { start, end } };
}
function applySteps(f, steps, requestId, expectedRevision = 0) {
  return f.editing.applyRecipe({ projectId: 'p1', recipe: { kind: 'instruction', steps }, requestId, expectedRevision });
}
test('appends color ranges and projects normalized payloads without runtime paths', async () => {
  const f = fixture(); f.init();
  const first = await applySteps(f, [colorStep()], 'request-1');
  assert.equal(first.document.edits.filter(e => e.type === 'video.color.adjustment@1').length, 1);
  assert.deepEqual(first.document.edits[0].range, { start: 2, end: 5 });
  const second = await applySteps(f, [colorStep(5, 8), recipe.steps[0]], 'request-2', 1);
  assert.deepEqual(second.document.edits[0], first.document.edits[0]);
  assert.equal(second.document.edits.length, 3);
  const context = f.editing.aiContext('p1');
  assert.deepEqual(context.operations, second.document.edits.map(edit => ({
    capability: edit.type === 'subtitle.track@1' ? 'subtitle.generate@1' : 'video.color.adjust@1',
    params: edit.payload, range: edit.range
  })));
  assert.equal(context.subtitleTotal, 1);
  assert.equal(context.subtitles[0].text, 'hello');
  assert.equal(JSON.stringify(context).includes('/private'), false);
  context.operations[0].params.temperature = -1;
  assert.equal(f.editing.aiContext('p1').operations[0].params.temperature, 0.4);
  assert.deepEqual(f.editing.timelineItems('p1').map(item => item.lane), ['video-effect', 'video-effect', 'subtitle']);
});
test('multi-step replacement shares one revision, write, inverse and candidate compilation', async () => {
  const compiled = [], compiler = createRenderGraphCompiler();
  const f = fixture({ graphCompiler: { compile(doc) { compiled.push(structuredClone(doc)); return compiler.compile(doc); } } });
  const before = f.init(), writes = f.writes(); compiled.length = 0;
  const result = await applySteps(f, [recipe.steps[0], colorStep(), recipe.steps[0]], 'request-2');
  assert.deepEqual(new Set(result.document.edits.map(e => e.transactionId)), new Set(['request-2']));
  assert.equal(result.document.revision, before.document.revision + 1);
  assert.equal(result.document.edits.length, 2);
  assert.equal(result.document.edits.filter(e => e.type === 'subtitle.track@1').length, 1);
  assert.equal(new Set(result.document.edits.map(e => e.id)).size, 2);
  assert.deepEqual(result.document.edits.map(e => e.order), [1, 2]);
  assert.equal(f.writes(), writes + 1);
  assert.equal(compiled.filter(doc => doc.revision === result.document.revision).length, 1);
  assert.equal(JSON.parse(f.raw()).p1.undoStack.length, 1);
  const undone = f.editing.undo({ projectId: 'p1', expectedRevision: 1, transactionId: 'request-2' });
  assert.deepEqual(undone.document.edits, before.document.edits);
});
test('whole-request undo restores existing color and subtitle edits exactly', async () => {
  const f = fixture(); f.init();
  const before = await applySteps(f, [colorStep(), recipe.steps[0]], 'before');
  const result = await applySteps(f, [recipe.steps[0], colorStep(0, 1)], 'after', 1);
  assert.equal(result.document.edits.length, 3);
  assert.ok(result.document.edits[1].order > Math.max(...before.document.edits.map(e => e.order)));
  const undone = f.editing.undo({ projectId: 'p1', expectedRevision: 2, transactionId: 'after' });
  assert.deepEqual(undone.document.edits, before.document.edits);
});
test('prepares every step before lowering or accessing storage again', async () => {
  const subtitle = createSubtitleRegistration(), color = createColorRegistration(), events = [];
  for (const [name, registration] of [['subtitle', subtitle], ['color', color]]) {
    const prepare = registration.prepare, lower = registration.toEdit;
    registration.prepare = async (...args) => { events.push('prepare ' + name); return prepare(...args); };
    registration.toEdit = (...args) => { events.push('lower ' + name); return lower(...args); };
  }
  const f = fixture({ capabilityRegistry: createCapabilityRegistry([subtitle, color]) }); f.init();
  const read = f.storage.getItem;
  f.storage.getItem = (...args) => { events.push('read'); return read(...args); };
  await applySteps(f, [recipe.steps[0], colorStep()], 'r');
  assert.deepEqual(events.slice(0, 5), ['read', 'prepare subtitle', 'prepare color', 'lower subtitle', 'lower color']);
});
for (const stage of ['prepare', 'toEdit', 'toGraph']) {
  test('failure in second-step ' + stage + ' preserves storage, revision and undo byte-for-byte', async () => {
    const color = createColorRegistration(), original = color[stage];
    let fail = false;
    color[stage] = (...args) => { if (fail) throw new Error('second-step ' + stage); return original(...args); };
    const f = fixture({ capabilityRegistry: createCapabilityRegistry([createSubtitleRegistration(), color]) });
    f.init(); await f.generate('before');
    const rawBeforeFailure = f.raw(), writes = f.writes(); fail = true;
    await assert.rejects(applySteps(f, [recipe.steps[0], colorStep()], 'failed', 1), new RegExp('second-step ' + stage));
    assert.equal(f.raw(), rawBeforeFailure);
    assert.equal(f.writes(), writes);
    assert.equal(f.editing.canUndo({ projectId: 'p1', transactionId: 'before' }), true);
  });
}
