const {test} = require('node:test');
const assert = require('node:assert/strict');
const {deleteProject} = require('../src/project-delete');
test('corrupt records stop deletion before writing', () => {
  const storage = {getItem:k=>k==='srt_projects'?'[{"id":"a"}]':'broken',setItem:()=>assert.fail('unexpected write'),removeItem:()=>assert.fail('unexpected removal')};
  assert.throws(()=>deleteProject(storage,'a'));
});
test('storage write failure restores earlier changes', () => {
  const initial = {srt_projects:'[{"id":"a"}]',srt_project_conversations:'{"a":[1]}'};
  const data = new Map(Object.entries(initial));
  let failed = false;
  const storage = {getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k),setItem:(k,v)=>{
    if(k==='srt_projects'&&!failed){failed=true;throw Error('write failed');} data.set(k,v);
  }};
  assert.throws(()=>deleteProject(storage,'a'));
  assert.deepEqual(Object.fromEntries(data),initial);
});
test('deletes only selected project and related records', () => {
  const data = new Map(Object.entries({srt_projects: JSON.stringify([{id:'a'},{id:'b'}]),
    srt_active_project_id:'a', srt_project_edit_state:JSON.stringify({a:{},b:{keep:1}}),
    srt_project_subtitle_drafts:JSON.stringify({'["a","edit"]':{},'["b","edit"]':{}}), srt_personal_skills:'keep'}));
  const storage = {getItem:k=>data.get(k) ?? null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  assert.equal(deleteProject(storage,'a'), true);
  assert.deepEqual(JSON.parse(data.get('srt_projects')), [{id:'b'}]);
  assert.deepEqual(JSON.parse(data.get('srt_project_edit_state')), {b:{keep:1}});
  assert.deepEqual(Object.keys(JSON.parse(data.get('srt_project_subtitle_drafts'))), ['["b","edit"]']);
  assert.equal(data.get('srt_active_project_id'),'b');
  assert.equal(data.get('srt_personal_skills'),'keep');
  assert.equal(deleteProject(storage,'a'), false);
});
