const { test, expect } = require('./electron.fixture');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const run = promisify(execFile);

test.describe('real selected CLI + local ASR + formal Remotion', () => {
  test.skip(!process.env.SRT_REAL_KEYPOINT_SOURCE || !process.env.SRT_REAL_KEYPOINT_USER_DATA,
    'Explicit local speech video and prepared model/CLI profile required; consumes real model calls.');
  test.use({localCliMode:'two',localCliEffectResult:'real-keypoints',subtitleResult:'real-keypoints',remotionRendering:true});
  test.setTimeout(300000);
  test.afterEach(async ({window,readScenarioState},testInfo) => {
    const state=await readScenarioState();
    const project=await window.evaluate(()=>typeof projectEditing !== 'undefined' && getActiveProjectId()
      ? projectEditing.load(getActiveProjectId()) : null).catch(()=>null);
    const evidencePath=testInfo.outputPath('real-cli-evidence.json');
    await fs.writeFile(evidencePath,JSON.stringify({
      translationCalls:state.translationCalls || [],
      translationResults:state.realTranslationResults || [],
      processes:state.realCliProcesses || [],
      subtitleCallCount:(state.subtitleCalls || []).length,
      project
    },null,2));
    await testInfo.attach('real-cli-evidence', {path:evidencePath,contentType:'application/json'});
  });
  test('extracts spoken keypoints without creating subtitles, renders and undoes atomically', async ({window,readScenarioState},testInfo) => {
    const source=testInfo.outputPath('speech-source.mp4');
    const ffmpeg='/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
    await run(ffmpeg, ['-v', 'error', '-i', process.env.SRT_REAL_KEYPOINT_SOURCE,
      '-map', '0:v:0', '-map', '0:a:0', '-t', '35',
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    const probe=await run('/opt/homebrew/opt/ffmpeg-full/bin/ffprobe',
      ['-v','error','-show_entries','format=duration','-of','json',source]);
    const durationSeconds=Number(JSON.parse(probe.stdout).format.duration);
    expect(durationSeconds).toBeGreaterThan(0);
    const {selectedCliId}=JSON.parse(await fs.readFile(path.join(process.env.SRT_REAL_KEYPOINT_USER_DATA,'local-cli.json'),'utf8'));
    expect(['codex','claude']).toContain(selectedCliId);
    await window.getByTestId(`local-cli-${selectedCliId}`).click(); await window.getByTestId('continue').click();
    await window.getByTestId('video-input').setInputFiles(source); await window.getByTestId('start-editing').click();
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state','ready');
    await window.locator('.input-editor').fill('提炼整段视频口播中的关键观点，在对应讲述位置弹出重点文字。每个要点用醒目的大标题、简短说明和小标签组成，白色粗体，轻阴影，淡入并略微放大，结束淡出。放左右两侧，避开底部字幕区域，不生成字幕轨。只根据口播提炼，不要编造。');
    const before=await window.evaluate(()=>projectEditing.load(getActiveProjectId()));
    await fs.writeFile(testInfo.outputPath('before.json'),JSON.stringify(before,null,2));
    await window.locator('#generateBtn').click();
    const card=window.getByTestId('request-status-card').last();
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state','success',{timeout:180000});
    const state=await readScenarioState();
    expect(state.translationCalls.length).toBe(2);
    expect(state.subtitleCalls.length).toBe(1);
    const snapshot=await window.evaluate(()=>projectEditing.load(getActiveProjectId()));
    expect(snapshot.document.edits.length).toBeGreaterThan(0);
    expect(snapshot.document.edits.every(edit=>edit.type==='visual.group.layer@1')).toBe(true);
    expect(new Set(snapshot.document.edits.map(edit=>edit.transactionId)).size).toBe(1);
    expect(snapshot.document.edits.every(edit=>edit.range.start>=0 && edit.range.end<=durationSeconds+0.1)).toBe(true);
    await fs.writeFile(testInfo.outputPath('applied.json'),JSON.stringify(snapshot,null,2));
    const recipePath=testInfo.outputPath('real-ai-recipe.json');
    await fs.writeFile(recipePath,JSON.stringify({
      edits:snapshot.document.edits,
      transcript:state.translationCalls[1].context.transcript
    },null,2));
    await testInfo.attach('real-ai-recipe',{path:recipePath,contentType:'application/json'});
    const callsBeforeReload=state.translationCalls.length;
    await window.reload();
    await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state','ready');
    expect((await readScenarioState()).translationCalls.length).toBe(callsBeforeReload);
    expect(await window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits))
      .toEqual(snapshot.document.edits);
    const middle=snapshot.document.edits[0].range.start + (snapshot.document.edits[0].range.end-snapshot.document.edits[0].range.start)/2;
    await window.evaluate(t=>editorPlayback.seekSeconds(t),middle);
    await window.locator('#remotionPreview').screenshot({path:testInfo.outputPath('real-keypoints.png')});
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('导出完成',{timeout:180000});
    const kept=testInfo.outputPath('real-keypoints.mp4'); await fs.copyFile(state.exportOutputPath,kept);
    await testInfo.attach('real-keypoints',{path:kept,contentType:'video/mp4'});
    await window.getByTestId('request-status-summary').last().click();
    await window.getByTestId('subtitle-undo').last().click();
    await expect.poll(()=>window.evaluate(()=>projectEditing.load(getActiveProjectId()).document.edits.length)).toBe(0);
    const undone=await window.evaluate(()=>projectEditing.load(getActiveProjectId()));
    expect(undone.document.edits).toEqual(before.document.edits);
    await fs.writeFile(testInfo.outputPath('undone.json'),JSON.stringify(undone,null,2));
  });
});
