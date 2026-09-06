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
  return track.appendChild(createMarkerDOM(ef, timelineEffects.length - 1));
}

function applyLocalCliEffect(instruction) {
  if (!instruction || instruction.type !== 'add_effect' || instruction.effect !== 'fade_in') return false;
  var effect = { name: '淡入', time: videoDuration ? videoEl.currentTime : 0,
    color: 'var(--accent)' };
  var marker = createMarkerDOM(effect, timelineEffects.length);
  marker.dataset.testid = 'timeline-effect-fade-in';
  track.appendChild(marker);
  timelineEffects.push(effect);
  return true;
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
    _trackW = 0;
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
generateBtn.textContent = '发送';

/* ── Chat ── */
var chatArea = document.getElementById('chatArea');
var chatEmpty = document.getElementById('chatEmpty');
var editorEl = document.querySelector('.input-editor');
var activeProjectId = getActiveProjectId();
var conversationRecords = getProjectConversation(activeProjectId);
var requestInFlight = false;
function setSubmitState(){generateBtn.disabled=requestInFlight||editorEl.textContent.trim().length===0}
editorEl.addEventListener('input',setSubmitState);setSubmitState();
function addMsg(role,text){
  if(chatEmpty)chatEmpty.style.display='none';var n=new Date();var t=('0'+n.getHours()).slice(-2)+':'+('0'+n.getMinutes()).slice(-2);
  var d=document.createElement('div');d.className='msg'+(role==='user'?' user':'');
  var s=text.replace(/</g,'&lt;').replace(/>/g,'&gt;');
  d.innerHTML='<div class="role'+(role==='user'?' user':'')+'">'+(role==='user'?'你':'三天')+'</div><div class="msg-text">'+s+'</div><div class="msg-time">'+t+'</div>';
  chatArea.appendChild(d);chatArea.scrollTo({top:chatArea.scrollHeight,behavior:'smooth'});
}

var requestStatusMeta = {
  converting: { label: '转换中', icon: '·' },
  applying: { label: '应用中', icon: '·' },
  generating: { label: '生成中', icon: '·' },
  waiting: { label: '等待', icon: '·' },
  success: { label: '成功', icon: '✓' },
  failed: { label: '失败', icon: '×' },
  not_run: { label: '未执行', icon: '—' }
};
function formatRequestTime(timestamp) {
  var date = new Date(timestamp);
  return ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
}
function escapeConversationText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function requestCardTitle(record) {
  if (record.instructionStatus === 'converting'
      || record.timelineStatus === 'applying' || record.timelineStatus === 'generating') {
    return '正在处理这次编辑';
  }
  if (record.instructionStatus === 'failed' || record.timelineStatus === 'failed') {
    return '这次编辑未完成';
  }
  if (record.subtitleRequest === true && record.timelineStatus === 'success') {
    return '字幕已生成';
  }
  return '这次编辑已完成';
}
function statusRowHTML(testId, label, status) {
  var meta = requestStatusMeta[status];
  return '<div class="request-status-row" data-testid="' + testId
    + '" data-state="' + status + '"><span class="request-status-icon">'
    + meta.icon + '</span><span>' + label + '</span>'
    + '<span class="request-status-value">' + meta.label + '</span></div>';
}
function isSuccessfulRequest(record) {
  return record.instructionStatus === 'success' && record.timelineStatus === 'success';
}
function requestCardSummary(record) {
  var time = formatRequestTime(record.submittedAt);
  if (record.subtitleRequest === true) {
    return '✓ 字幕已生成 · ' + Number(record.resultCount || 0) + ' 条 · ' + time;
  }
  return '✓ 这次编辑已完成 · ' + time;
}
function renderRequestStatusCard(card, record) {
  var isSubtitle = record.subtitleRequest === true;
  var isCollapsed = isSuccessfulRequest(record) && card.dataset.detailsExpanded !== 'true';
  var secondLabel = isSubtitle ? '生成字幕'
    : (record.subtitleRequest === null ? '执行编辑' : '应用到时间轴');
  var secondTestId = isSubtitle ? 'subtitle-status' : 'timeline-status';
  var error = record.error
    ? '<div class="request-error">' + escapeConversationText(record.error) + '</div>' : '';
  var canUndo = isSubtitle && window.subtitleController
    && subtitleController.canUndo(record.id);
  var undo = canUndo
    ? '<button type="button" class="request-undo" data-undo-request="'
      + escapeConversationText(record.id)
      + '" data-testid="subtitle-undo">撤销本次字幕</button>' : '';
  var summary = isSuccessfulRequest(record)
    ? '<button type="button" class="request-status-summary" data-request-details-toggle'
      + ' data-testid="request-status-summary">' + requestCardSummary(record) + '</button>' : '';
  card.classList.toggle('is-collapsed', isCollapsed);
  card.innerHTML = summary + '<div class="request-status-details" data-testid="request-status-details"'
    + (isCollapsed ? ' hidden' : '') + '><div class="request-status-head"><span>' + requestCardTitle(record)
    + '</span><span class="request-status-time">' + formatRequestTime(record.submittedAt)
    + '</span></div>' + statusRowHTML('instruction-status', '转换编辑指令', record.instructionStatus)
    + statusRowHTML(secondTestId, secondLabel, record.timelineStatus)
    + (isSubtitle && record.timelineStatus === 'success'
      ? '<div class="request-result">已生成 ' + Number(record.resultCount || 0) + ' 条字幕</div>' : '')
    + error + undo + '</div>';
}
function appendRequestStatusCard(record) {
  if (chatEmpty) chatEmpty.style.display = 'none';
  var message = document.createElement('div');
  message.className = 'request-user-message';
  message.dataset.testid = 'request-user-message';
  message.textContent = record.text;
  chatArea.appendChild(message);
  var card = document.createElement('div');
  card.className = 'request-status-card';
  card.dataset.testid = 'request-status-card';
  card.dataset.requestId = record.id;
  card.setAttribute('aria-live', 'polite');
  renderRequestStatusCard(card, record);
  chatArea.appendChild(card);
  chatArea.scrollTop = chatArea.scrollHeight;
  return card;
}
function createConversationRequest(text) {
  return { id: createLocalId(), text: text, submittedAt: Date.now(),
    instructionStatus: 'converting', timelineStatus: 'waiting', subtitleRequest: null };
}
function isFinalRequest(record) {
  if (record.instructionStatus === 'failed') return true;
  return record.instructionStatus === 'success'
    && (record.timelineStatus === 'success'
      || record.timelineStatus === 'failed'
      || record.timelineStatus === 'not_run');
}
function updateRequestStatus(record, card, patch) {
  Object.assign(record, patch);
  renderRequestStatusCard(card, record);
  if (activeProjectId && isFinalRequest(record)) {
    var isNewRecord = conversationRecords.indexOf(record) === -1;
    var nextConversationRecords = isNewRecord
      ? conversationRecords.concat([record]) : conversationRecords;
    try {
      saveProjectConversation(activeProjectId, nextConversationRecords);
    } catch (error) {
      if (record.instructionStatus !== 'failed' && record.timelineStatus !== 'failed') {
        throw error;
      }
      return;
    }
    if (isNewRecord) conversationRecords.push(record);
  }
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

function subtitleErrorMessage(code) {
  if (code === 'VIDEO_PATH_UNAVAILABLE') return '当前视频路径不可用，请返回首页重新导入视频。';
  if (code === 'SUBTITLE_RUNTIME_NOT_READY') return '请先到检测页准备 Whisper 字幕。';
  if (code === 'SUBTITLE_NO_SPEECH') return '未检测到可生成字幕的清晰人声。';
  return '字幕生成失败，请重试。';
}

function instructionErrorMessage(code) {
  if (code === 'LOCAL_CLI_NOT_SELECTED' || code === 'LOCAL_CLI_NOT_AVAILABLE') {
    return '请先到检测页选择可用的本地 CLI。';
  }
  if (code === 'LOCAL_CLI_TRANSLATION_TIMEOUT') {
    return '编辑指令转换超时，请重试。';
  }
  if (code === 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT') {
    return '未能识别为当前可用的编辑指令。';
  }
  return '编辑指令转换失败，请重试。';
}

async function runSubtitleInstruction(record, card) {
  record.subtitleRequest = true;
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: 'generating', error: ''
  });
  if (!window.currentProjectVideoPath) {
    updateRequestStatus(record, card, {
      timelineStatus: 'failed', error: subtitleErrorMessage('VIDEO_PATH_UNAVAILABLE')
    });
    return;
  }
  var result = await window.srtAPI.generateSubtitles({
    videoPath: window.currentProjectVideoPath
  });
  if (!result.ok) {
    updateRequestStatus(record, card, {
      timelineStatus: 'failed', error: subtitleErrorMessage(result.errorCode)
    });
    return;
  }
  try {
    updateRequestStatus(record, card, {
      timelineStatus: 'success', resultCount: result.segments.length, error: ''
    });
    subtitleController.replace(record.id, result.segments);
    subtitleController.openAfter(card);
    for (var i = 0; i < conversationRecords.length; i++) {
      var historicalCard = chatArea.querySelector('[data-request-id="' + conversationRecords[i].id + '"]');
      if (historicalCard) renderRequestStatusCard(historicalCard, conversationRecords[i]);
    }
  } catch (_) {
    updateRequestStatus(record, card, {
      timelineStatus: 'failed', error: '字幕暂时无法保存，请重试。'
    });
    return;
  }
}

async function translateAndApply(text, record, card) {
  var translated = await window.srtAPI.translateSubtitleOrFadeIn(text);
  if (!translated.ok) {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed', timelineStatus: 'not_run',
      error: instructionErrorMessage(translated.errorCode)
    });
    return;
  }
  record.instructionStatus = 'success';
  if (translated.instruction.type === 'generate_subtitles') {
    await runSubtitleInstruction(record, card);
    return;
  }
  record.subtitleRequest = false;
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: 'applying', error: ''
  });
  var applied = applyLocalCliEffect(translated.instruction);
  updateRequestStatus(record, card, applied
    ? { timelineStatus: 'success', error: '' }
    : { timelineStatus: 'failed', error: '编辑指令未能应用到时间轴。' });
}

/* ── generateBtn click handler ── */
function hydrateConversationHistory() {
  for (var i = 0; i < conversationRecords.length; i++) {
    appendRequestStatusCard(conversationRecords[i]);
  }
  var latestSubtitleCard = latestValidSubtitleCard();
  if (latestSubtitleCard && window.subtitleController) subtitleController.restoreAfter(latestSubtitleCard);
}
function latestValidSubtitleCard() {
  for (var i = conversationRecords.length - 1; i >= 0; i--) {
    var record = conversationRecords[i];
    if (record.subtitleRequest === true && record.timelineStatus === 'success' && !record.subtitleUndone) {
      return chatArea.querySelector('[data-request-id="' + record.id + '"]');
    }
  }
  return null;
}
hydrateConversationHistory();

generateBtn.addEventListener('click', async function() {
  var text = editorEl.textContent.trim();
  if (!text || generateBtn.disabled) return;
  if (window.subtitleController && !await subtitleController.prepareForNextRequest()) {
    setSubmitState();
    return;
  }
  editorEl.textContent = '';
  setSubmitState();

  if (isCommand(text)) {
    addMsg('user', text);
    executeCommand(text);
    return;
  }

  var record = createConversationRequest(text);
  var card = appendRequestStatusCard(record);
  requestInFlight = true;
  setSubmitState();
  try {
    await translateAndApply(text, record, card);
  } catch (_) {
    updateRequestStatus(record, card, {
      instructionStatus: record.instructionStatus === 'success' ? 'success' : 'failed',
      timelineStatus: record.instructionStatus === 'success' ? 'failed' : 'not_run',
      error: '这次编辑未完成，请重试。'
    });
  } finally {
    requestInFlight = false;
    setSubmitState();
  }
});
chatArea.addEventListener('click', function(event) {
  var summary = event.target.closest('[data-request-details-toggle]');
  if (summary) {
    var summaryCard = summary.closest('[data-request-id]');
    var summaryRecord = conversationRecords.find(function(record) { return record.id === summaryCard.dataset.requestId; });
    if (summaryRecord) {
      summaryCard.dataset.detailsExpanded = summaryCard.dataset.detailsExpanded === 'true' ? '' : 'true';
      renderRequestStatusCard(summaryCard, summaryRecord);
    }
    return;
  }
  var button = event.target.closest('[data-undo-request]');
  if (!button) return;
  var requestId = button.dataset.undoRequest;
  var requestCard = button.closest('[data-request-id]');
  try {
    if (!subtitleController.confirmUndo()) return;
    subtitleController.undo(requestId);
    var undoneRecord = conversationRecords.find(function(record) { return record.id === requestId; });
    updateRequestStatus(undoneRecord, requestCard, { subtitleUndone: true });
    for (var i = 0; i < conversationRecords.length; i++) {
      var card = chatArea.querySelector('[data-request-id="' + conversationRecords[i].id + '"]');
      if (card) renderRequestStatusCard(card, conversationRecords[i]);
    }
    if (subtitleController.count()) {
      var latestSubtitleCard = latestValidSubtitleCard();
      if (latestSubtitleCard) subtitleController.openAfter(latestSubtitleCard);
    }
  } catch (_) {}
});
editorEl.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();generateBtn.click()}});
