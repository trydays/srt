const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs/promises'); const os=require('node:os'); const path=require('node:path');
const {EventEmitter}=require('node:events'); const {PassThrough}=require('node:stream');
const {createVideoExportService,buildVideoFilters}=require('../src/video-export');
const {execFile}=require('node:child_process'); const {promisify}=require('node:util'); const execFileAsync=promisify(execFile);

const recipe={version:1,steps:[
  {capability:'visual.shape@1',range:{start:1,end:3},params:{x:.1,y:.1,width:.4,height:.25,color:'#000000'}},
  {capability:'visual.text@1',range:{start:1,end:3},params:{text:'重点:%{x}\n\n第二行',x:.12,y:.12,fontSize:.08,color:'#FFFFFF'}}
]};
test('builds controlled half-open shape and text filters',()=>{
  const filter=buildVideoFilters(recipe,{displayWidth:640,displayHeight:360,sampleAspectRatio:'1/1'});
  assert.match(filter,/drawbox=x=64:y=36:w=256:h=90:color=0x000000:t=fill:enable='gte\(t,1\)\*lt\(t,3\)'/);
  assert.match(filter,/textfile=layer-1-0\.txt:expansion=none:fontsize=29:x=77:y=72:y_align=baseline/);
  assert.match(filter,/textfile=layer-1-2\.txt/); assert.doesNotMatch(filter,/重点|%\{x\}/);
});

function child(stdout,before){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{};setImmediate(async()=>{if(stdout)c.stdout.write(stdout);if(before)await before();c.emit('close',0,null);});return c;}
test('writes literal UTF-8 text files inside the render task directory',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'srt-layer-unit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source.mp4'),output=path.join(dir,'out.mp4');await fs.writeFile(source,'x');
  const probe=JSON.stringify({streams:[{codec_type:'video',width:640,height:360},{codec_type:'audio'}],format:{duration:'4'}});
  let call=0, captured={}; const service=createVideoExportService({getExportTools:async()=>({ffmpegPath:'ffmpeg',ffprobePath:'ffprobe'}),spawnImpl:(_cmd,args,opts)=>{
    call++;if(call===1||call===3)return child(probe);return child('',async()=>{captured.filter=args[args.indexOf('-vf')+1];captured.first=await fs.readFile(path.join(opts.cwd,'layer-1-0.txt'),'utf8');captured.second=await fs.readFile(path.join(opts.cwd,'layer-1-2.txt'),'utf8');await fs.writeFile(args.at(-1),'video');});
  }});
  assert.equal((await service.start({jobId:'layer',videoPath:source,outputPath:output,recipe})).status,'completed');
  assert.deepEqual([captured.first,captured.second],['重点:%{x}','第二行']);assert.doesNotMatch(captured.filter,/重点|%\{x\}/);
});

test('renders overlapping layers and literal multilingual text into real media',{skip:process.env.SRT_REAL_EXPORT!=='1'},async(t)=>{
  const ffmpeg=process.env.SRT_FFMPEG_PATH,ffprobe=process.env.SRT_FFPROBE_PATH;assert.ok(ffmpeg);assert.ok(ffprobe);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'srt-cycle4-layer-real-'));
  if(process.env.SRT_KEEP_REAL_EXPORT==='1') console.log(`REAL_LAYER_EXPORT_DIR=${dir}`); else t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source.mp4'),output=path.join(dir,'layers.mp4');
  await execFileAsync(ffmpeg,['-n','-f','lavfi','-i','color=c=0x243044:s=640x360:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
  const realRecipe={version:1,steps:[
    {capability:'visual.shape@1',range:{start:.5,end:3.5},params:{x:.1,y:.1,width:.5,height:.4,color:'#CC0000'}},
    {capability:'visual.text@1',range:{start:.5,end:3.5},params:{text:'重点:%{x}, \"引号\"',x:.12,y:.12,fontSize:.08,color:'#FFFFFF'}},
    {capability:'visual.shape@1',range:{start:1.5,end:2.5},params:{x:.3,y:.25,width:.5,height:.4,color:'#00CC00'}},
    {capability:'visual.text@1',range:{start:1.5,end:2.5},params:{text:'第二张卡',x:.32,y:.27,fontSize:.06,color:'#FFFFFF'}}
  ]};
  const service=createVideoExportService({getExportTools:async()=>({ffmpegPath:ffmpeg,ffprobePath:ffprobe})});
  assert.equal((await service.start({jobId:'real-layers',videoPath:source,outputPath:output,recipe:realRecipe})).status,'completed');
  const {stdout}=await execFileAsync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',output]);const probe=JSON.parse(stdout);
  assert.equal(probe.streams.find(s=>s.codec_type==='video').width,640);assert.equal(probe.streams.find(s=>s.codec_type==='video').height,360);
  assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-4)<.2);
  async function frame(time){const {stdout:raw}=await execFileAsync(ffmpeg,['-v','error','-ss',String(time),'-i',output,'-vf','format=rgb24','-frames:v','1','-f','rawvideo','pipe:1'],{encoding:'buffer'});return raw;}
  function pixel(raw,x,y){const offset=(y*640+x)*3;return [...raw.subarray(offset,offset+3)];}
  const frames=await Promise.all([.25,1,2,3.75].map(frame));
  const [base,red,green,after]=frames.map(raw=>pixel(raw,250,130));
  assert.ok(red[0]>red[1]*2);assert.ok(green[1]>green[0]*2);assert.deepEqual(after,base);
  let whiteInk=0;for(let y=43;y<76;y++)for(let x=77;x<270;x++){const [r,g,b]=pixel(frames[1],x,y);if(r>210&&g>210&&b>210)whiteInk++;}
  assert.ok(whiteInk>30,`expected real text ink, got ${whiteInk} bright pixels`);
  console.log(`REAL_LAYER_EXPORT_OUTPUT=${output}`);
});
