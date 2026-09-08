const test=require('node:test');
const assert=require('node:assert/strict');
const {createRenderGraphCompiler}=require('../src/render-graph');
const {SUBTITLE_STYLE}=require('../src/render-recipe');
function document(){return {schemaVersion:1,projectId:'p',revision:0,timeline:{duration:8,canvas:{width:1280,height:720}},sources:[{id:'main-video',assetId:'asset',kind:'video',range:{start:0,end:8}}],edits:[{id:'e1',type:'subtitle.track@1',enabled:true,transactionId:'r',target:{kind:'source',id:'main-video'},order:0,range:{start:0,end:8},payload:{segments:[{id:'s',start:1,end:2,text:'hello'}],style:SUBTITLE_STYLE}}]};}
test('compiles minimal linear graph and skips disabled edits',()=>{const compiler=createRenderGraphCompiler();const doc=document();const graph=compiler.compile(doc);assert.equal(graph.nodes.length,2);assert.equal(graph.outputs.video.nodeId,'node-e1');assert.equal(graph.outputs.audio.nodeId,'node-main-video');doc.edits[0].enabled=false;assert.equal(compiler.compile(doc).nodes.length,1);});
test('rejects duplicate nodes, unknown nodes, range overflow, wrong head/output and style keys',()=>{const compiler=createRenderGraphCompiler();for(const mutate of [g=>g.nodes[1].id=g.nodes[0].id,g=>g.nodes[1].type='unknown',g=>g.nodes[1].range.end=9,g=>g.nodes[1].inputs[0].nodeId='missing',g=>g.outputs.video.nodeId='node-main-video',g=>g.nodes[1].props.style.extra=true,g=>g.extra=true]){const graph=compiler.compile(document());mutate(graph);assert.throws(()=>compiler.validate(graph));}});
test('rejects duplicate edits, partial source ranges and untrusted document fields',()=>{const compiler=createRenderGraphCompiler();for(const mutate of [d=>d.edits.push(d.edits[0]),d=>d.sources[0].range.start=1,d=>d.edits[0].command='run',d=>d.timeline.duration=0]){const doc=document();mutate(doc);assert.throws(()=>compiler.compile(doc));}});

function colorEdit(id, order, range = { start: 2, end: 5 }) {
  return { ...document().edits[0], id, order, type: 'video.color.adjustment@1', range,
    payload: { temperature: 0.4, brightness: 0, saturation: 1, contrast: 1 } };
}
test('compiles source effects before overlays with stable order and one connected video head', () => {
  const compiler = createRenderGraphCompiler(), doc = document();
  doc.edits = [doc.edits[0], colorEdit('later', 5), colorEdit('tie-first', 2), colorEdit('tie-second', 2)];
  const graph = compiler.compile(doc);
  assert.deepEqual(graph.nodes.map(node => node.id), ['node-main-video', 'node-tie-first', 'node-tie-second', 'node-later', 'node-e1']);
  graph.nodes.slice(1).forEach((node, index) => assert.deepEqual(node.inputs, [{ port: 'base', nodeId: graph.nodes[index].id }]));
  assert.deepEqual(graph.nodes[1].range, { start: 2, end: 5 });
  assert.equal(graph.outputs.video.nodeId, 'node-e1');
  assert.equal(graph.outputs.audio.nodeId, 'node-main-video');
  assert.deepEqual(compiler.validate(graph), graph);
});
test('validates local edit/node ranges and all disabled edit payloads', () => {
  const compiler = createRenderGraphCompiler(), doc = document();
  doc.edits = [colorEdit('color', 0)];
  assert.equal(compiler.compile(doc).nodes.length, 2);
  for (const range of [{ start: -1, end: 2 }, { start: 3, end: 3 }, { start: 2, end: 9 }, { start: NaN, end: 5 }]) {
    const invalid = structuredClone(doc); invalid.edits[0].range = range;
    assert.throws(() => compiler.compile(invalid));
    const graph = compiler.compile(doc); graph.nodes[1].range = range;
    assert.throws(() => compiler.validate(graph));
  }
  for (const mutate of [edit => edit.payload.temperature = 2, edit => edit.payload.videoPath = '/private/video.mp4', edit => edit.type = 'unknown']) {
    const invalid = structuredClone(doc); invalid.edits[0].enabled = false; mutate(invalid.edits[0]);
    assert.throws(() => compiler.compile(invalid));
  }
});
test('rejects a registered source effect placed after an overlay in a supplied graph', () => {
  const compiler = createRenderGraphCompiler(), doc = document(); doc.edits.push(colorEdit('color', 1));
  const graph = compiler.compile(doc);
  [graph.nodes[1], graph.nodes[2]] = [graph.nodes[2], graph.nodes[1]];
  graph.nodes[1].inputs[0].nodeId = graph.nodes[0].id;
  graph.nodes[2].inputs[0].nodeId = graph.nodes[1].id;
  graph.outputs.video.nodeId = graph.nodes[2].id;
  assert.throws(() => compiler.validate(graph));
});
test('orders source effects, visual layers in edit order, then subtitles',()=>{
  const doc=document(),base=doc.edits[0];doc.edits=[base,colorEdit('color',9),
    {...base,id:'text',order:2,type:'visual.text.layer@1',range:{start:1,end:3},payload:{text:'上层',x:.12,y:.12,fontSize:.05,color:'#FFFFFF'}},
    {...base,id:'shape',order:1,type:'visual.shape.layer@1',range:{start:1,end:3},payload:{x:.1,y:.1,width:.3,height:.15,color:'#000000'}}];
  const graph=createRenderGraphCompiler().compile(doc);
  assert.deepEqual(graph.nodes.map(n=>n.id),['node-main-video','node-color','node-shape','node-text','node-e1']);
});
