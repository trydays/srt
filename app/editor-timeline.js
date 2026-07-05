/* === editor-timeline.js — 三天remotion 时间轴 + 聊天 + AI 翻译 === */

/* ── Timeline ── */
var track=document.getElementById('tlTrack'),playhead=document.getElementById('tlPlayhead'),tlCur=document.getElementById('tlCurrent'),tlTotal=document.getElementById('tlTotal'),dragging=false;
/* 缓存 track 宽度避免 timeupdate 时 layout thrashing；resize 时重置 */
var _trackW = 0;
function trackWidth(){ if(!_trackW)_trackW=track.getBoundingClientRect().width; return _trackW; }
window.addEventListener('resize',function(){ _trackW = 0; });
function posToPct(cx){var r=track.getBoundingClientRect(),pad=16;return Math.max(0,Math.min(1,(cx-r.left-pad)/(r.width-pad*2)))}
function getDur(){return videoDuration||200}
function pctToTime(pct){return formatDur(pct*getDur())}
function renderPlayhead(pct){var pad=16;playhead.style.left=(pad+pct*(trackWidth()-pad*2))+'px';tlCur.textContent=pctToTime(pct)}
/* Seek video from playhead */
function seekVideo(pct){if(videoDuration)videoEl.currentTime=pct*videoDuration;renderPlayhead(pct)}
/* Update playhead from video */
videoEl.addEventListener('timeupdate',function(){if(!dragging&&videoDuration)renderPlayhead(videoEl.currentTime/videoDuration)});

track.addEventListener('mousedown',function(e){dragging=true;seekVideo(posToPct(e.clientX));e.preventDefault()});
document.addEventListener('mousemove',function(e){if(!dragging)return;seekVideo(posToPct(e.clientX))});
document.addEventListener('mouseup',function(){dragging=false});

/* ── Timeline drop: drag component → add marker ── */
var timelineEffects = [];

/* 创建单个 marker DOM 节点（纯函数，不操作 timelineEffects） */
function createMarkerDOM(ef, idx) {
  var pad=16, w=trackWidth()-pad*2;
  var left = pad + (ef.time / getDur()) * w;
  var m = document.createElement('span');
  m.className = 'tl-marker';
  m.style.left = left+'px';
  m.style.background = ef.color || 'var(--accent-tint)';
  m.style.color = 'var(--text-strong)';
  m.style.border = '1px solid '+(ef.color||'var(--accent)');
  m.textContent = ef.name;
  m.title = ef.name + ' @ ' + formatDur(ef.time) + ' — 右键删除';
  m.addEventListener('contextmenu',function(e){e.preventDefault();var i=parseInt(this.dataset.idx);timelineEffects.splice(i,1);this.remove();reindexMarkers(i);});
  m.dataset.idx = idx;
  return m;
}

/* 增量追加（拖入时用） */
function addMarker(ef) {
  track.appendChild(createMarkerDOM(ef, timelineEffects.length - 1));
}

/* 删除后重排后续 marker 的 idx */
function reindexMarkers(fromIdx) {
  var markers = track.querySelectorAll('.tl-marker');
  for (var i = fromIdx; i < markers.length; i++) markers[i].dataset.idx = i;
}

/* 全量重建（ResizeObserver 用 — 宽度变化后位置需重算） */
function renderMarkers(){
  var old = track.querySelectorAll('.tl-marker'); for(var i=0;i<old.length;i++)old[i].remove();
  for(var i=0;i<timelineEffects.length;i++){
    track.appendChild(createMarkerDOM(timelineEffects[i], i));
  }
}

/* ResizeObserver + rAF 防抖：拖拽 split pane 时最多 60fps 触发一次 */
var _roPending = false;
var ro = new ResizeObserver(function(){
  if (_roPending) return;
  _roPending = true;
  requestAnimationFrame(function(){
    _roPending = false;
    renderMarkers();
  });
});
ro.observe(track);

track.addEventListener('dragover',function(e){e.preventDefault();e.dataTransfer.dropEffect='copy';track.classList.add('drag-over-tl')});
track.addEventListener('dragleave',function(){track.classList.remove('drag-over-tl')});
track.addEventListener('drop',function(e){
  e.preventDefault(); track.classList.remove('drag-over-tl');
  var name = e.dataTransfer.getData('text/plain');
  if(!name)return;
  var comp = null;
  for(var i=0;i<COMPONENTS.length;i++){if(COMPONENTS[i].name===name){comp=COMPONENTS[i];break}}
  var t = videoDuration ? videoEl.currentTime : posToPct(e.clientX) * getDur();
  var ef = {name:name, time:t, color:comp?comp.color:null};
  timelineEffects.push(ef);
  addMarker(ef);
});

/* ── Render mode ── */
var renderMode = localStorage.getItem(STORAGE_KEYS.RENDER_MODE) || 'browser';
var generateBtn=document.getElementById('generateBtn');
generateBtn.textContent = renderMode === 'cli' ? 'FFmpeg 导出 →' : '生成效果 →';

/* ── Chat ── */
var chatArea=document.getElementById('chatArea'),chatEmpty=document.getElementById('chatEmpty'),editorEl=document.querySelector('.input-editor');
function setSubmitState(){generateBtn.disabled=editorEl.textContent.trim().length===0}
editorEl.addEventListener('input',setSubmitState);setSubmitState();
function addMsg(role,text){
  if(chatEmpty)chatEmpty.style.display='none';var n=new Date();var t=('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2);
  var d=document.createElement('div');d.className='msg'+(role==='user'?' user':'');
  var s=text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  d.innerHTML='<div class="role'+(role==='user'?' user':'')+'">'+(role==='user'?'你':'三天')+'</div><div class="msg-text">'+s+'</div><div class="msg-time">'+t+'</div>';
  chatArea.appendChild(d);chatArea.scrollTo({top:chatArea.scrollHeight,behavior:'smooth'});
}

/* 判断输入是否为可执行命令 */
function isCommand(text){
  var prefixes=['ffmpeg','ffprobe','python','node','npm','npx','pip','winget','dir','ls','echo','where','nvidia-smi'];
  var t=text.trim().toLowerCase();
  for(var i=0;i<prefixes.length;i++){if(t.indexOf(prefixes[i])===0)return true}
  return false;
}

/* ── generateBtn 路由 ── */
function executeCommand(text) {
  addMsg('ai','🔄 执行中…');
  var statusMsg = chatArea.lastElementChild;
  cliExec(text, 30000, function(r){
    statusMsg.remove();
    if(r.ok){
      addMsg('ai','✅ 命令执行成功\n\n'+r.stdout+'\n\n💡 提示：修改后的视频请用上方播放器预览。');
    } else {
      addMsg('ai','❌ 命令失败 (exit code '+r.exitCode+')\n\n'+r.stderr+'\n\n💡 提示：请检查命令是否正确，或确认工具已安装。');
    }
  });
}

function executeEffect(translated) {
  addMsg('ai','💡 匹配到效果：'+translated.desc+'\n\n```\n'+translated.cmd+'\n```\n\n🔄 执行中…');
  var statusMsg = chatArea.lastElementChild;
  cliExec(translated.cmd, 30000, function(r){
    statusMsg.remove();
    if(r.ok){
      addMsg('ai','✅ 效果已应用\n\n'+r.stdout+'\n\n💡 提示：请用上方播放器预览输出文件。');
    } else {
      addMsg('ai','❌ 执行失败 (exit code '+r.exitCode+')\n\n'+r.stderr+'\n\n💡 请检查 FFmpeg 是否已安装，或复制上方命令手动执行。');
    }
  });
}

function showAIHints(text) {
  var hints = ['淡入','淡出','霓虹','光晕','模糊','锐化','黑白','加速','减速','翻转','裁剪','缩放','静音','复古','暖色','冷色'];
  addMsg('ai','收到：「'+text+'」\n\n未识别到效果关键词。当前支持的效果：\n\n🎬 ' + hints.slice(0,8).join(' · ') + '\n🎨 ' + hints.slice(8).join(' · ') + '\n\n💡 试试效果关键词，或配置 AI 获得任意效果翻译。\n也可以直接输入 FFmpeg 命令。');
}

function executeElectronAI(text) {
  addMsg('ai','正在通过 AI 分析效果描述...');
  var aiStatusMsg = chatArea.lastElementChild;
  window.electronAPI.aiTranslate(text).then(function(r) {
    aiStatusMsg.remove();
    if (r.ok) {
      var label = r.source === 'ollama' ? '🦙 Ollama' : '🤖 AI';
      addMsg('ai',label+' 翻译：`'+r.cmd+'`\n\n🔄 执行中...');
      var execMsg = chatArea.lastElementChild;
      cliExec(r.cmd, 300000, function(r2){
        execMsg.remove();
        if(r2.ok) addMsg('ai','✅ 执行成功\n\n'+r2.stdout);
        else addMsg('ai','❌ 执行失败\n\n'+r2.stderr+'\n\n💡 命令：`'+r.cmd+'`');
      });
    } else if (r.needConfig) {
      addMsg('ai','❌ 未配置 AI\n\n💡 零配置方案：\n• 安装 Ollama 获得免费本地 AI\n• 让 Agent 运行 npx srt-setup\n• 或在环境检测页手动填写 Key');
    } else {
      addMsg('ai','❌ 翻译失败：'+r.error+'\n\n💡 试试效果关键词或直接输入 FFmpeg 命令。');
    }
  }).catch(function(){
    aiStatusMsg.remove();
    addMsg('ai','❌ AI 请求失败\n\n💡 试试效果关键词或检查网络。\n也可以直接输入 FFmpeg 命令。');
  });
}

function executeFetchAI(text, aiCfg) {
  addMsg('ai','正在通过 AI 分析效果描述...');
  var fetchStatusMsg = chatArea.lastElementChild;
  var ep = aiCfg.provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  var model = aiCfg.provider === 'deepseek' ? 'deepseek-chat' : 'gpt-3.5-turbo';
  var prompt = '将以下自然语言翻译为单个 ffmpeg 命令（只输出完整命令，不要解释和markdown代码块，直接以 ffmpeg 开头）：' + text;
  fetch(ep, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+aiCfg.key}, body:JSON.stringify({model:model, messages:[{role:'user',content:prompt}], max_tokens:300, temperature:0}) })
    .then(function(r){ if(!r.ok){ return r.json().then(function(d){ throw new Error((d.error&&d.error.message)||'HTTP '+r.status); }); } return r.json(); })
    .then(function(d){
      fetchStatusMsg.remove();
      if (d.choices && d.choices[0]) {
        var aiCmd = d.choices[0].message.content.trim();
        var m = aiCmd.match(/(ffmpeg\s+[\s\S]+)/i); if (m) aiCmd = m[1].trim();
        if (aiCmd.indexOf('ffmpeg') === 0) {
          addMsg('ai','🤖 AI 翻译：`'+aiCmd+'`\n\n🔄 执行中...');
          var fetchExecMsg = chatArea.lastElementChild;
          cliExec(aiCmd, 300000, function(r2){
            fetchExecMsg.remove();
            if(r2.ok) addMsg('ai','✅ 执行成功\n\n'+r2.stdout);
            else addMsg('ai','❌ 执行失败\n\n'+r2.stderr+'\n\n💡 命令：`'+aiCmd+'`');
          });
          return;
        }
      }
      addMsg('ai','❌ AI 未能生成有效命令\n\n💡 试试效果关键词：淡入、霓虹、模糊、加速...');
    })
    .catch(function(e){
      fetchStatusMsg.remove();
      addMsg('ai','❌ AI 请求失败\n\n💡 试试效果关键词或检查网络和 API Key。\n也可以直接输入 FFmpeg 命令。');
    });
}

function electronAIAvail() {
  return !!(window.electronAPI && window.electronAPI.aiTranslate);
}

function getAIConfig() {
  var cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_CONFIG)); } catch(_){}
  return cfg && cfg.key ? cfg : null;
}

/* ── generateBtn click handler ── */
generateBtn.addEventListener('click',function(){
  var t=editorEl.textContent.trim();if(!t)return;
  addMsg('user',t);editorEl.textContent='';setSubmitState();

  if(isCommand(t)){
    executeCommand(t);
  } else {
    var tr = translateEffect(t);
    if(tr.matched){
      executeEffect(tr);
    } else if(electronAIAvail()){
      executeElectronAI(t);
    } else {
      var cfg = getAIConfig();
      if(cfg) { executeFetchAI(t, cfg); }
      else    { showAIHints(t); }
    }
  }
});
editorEl.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();generateBtn.click()}});
