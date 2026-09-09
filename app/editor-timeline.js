/* === editor-timeline.js — 三天remotion 时间轴 + 聊天 === */

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
function seekVideo(pct){if(videoDuration)editorPlayback.seekSeconds(pct*videoDuration);renderPlayhead(pct)}
/* Update playhead from video */
editorPlayback.subscribe(function(state){if(!dragging&&videoDuration)renderPlayhead(state.currentTime/videoDuration)});

track.addEventListener('mousedown',function(e){dragging=true;seekVideo(posToPct(e.clientX));e.preventDefault()});
document.addEventListener('mousemove',function(e){if(!dragging)return;seekVideo(posToPct(e.clientX))});
document.addEventListener('mouseup',function(){dragging=false});

/* 时间轴由已提交文档投影，拖入组件不产生编辑。 */
var projectStateReady = false;
function createMarkerDOM(item) {
  var pad=16, w=trackWidth()-pad*2;
  var left = pad + (item.range.start / getDur()) * w;
  var m = document.createElement('span');
  m.className = 'tl-marker';
  m.style.left = left+'px';
  m.style.width = ((item.range.end - item.range.start) / getDur()) * w + 'px';
  m.style.background = 'var(--accent-tint)';
  m.style.color = 'var(--text-strong)';
  m.style.border = '1px solid var(--accent)';
  m.textContent = item.label + ' · ' + item.summary;
  m.title = item.label + ' @ ' + formatDur(item.range.start) + '–' + formatDur(item.range.end);
  m.dataset.editId = item.editId;
  m.dataset.transactionId = item.transactionId;
  m.dataset.lane = item.lane;
  if (item.editIds) m.dataset.editIds = item.editIds.join(',');
  return m;
}

function aggregateVisualTimelineItems(items) {
  var visual = {};
  items.forEach(function(item) {
    if (item.lane !== 'visual') return;
    var aggregateKey = item.transactionId + ':' + item.editId;
    var aggregate = visual[aggregateKey];
    if (!aggregate) aggregate = visual[aggregateKey] = { editId: item.editId,
      editIds: [], transactionId: item.transactionId, lane: 'visual', range: { start: item.range.start, end: item.range.end },
      label: '静态图层', summary: '', elementCount: 0 };
    aggregate.editIds.push(item.editId);
    aggregate.range.start = Math.min(aggregate.range.start, item.range.start);
    aggregate.range.end = Math.max(aggregate.range.end, item.range.end);
    aggregate.elementCount += Number.isInteger(item.elementCount) && item.elementCount > 0 ? item.elementCount : 1;
    if (item.animated) aggregate.label = '动画图层';
    aggregate.summary = aggregate.elementCount + ' 个元素';
  });
  var emitted = {};
  return items.reduce(function(result, item) {
    if (item.lane !== 'visual') { result.push(item); return result; }
    var aggregateKey = item.transactionId + ':' + item.editId;
    if (!emitted[aggregateKey]) { result.push(visual[aggregateKey]); emitted[aggregateKey] = true; }
    return result;
  }, []);
}

async function currentProjectContext(projectId) {
  var context = window.projectEditing.aiContext(projectId);
  context.playheadSeconds = editorPlayback.getState().currentTime;
  if (window.projectAssetsController) {
    try {
      await window.projectAssetsController.ready;
      context.assets = window.projectAssetsController.list();
      var selected = window.projectAssetsController.selected && window.projectAssetsController.selected();
      if (selected && typeof selected.assetId === 'string') context.selectedAssetId = selected.assetId;
    } catch (_) { context.assets = []; }
  }
  return context;
}

/* 全量重建（ResizeObserver 用 — 宽度变化后位置需重算） */
function renderMarkers(){
  var old = track.querySelectorAll('.tl-marker'); for(var i=0;i<old.length;i++)old[i].remove();
  if (!projectStateReady) return;
  var items = aggregateVisualTimelineItems(window.projectEditing.timelineItems(activeProjectId));
  track.style.height = Math.max(80, 28 + items.length * 26) + 'px';
  items.forEach(function(item, index) {
    var marker = createMarkerDOM(item);
    marker.style.top = (28 + index * 26) + 'px';
    track.appendChild(marker);
  });
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
  addMsg('ai', '「' + name + '」尚未接通。当前可通过对话生成整段视频字幕。');
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
var pendingClarifyRecord = null;
var pendingClarifyCard = null;
var requestTranscriptCache = new WeakMap();
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
  clarifying: { label: '待补充', icon: '？' },
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
  if (!record.text) return '已恢复的编辑记录';
  if (record.instructionStatus === 'clarifying') {
    return '等待补充信息';
  }
  if (record.instructionStatus === 'converting'
      || record.timelineStatus === 'applying' || record.timelineStatus === 'generating') {
    return '正在处理这次编辑';
  }
  if (record.instructionStatus === 'failed' || record.timelineStatus === 'failed') {
    return '这次编辑未完成';
  }
  if (record.subtitleRequest === true && record.resultItemCount === 1 && record.timelineStatus === 'success') {
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
  if (record.resultSummary && !(record.subtitleRequest && record.resultItemCount === 1)) {
    return '✓ ' + (record.text ? '这次编辑已完成' : '已恢复的编辑记录') + ' · ' + record.resultSummary
      + (record.text ? ' · ' + formatRequestTime(record.submittedAt) : '');
  }
  if (!record.text) return '✓ 已恢复的编辑记录 · 字幕 ' + Number(record.resultCount || 0) + ' 条';
  var time = formatRequestTime(record.submittedAt);
  if (record.subtitleRequest === true) {
    return '✓ 字幕已生成 · ' + Number(record.resultCount || 0) + ' 条 · ' + time;
  }
  return '✓ 这次编辑已完成 · ' + time;
}
function renderRequestStatusCard(card, record) {
  var isSubtitle = record.subtitleRequest === true;
  var isCollapsed = isSuccessfulRequest(record) && card.dataset.detailsExpanded !== 'true';
  var secondLabel = record.transcriptPreparing ? '读取语音／提炼要点' : isSubtitle ? '生成字幕'
    : (record.subtitleRequest === null ? '执行编辑' : '应用到时间轴');
  var secondTestId = isSubtitle ? 'subtitle-status' : 'timeline-status';
  var clarify = record.clarifyMessage
    ? '<div class="request-clarify" data-testid="request-clarify">'
      + escapeConversationText(record.clarifyMessage) + '</div>' : '';
  var error = record.error
    ? '<div class="request-error">' + escapeConversationText(record.error) + '</div>' : '';
  var canUndo = projectStateReady && window.projectEditing
    && window.projectEditing.canUndo({ projectId: activeProjectId, transactionId: record.transactionId || record.id });
  var undo = canUndo
    ? '<button type="button" class="request-undo" data-undo-request="'
      + escapeConversationText(record.id)
      + '" data-testid="subtitle-undo"' + (window.isExporting ? ' disabled' : '')
      + '>撤销本次编辑</button>' : '';
  var saveAsSkill = window.personalSkillController && window.personalSkillController.canSave(record)
    ? '<button type="button" class="save-as-skill" data-testid="save-as-skill">保存为技能</button>' : '';
  var summary = isSuccessfulRequest(record)
    ? '<button type="button" class="request-status-summary" data-request-details-toggle'
      + ' data-testid="request-status-summary">' + escapeConversationText(requestCardSummary(record)) + '</button>' : '';
  card.classList.toggle('is-collapsed', isCollapsed);
  card.innerHTML = summary + '<div class="request-status-details" data-testid="request-status-details"'
    + (isCollapsed ? ' hidden' : '') + '><div class="request-status-head"><span>' + requestCardTitle(record)
    + '</span><span class="request-status-time">' + (record.text ? formatRequestTime(record.submittedAt) : '')
    + '</span></div>' + statusRowHTML('instruction-status', record.awaitingMetadata ? '正在读取视频信息' : '转换编辑指令', record.instructionStatus)
    + statusRowHTML(secondTestId, secondLabel, record.timelineStatus)
    + (isSubtitle && record.timelineStatus === 'success'
      ? '<div class="request-result">已生成 ' + Number(record.resultCount || 0) + ' 条字幕</div>' : '')
    + clarify + error + undo + saveAsSkill + '</div>'
    + (record.historyWarning ? '<div class="request-error">' + escapeConversationText(record.historyWarning) + '</div>' : '');
}
function appendRequestStatusCard(record) {
  if (chatEmpty) chatEmpty.style.display = 'none';
  if (record.text) {
    var message = document.createElement('div');
    message.className = 'request-user-message';
    message.dataset.testid = 'request-user-message';
    message.textContent = record.text;
    chatArea.appendChild(message);
  }
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
function appendFollowupMessage(card, text) {
  var message = document.createElement('div');
  message.className = 'request-user-message';
  message.dataset.testid = 'request-user-message';
  message.textContent = text;
  chatArea.insertBefore(message, card);
  chatArea.scrollTop = chatArea.scrollHeight;
}
function createConversationRequest(text) {
  var record = { id: createLocalId(), text: text, submittedAt: Date.now(),
    instructionStatus: 'converting', timelineStatus: 'waiting', subtitleRequest: null,
    turns: [{ role: 'user', text: text }], clarifyMessage: '' };
  var selected = window.personalSkillController && window.personalSkillController.captureSelection();
  if (selected) record.skillContext = selected;
  return record;
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
    requestTranscriptCache.delete(record);
    var isNewRecord = conversationRecords.indexOf(record) === -1;
    var nextConversationRecords = isNewRecord
      ? conversationRecords.concat([record]) : conversationRecords;
    try {
      saveProjectConversation(activeProjectId, nextConversationRecords);
    } catch (error) {
      record.historyWarning = '编辑结果已保留，但对话历史暂时未保存。';
      if (isNewRecord) conversationRecords.push(record);
      renderRequestStatusCard(card, record);
      return;
    }
    if (isNewRecord) conversationRecords.push(record);
  }
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

function projectErrorMessage(error) {
  var code = error && error.code;
  if (code === 'EDIT_REVISION_CONFLICT') return '项目已变化，请重新提交这次编辑。';
  if (code === 'EDIT_PROJECT_NOT_READY' || code === 'EDIT_INVALID_MEDIA' || code === 'RECIPE_INVALID_MEDIA' || code === 'VIDEO_METADATA_UNAVAILABLE') return '视频信息尚未准备好，请重新导入视频后重试。';
  if (code === 'EDIT_STORAGE_CORRUPT') return '项目保存的数据无法读取，请先保留现有数据再检查。';
  if (code === 'PROJECT_ASSET_UNKNOWN') return '这张素材卡片引用的素材已不在当前项目中，请重新导入素材并重新生成卡片。';
  if (code === 'PROJECT_ASSET_MISSING') return '素材文件已移动或不可读取，请恢复到原位置，或重新导入素材并重新生成卡片。';
  if (code === 'PROJECT_ASSET_VIDEO_TOO_SHORT') return '素材视频长度不足，请缩短卡片显示时间或选择更长的视频。';
  if (code === 'PROJECT_ASSET_KIND_MISMATCH') return '素材类型与卡片不匹配，请选择正确的图片或视频后重新生成。';
  if (code === 'PROJECT_ASSET_RUNTIME_NOT_READY') return '素材卡片运行环境尚未准备好，请稍后重试。';
  if (code && code.indexOf('RECIPE_') === 0) return '当前能力尚未接通此编辑，请试试「生成整段视频字幕」。';
  if (code === 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT') return instructionErrorMessage(code);
  if (code && (code.indexOf('SUBTITLE_') === 0 || code === 'VIDEO_PATH_UNAVAILABLE')) return subtitleErrorMessage(code);
  if (error && (error.name === 'QuotaExceededError' || error.name === 'SecurityError')) return '项目暂时无法保存，请检查可用存储后重试。';
  return '这次编辑未完成，请重试。';
}
function refreshRequestCards() {
  conversationRecords.forEach(function(record) {
    var card = Array.from(chatArea.querySelectorAll('[data-request-id]')).find(function(element) { return element.dataset.requestId === record.id; });
    if (card) renderRequestStatusCard(card, record);
  });
}

function transactionResult(document, transactionId) {
  var edits = document.edits.filter(function(edit) { return edit.enabled && edit.transactionId === transactionId; });
  var subtitle = edits.find(function(edit) { return edit.type === 'subtitle.track@1'; });
  var items = aggregateVisualTimelineItems(window.projectEditing.timelineItems(activeProjectId)).filter(function(item) { return item.transactionId === transactionId; });
  return { subtitleRequest: !!subtitle, resultCount: subtitle ? subtitle.payload.segments.length : 0,
    resultItemCount: items.length, resultSummary: items.map(function(item) { return item.label + ' · ' + item.summary; }).join('；') };
}

function reconcileTransactionRecords(document) {
  conversationRecords.forEach(function(record) {
    var applied = document.edits.find(function(edit) { return edit.enabled && edit.transactionId === (record.transactionId || record.id); });
    if (!applied) return;
    record.transactionId = applied.transactionId;
    record.instructionStatus = 'success'; record.timelineStatus = 'success';
    Object.assign(record, transactionResult(document, applied.transactionId));
    record.error = ''; record.clarifyMessage = ''; record.subtitleUndone = false;
  });
}

async function translateAndApply(text, record, card) {
  record.awaitingMetadata = !projectStateReady || window.projectVideoLoading;
  renderRequestStatusCard(card, record);
  await window.projectEditingReady;
  await window.currentProjectVideoReady;
  record.awaitingMetadata = false;
  renderRequestStatusCard(card, record);
  if (window.projectEditingError) throw window.projectEditingError;
  var frozenProjectId = activeProjectId;
  var loaded = window.projectEditing.load(frozenProjectId);
  var frozenRevision = loaded.document.revision;
  var frozenAssetId = loaded.document.sources[0].assetId;
  var frozenVideoPath = window.currentProjectVideoPath;
  var frozenSkill = record.skillContext;
  var context = await currentProjectContext(frozenProjectId);
  if (activeProjectId !== frozenProjectId || window.currentProjectVideoPath !== frozenVideoPath
      || window.projectEditing.load(frozenProjectId).document.revision !== frozenRevision) {
    throw Object.assign(new Error('Project changed'), { code: 'EDIT_REVISION_CONFLICT' });
  }
  var duration = loaded.document.timeline.duration;
  var appliedSegments = window.subtitleController ? window.subtitleController.getAppliedSegments() : [];
  var continuedTranscriptRange = null;
  if (appliedSegments.length && window.SRTTranscriptContext) {
    try {
      context.transcript = window.SRTTranscriptContext.selectTranscript({ segments: appliedSegments,
        source: 'applied-subtitles', range: { start: 0, end: duration }, maxChars: 24000 });
    } catch (error) {
      if (!error || error.code !== 'TRANSCRIPT_TOO_LARGE') throw error;
    }
  }
  if (!context.transcript) {
    var cachedTranscript = requestTranscriptCache.get(record);
    if (cachedTranscript && cachedTranscript.projectId === frozenProjectId
        && cachedTranscript.assetId === frozenAssetId && cachedTranscript.videoPath === frozenVideoPath) {
      context.transcript = cachedTranscript.transcript;
      continuedTranscriptRange = context.transcript.range;
    }
  }
  var translated = await window.srtAPI.translateInstruction(text, record.turns, context, frozenSkill);
  if (!translated.ok) {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed', timelineStatus: 'not_run',
      error: instructionErrorMessage(translated.errorCode)
    });
    return;
  }
  var turn = translated.instruction;
  if (!turn) {
    updateRequestStatus(record, card, {
      instructionStatus: 'failed', timelineStatus: 'not_run',
      error: '当前能力尚未接通此编辑，请试试「生成整段视频字幕」。'
    });
    return;
  }
  var preparedTranscriptRange = continuedTranscriptRange;
  if (turn.kind === 'prepare') {
    if (record.transcriptPrepareUsed) {
      updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
        error: '本次请求已经读取过一次语音，不能重复准备。' });
      return;
    }
    if (context.transcript) {
      updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
        error: '已有完整语音原文，但模型仍重复请求读取，未执行任何编辑。' });
      return;
    }
    if (turn.range.start < 0 || turn.range.end > duration || turn.range.end <= turn.range.start) {
      updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
        error: '请求的语音范围超出当前视频，请缩小范围后重试。' });
      return;
    }
    record.transcriptPrepareUsed = true;
    record.transcriptPreparing = true;
    record.timelineStatus = 'generating';
    renderRequestStatusCard(card, record);
    var source = appliedSegments;
    var sourceKind = 'applied-subtitles';
    if (!source.length) {
      var recognized = await window.srtAPI.generateSubtitles({ videoPath: frozenVideoPath });
      if (!recognized || recognized.ok !== true || !Array.isArray(recognized.segments)) {
        updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
          error: subtitleErrorMessage(recognized && recognized.errorCode) });
        return;
      }
      source = recognized.segments;
      sourceKind = 'speech-recognition';
    }
    try {
      context.transcript = window.SRTTranscriptContext.selectTranscript({ segments: source,
        source: sourceKind, range: turn.range, maxChars: 24000 });
      preparedTranscriptRange = context.transcript.range;
      requestTranscriptCache.set(record, { projectId: frozenProjectId, assetId: frozenAssetId,
        videoPath: frozenVideoPath, transcript: context.transcript });
    } catch (error) {
      updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
        error: error && error.code === 'TRANSCRIPT_TOO_LARGE'
          ? '所选语音原文超过分析上限，请缩小时间范围。' : '语音原文无法读取，请重试。' });
      return;
    }
    if (activeProjectId !== frozenProjectId || window.currentProjectVideoPath !== frozenVideoPath
        || window.projectEditing.load(frozenProjectId).document.revision !== frozenRevision
        || window.projectEditing.load(frozenProjectId).document.sources[0].assetId !== frozenAssetId) {
      throw Object.assign(new Error('Project changed'), { code: 'EDIT_REVISION_CONFLICT' });
    }
    record.transcriptPreparing = false;
    renderRequestStatusCard(card, record);
    translated = await window.srtAPI.translateInstruction(text, record.turns, context, frozenSkill);
    if (!translated.ok || !translated.instruction || translated.instruction.kind === 'prepare') {
      updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
        error: translated.ok ? '语音准备后仍未得到可执行结果，请重试。' : instructionErrorMessage(translated.errorCode) });
      return;
    }
    turn = translated.instruction;
  }
  if (preparedTranscriptRange) {
    var keypointSteps = turn.kind === 'instruction' && Array.isArray(turn.steps)
      ? turn.steps.filter(function(step) { return step.capability === 'visual.group@1'; }) : [];
    var invalidKeypointResult = turn.kind === 'instruction' && (keypointSteps.length === 0
      || keypointSteps.some(function(step) {
        return !step.range || step.range.start < preparedTranscriptRange.start
          || step.range.end > preparedTranscriptRange.end;
      }));
    if (invalidKeypointResult) {
      updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
        error: '语音提炼未返回所选时段内的重点文字，未执行任何编辑。' });
      return;
    }
  }
  if (turn.kind === 'clarify') {
    record.turns.push({ role: 'assistant', text: turn.message });
    record.clarifyMessage = turn.message;
    updateRequestStatus(record, card, {
      instructionStatus: 'clarifying', timelineStatus: 'waiting', error: ''
    });
    pendingClarifyRecord = record;
    pendingClarifyCard = card;
    return;
  }
  window.editCapabilityRegistry.validateRecipe(turn);
  record.subtitleRequest = turn.steps.some(function(step) { return step.capability === 'subtitle.generate@1'; });
  record.clarifyMessage = '';
  updateRequestStatus(record, card, {
    instructionStatus: 'success', timelineStatus: record.subtitleRequest ? 'generating' : 'applying', error: ''
  });
  if (activeProjectId !== frozenProjectId || window.currentProjectVideoPath !== frozenVideoPath) {
    throw Object.assign(new Error('Project changed'), { code: 'EDIT_REVISION_CONFLICT' });
  }
  var applied = await window.projectEditing.applyRecipe({ projectId: frozenProjectId,
    expectedRevision: frozenRevision, requestId: record.id, recipe: turn });
  record.transactionId = applied.transactionId;
  record.timelineStatus = 'success';
  updateRequestStatus(record, card, Object.assign({ timelineStatus: 'success', error: '' },
    transactionResult(applied.document, applied.transactionId)));
  if (window.subtitleController) {
    if (record.subtitleRequest) {
      subtitleController.render(); subtitleController.openAfter(card);
    } else subtitleController.afterProjectEdit(loaded.document, applied.document);
  }
  window.dispatchEvent(new CustomEvent('project-edit-state-changed'));
  refreshRequestCards();
}

/* ── generateBtn click handler ── */
function hydrateConversationHistory() {
  for (var i = 0; i < conversationRecords.length; i++) {
    appendRequestStatusCard(conversationRecords[i]);
  }
  var latestSubtitleCard = latestValidSubtitleCard();
  if (projectStateReady && latestSubtitleCard && window.subtitleController) subtitleController.restoreAfter(latestSubtitleCard);
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
window.addEventListener('project-edit-state-changed', function() {
  if (!projectStateReady) return;
  renderMarkers(); refreshRequestCards();
});
window.projectEditingReady.then(function() {
  projectStateReady = true;
  var document = window.projectEditing.load(activeProjectId).document;
  reconcileTransactionRecords(document);
  document.edits.forEach(function(edit) {
    var hasRecord = conversationRecords.some(function(record) { return (record.transactionId || record.id) === edit.transactionId; });
    if (hasRecord || !window.projectEditing.canUndo({ projectId: activeProjectId, transactionId: edit.transactionId })) return;
    var recovered = Object.assign({ id: edit.transactionId, transactionId: edit.transactionId, text: '', submittedAt: 0,
      instructionStatus: 'success', timelineStatus: 'success' }, transactionResult(document, edit.transactionId));
    conversationRecords.push(recovered); appendRequestStatusCard(recovered);
  });
  renderMarkers(); refreshRequestCards();
  var card = latestValidSubtitleCard();
  if (card && window.subtitleController) subtitleController.restoreAfter(card);
}).catch(function(error) { addMsg('ai', projectErrorMessage(error)); });

generateBtn.addEventListener('click', async function() {
  var text = editorEl.textContent.trim();
  if (!text || generateBtn.disabled) return;
  var isClarifyFollowup = Boolean(pendingClarifyRecord && pendingClarifyCard);
  if (window.subtitleController && !await subtitleController.prepareForNextRequest()) {
    setSubmitState();
    return;
  }
  editorEl.textContent = '';
  setSubmitState();

  var record, card;
  if (isClarifyFollowup) {
    record = pendingClarifyRecord;
    card = pendingClarifyCard;
    pendingClarifyRecord = null;
    pendingClarifyCard = null;
    record.turns.push({ role: 'user', text: text });
    record.clarifyMessage = '';
    record.instructionStatus = 'converting';
    renderRequestStatusCard(card, record);
    appendFollowupMessage(card, text);
  } else {
    record = createConversationRequest(text);
    card = appendRequestStatusCard(record);
  }
  requestInFlight = true;
  setSubmitState();
  if (window.personalSkillController) window.personalSkillController.refresh();
  try {
    await translateAndApply(text, record, card);
  } catch (error) {
    if (record.timelineStatus === 'success' && record.transactionId) {
      record.historyWarning = '编辑已保存，但显示未能更新，请刷新页面。';
      renderRequestStatusCard(card, record);
      return;
    }
    updateRequestStatus(record, card, {
      instructionStatus: record.instructionStatus === 'success' ? 'success' : 'failed',
      timelineStatus: record.instructionStatus === 'success' ? 'failed' : 'not_run',
      error: projectErrorMessage(error)
    });
  } finally {
    requestInFlight = false;
    setSubmitState();
    if (window.personalSkillController) window.personalSkillController.afterRequest(record);
  }
});
chatArea.addEventListener('click', function(event) {
  var saveButton = event.target.closest('[data-testid="save-as-skill"]');
  if (saveButton) {
    var saveCard = saveButton.closest('[data-request-id]');
    var saveRecord = conversationRecords.find(function(record) { return record.id === saveCard.dataset.requestId; });
    if (saveRecord && window.personalSkillController) window.personalSkillController.openSave(saveRecord);
    return;
  }
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
  if (window.isExporting) return;
  var requestId = button.dataset.undoRequest;
  var requestCard = button.closest('[data-request-id]');
  try {
    if (!subtitleController.confirmUndo()) return;
    var undoneRecord = conversationRecords.find(function(record) { return record.id === requestId; });
    var loaded = window.projectEditing.load(activeProjectId);
    var undone = window.projectEditing.undo({ projectId: activeProjectId, expectedRevision: loaded.document.revision,
      transactionId: undoneRecord.transactionId || undoneRecord.id });
    subtitleController.afterUndo(undone);
    reconcileTransactionRecords(undone.document);
    updateRequestStatus(undoneRecord, requestCard, { subtitleUndone: true });
    window.dispatchEvent(new CustomEvent('project-edit-state-changed'));
    if (subtitleController.count()) {
      var latestSubtitleCard = latestValidSubtitleCard();
      if (latestSubtitleCard) subtitleController.openAfter(latestSubtitleCard);
    }
  } catch (error) { addMsg('ai', projectErrorMessage(error)); }
});
editorEl.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();generateBtn.click()}});

window.timelineController = {
  isRequestInFlight: function() { return requestInFlight; },
  hasPendingClarify: function() { return Boolean(pendingClarifyRecord && pendingClarifyCard); },
  exitPendingClarify: function() {
    if (!pendingClarifyRecord || !pendingClarifyCard || requestInFlight) return false;
    var record = pendingClarifyRecord, card = pendingClarifyCard;
    pendingClarifyRecord = null; pendingClarifyCard = null;
    updateRequestStatus(record, card, { instructionStatus: 'failed', timelineStatus: 'not_run',
      clarifyMessage: '', error: '已退出本次补充，可开始新的请求。' });
    if (window.personalSkillController) window.personalSkillController.afterRequest(record);
    return true;
  },
  getUnsupportedExportItems: function() {
    return [];
  }
};
