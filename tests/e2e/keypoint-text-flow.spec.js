const {test,expect}=require('./electron.fixture');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs/promises');
const run=promisify(execFile);
async function open(window,testInfo) {
  const source=testInfo.outputPath('source.mp4');
  await run('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',['-v','error','-f','lavfi','-i',
    'color=c=0x20252F:s=640x360:r=24:d=4','-c:v','libx264','-pix_fmt','yuv420p',source]);
  await window.getByTestId('local-cli-codex').click(); await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source); await window.getByTestId('start-editing').click();
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state','ready');
}
async function submit(window,text) {
  await window.locator('.input-editor').fill(text); await window.locator('#generateBtn').click();
  return window.getByTestId('request-status-card').last();
}
test.describe('keypoint request lifecycle (fixed model + ASR boundaries)',()=>{
  test.use({localCliMode:'two',localCliEffectResult:'keypoint-text-flow',remotionRendering:true});
  test('no subtitles: reads speech once, commits once, keeps gaps, reloads without rerun, undoes once',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo);
    const card=await submit(window,'提炼要点');
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','success');
    const state=await readScenarioState();
    expect(state.translationCalls).toHaveLength(2); expect(state.subtitleCalls).toHaveLength(1);
    const edits=await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits);
    expect(edits.map(e=>e.type)).toEqual(['visual.group.layer@1','visual.group.layer@1']);
    expect(new Set(edits.map(e=>e.transactionId)).size).toBe(1);
    expect(await window.evaluate(()=>aggregateVisualTimelineItems(projectEditing.timelineItems(getActiveProjectId())).map(i=>i.range)))
      .toEqual([{start:.2,end:1.4},{start:2,end:3.5}]);
    await expect(card.getByTestId('request-status-details')).toBeHidden();
    await window.reload(); await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state','ready');
    expect((await readScenarioState()).translationCalls).toHaveLength(2);
    await window.evaluate(()=>editorPlayback.seekSeconds(.8));
    await window.locator('#remotionPreview').screenshot({path:testInfo.outputPath('fixed-keypoints.png')});
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('导出完成');
    const output=testInfo.outputPath('fixed-keypoints.mp4');
    await fs.copyFile((await readScenarioState()).exportOutputPath,output);
    await testInfo.attach('fixed-keypoints',{path:output,contentType:'video/mp4'});
    await window.getByTestId('request-status-summary').last().click(); await window.getByTestId('subtitle-undo').click();
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits)).toHaveLength(0);
  });
  test('applied subtitles: uses complete text, preserves draft and earlier edit, ordinary no-range group remains valid',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo);
    await window.evaluate(async()=>{
      await projectEditing.applyRecipe({projectId:getActiveProjectId(),expectedRevision:0,requestId:'prior-subtitle',
        recipe:{kind:'instruction',steps:[{capability:'subtitle.generate@1',params:{}}]}});
      subtitleController.render();
      const snapshot=projectEditing.load(getActiveProjectId());
      const subtitle=snapshot.document.edits[0];
      const texts=Object.fromEntries(subtitle.payload.segments.map((segment,index)=>[segment.id,index===0?'用户未应用的草稿':segment.text]));
      subtitleDraftStore.save(getActiveProjectId(),subtitle.id,snapshot.document.revision,texts,subtitle.payload.segments);
      subtitleController.render();
    });
    const before=await window.evaluate(()=>({segments:subtitleController.getAppliedSegments(),
      draft:subtitleDraftStore.get(getActiveProjectId(),projectEditing.load(getActiveProjectId()).document.edits[0].id).textById}));
    const card=await submit(window,'提炼要点');
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','success');
    const state=await readScenarioState();
    expect(state.translationCalls).toHaveLength(1); expect(state.subtitleCalls).toHaveLength(1);
    expect(state.translationCalls[0].context.transcript.segments.map(s=>s.text)).toEqual(before.segments.map(s=>s.text));
    expect(await window.evaluate(()=>subtitleController.getAppliedSegments())).toEqual(before.segments);
    expect(await window.evaluate(()=>subtitleDraftStore.get(getActiveProjectId(),projectEditing.load(getActiveProjectId()).document.edits[0].id).textById)).toEqual(before.draft);
    const ordinary=await submit(window,'普通整段文字');
    await expect(ordinary.getByTestId('timeline-status')).toHaveAttribute('data-state','success');
    expect((await readScenarioState()).subtitleCalls).toHaveLength(1);
  });
  test('repeated prepare is stopped without committing edits',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo); const card=await submit(window,'重复准备');
    await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state','failed');
    expect((await readScenarioState()).translationCalls).toHaveLength(2);
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits)).toHaveLength(0);
  });
  test('out-of-range continuation is rejected without committing edits',async({window},testInfo)=>{
    await open(window,testInfo); const card=await submit(window,'越界要点');
    await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state','failed');
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits)).toHaveLength(0);
  });
  test('revision change during continuation preserves the intervening edit only',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo); const card=await submit(window,'延迟准备');
    await expect.poll(async()=>(await readScenarioState()).translationCalls.length).toBe(2);
    await window.evaluate(async()=>{
      const loaded=projectEditing.load(getActiveProjectId());
      await projectEditing.applyRecipe({projectId:getActiveProjectId(),expectedRevision:loaded.document.revision,
        requestId:'intervening-edit',recipe:{kind:'instruction',steps:[{capability:'video.color.adjust@1',
          params:{brightness:.1}}]}});
    });
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','failed');
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits.map(edit=>edit.transactionId)))
      .toEqual(['intervening-edit']);
  });
  test('primary material change during continuation prevents a late commit',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo); const card=await submit(window,'延迟准备');
    await expect.poll(async()=>(await readScenarioState()).translationCalls.length).toBe(2);
    await window.evaluate(()=>{ window.currentProjectVideoPath='/fixture/replaced-main-video.mp4'; });
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','failed');
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits)).toHaveLength(0);
  });
  test('clarify after preparation reuses speech for the user follow-up and commits once',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo); const card=await submit(window,'准备后反问');
    await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state','clarifying');
    await expect(card.getByTestId('request-clarify')).toContainText('偏左还是偏右');
    const state=await readScenarioState();
    expect(state.translationCalls).toHaveLength(2); expect(state.subtitleCalls).toHaveLength(1);
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits)).toHaveLength(0);
    await window.locator('.input-editor').fill('左侧'); await window.locator('#generateBtn').click();
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','success');
    const completed=await readScenarioState();
    expect(completed.translationCalls).toHaveLength(3); expect(completed.subtitleCalls).toHaveLength(1);
    expect(completed.translationCalls[2].context.transcript).toEqual(completed.translationCalls[1].context.transcript);
    const edits=await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits);
    expect(edits).toHaveLength(2); expect(new Set(edits.map(edit=>edit.transactionId)).size).toBe(1);
  });
  test('oversized applied subtitles restore the narrow prepared transcript after clarification',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo);
    await window.evaluate(async()=>{
      await projectEditing.applyRecipe({projectId:getActiveProjectId(),expectedRevision:0,requestId:'prior-subtitle',
        recipe:{kind:'instruction',steps:[{capability:'subtitle.generate@1',params:{}}]}});
      let snapshot=projectEditing.load(getActiveProjectId());
      const subtitle=snapshot.document.edits[0];
      const segments=Array.from({length:400},(_,index)=>({id:'long-'+index,start:index/100,end:(index+1)/100,
        text:String(index).padStart(3,'0')+'-'+ '长'.repeat(66)}));
      await projectEditing.replaceEdit({projectId:getActiveProjectId(),expectedRevision:snapshot.document.revision,
        editId:subtitle.id,payload:{segments,style:subtitle.payload.style}});
      snapshot=projectEditing.load(getActiveProjectId());
      subtitleController.render();
      const applied=snapshot.document.edits[0];
      const texts=Object.fromEntries(applied.payload.segments.map((segment,index)=>[segment.id,index===0?'未应用的超长字幕草稿':segment.text]));
      subtitleDraftStore.save(getActiveProjectId(),applied.id,snapshot.document.revision,texts,applied.payload.segments);
      subtitleController.render();
    });
    const before=await window.evaluate(()=>{
      const snapshot=projectEditing.load(getActiveProjectId()); const subtitle=snapshot.document.edits[0];
      return {subtitle:subtitle,draft:subtitleDraftStore.get(getActiveProjectId(),subtitle.id).textById};
    });
    const card=await submit(window,'超长字幕反问');
    await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state','clarifying');
    let state=await readScenarioState();
    expect(state.translationCalls).toHaveLength(2); expect(state.subtitleCalls).toHaveLength(1);
    expect(state.translationCalls[0].context.transcript).toBeUndefined();
    expect(state.translationCalls[1].context.transcript.range).toEqual({start:0,end:1});
    await window.locator('.input-editor').fill('超长左侧'); await window.locator('#generateBtn').click();
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','success');
    state=await readScenarioState();
    expect(state.translationCalls).toHaveLength(3); expect(state.subtitleCalls).toHaveLength(1);
    expect(state.translationCalls[2].context.transcript).toEqual(state.translationCalls[1].context.transcript);
    const after=await window.evaluate(()=>{
      const snapshot=projectEditing.load(getActiveProjectId()); const subtitle=snapshot.document.edits.find(e=>e.type==='subtitle.track@1');
      return {edits:snapshot.document.edits,subtitle,draft:subtitleDraftStore.get(getActiveProjectId(),subtitle.id).textById};
    });
    expect(after.subtitle).toEqual(before.subtitle); expect(after.draft).toEqual(before.draft);
    const newEdits=after.edits.filter(edit=>edit.type!=='subtitle.track@1');
    expect(newEdits).toHaveLength(1); expect(newEdits[0].range).toEqual({start:.2,end:.8});
    expect(new Set(newEdits.map(edit=>edit.transactionId)).size).toBe(1);
  });
});
test.describe('speech failure preserves project',()=>{
  test.use({localCliMode:'two',localCliEffectResult:'keypoint-text-flow',subtitleResult:'no-speech',remotionRendering:true});
  test('does not continue or apply when no speech exists',async({window,readScenarioState},testInfo)=>{
    await open(window,testInfo);const card=await submit(window,'提炼要点');
    await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state','failed');
    expect((await readScenarioState()).translationCalls).toHaveLength(1);
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits)).toHaveLength(0);
  });
});
