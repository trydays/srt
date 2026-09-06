var subtitleStore = SRTSubtitleState.createSubtitleStore(localStorage, createLocalId);
var subtitleTrack = document.getElementById('subtitleTrack');
var subtitlePreview = document.getElementById('previewSubtitle');
var subtitleDocument = document.querySelector('[data-subtitle-document]');
var subtitleDocumentToggle = subtitleDocument.querySelector('[data-testid="subtitle-document-toggle"]');
var subtitleDocumentDraftMarker = subtitleDocument.querySelector('[data-testid="subtitle-document-draft-marker"]');
var subtitleDocumentStatus = subtitleDocument.querySelector('[data-testid="subtitle-document-status"]');
var subtitleDocumentSurface = subtitleDocument.querySelector('[data-testid="subtitle-document-surface"]');
var subtitleDocumentSave = subtitleDocument.querySelector('[data-testid="subtitle-document-save"]');
var subtitleDocumentApply = subtitleDocument.querySelector('[data-testid="subtitle-document-apply"]');
var subtitleDocumentExpanded = false;
var candidateTexts = null;

function currentSubtitleState() { return subtitleStore.get(getActiveProjectId()); }
function textMapForSegments(segments) {
  var texts = {};
  segments.forEach(function(segment) { texts[segment.id] = String(segment.text); });
  return texts;
}
function sameTexts(left, right, segments) {
  return !!left && !!right && segments.every(function(segment) {
    return String(left[segment.id]) === String(right[segment.id]);
  });
}
function formatSubtitleTime(seconds) {
  var total = Math.max(0, Math.floor(Number(seconds) || 0));
  return ('0' + Math.floor(total / 60)).slice(-2) + ':' + ('0' + total % 60).slice(-2);
}
function renderSubtitleTrack() {
  var state = currentSubtitleState();
  subtitleTrack.innerHTML = '';
  var duration = videoDuration || 1;
  state.segments.forEach(function(segment) {
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'subtitle-block';
    button.dataset.segmentId = segment.id; button.dataset.testid = 'subtitle-block';
    button.style.left = Math.max(0, segment.start / duration * 100) + '%';
    button.style.width = Math.max(0.8, (segment.end - segment.start) / duration * 100) + '%';
    button.textContent = segment.text;
    subtitleTrack.appendChild(button);
  });
}
function renderCurrentSubtitle() {
  var time = videoEl.currentTime;
  var active = currentSubtitleState().segments.find(function(segment) {
    return time >= segment.start && time < segment.end;
  });
  subtitlePreview.hidden = !active;
  subtitlePreview.textContent = active ? active.text : '';
}
function resetCandidateFromState(state) {
  state = state || currentSubtitleState();
  candidateTexts = textMapForSegments(state.segments);
  if (state.draft) state.segments.forEach(function(segment) {
    candidateTexts[segment.id] = state.draft[segment.id];
  });
}
function documentState() {
  if (!candidateTexts) resetCandidateFromState();
  var state = currentSubtitleState();
  var applied = textMapForSegments(state.segments);
  var saved = state.draft || applied;
  return { state: state, dirty: !sameTexts(candidateTexts, saved, state.segments), hasDraft: !!state.draft };
}
function candidateStatusText(info) {
  if (info.dirty) return '有未保存更改';
  if (info.hasDraft) return '草稿已保存 · 尚未应用';
  return '所有修改已应用';
}
function updateDocumentStatus(message) {
  var info = documentState();
  subtitleDocumentToggle.textContent = (subtitleDocumentExpanded ? '编辑全部字幕 · ' : '编辑字幕 · ') + info.state.segments.length + ' 段';
  subtitleDocumentDraftMarker.hidden = subtitleDocumentExpanded || (!info.dirty && !info.hasDraft);
  subtitleDocumentDraftMarker.textContent = info.dirty ? '有未保存更改' : '草稿未应用';
  subtitleDocumentStatus.textContent = candidateStatusText(info) + (message ? ' · ' + message : '');
  subtitleDocumentSave.disabled = !info.dirty;
  subtitleDocumentApply.disabled = !info.dirty && !info.hasDraft;
}
function clearSegmentErrors() {
  var errors = subtitleDocumentSurface.querySelectorAll('[data-segment-error]');
  for (var i = 0; i < errors.length; i++) errors[i].remove();
}
function renderSubtitleDocument() {
  var state = currentSubtitleState();
  if (!candidateTexts) resetCandidateFromState();
  subtitleDocumentSurface.innerHTML = '';
  state.segments.forEach(function(segment) {
    var row = document.createElement('div');
    row.className = 'subtitle-document__segment'; row.dataset.segmentId = segment.id;
    var time = document.createElement('span');
    time.className = 'subtitle-document__time'; time.dataset.testid = 'subtitle-document-time';
    time.textContent = formatSubtitleTime(segment.start);
    var text = document.createElement('div');
    text.className = 'subtitle-document__text'; text.contentEditable = 'true'; text.spellcheck = false; text.tabIndex = 0;
    text.dataset.segmentId = segment.id; text.dataset.testid = 'subtitle-document-segment';
    text.textContent = candidateTexts[segment.id] == null ? segment.text : candidateTexts[segment.id];
    row.appendChild(time); row.appendChild(text); subtitleDocumentSurface.appendChild(row);
  });
  updateDocumentStatus();
}
function rebuildDocumentFromState() { resetCandidateFromState(); renderSubtitleDocument(); }
function setDocumentExpanded(expanded) {
  subtitleDocumentExpanded = expanded;
  subtitleDocument.classList.toggle('is-collapsed', !expanded);
  subtitleDocumentSurface.hidden = !expanded;
  updateDocumentStatus();
}
function renderAllSubtitles() { renderSubtitleTrack(); renderCurrentSubtitle(); }
function candidateTextById() {
  var values = {};
  var fields = subtitleDocumentSurface.querySelectorAll('[data-testid="subtitle-document-segment"]');
  for (var i = 0; i < fields.length; i++) values[fields[i].dataset.segmentId] = fields[i].textContent.replace(/[\r\n]+/g, ' ');
  candidateTexts = values;
  return values;
}
function markCandidateChanged() {
  candidateTextById(); clearSegmentErrors(); updateDocumentStatus();
}
function showDocumentError(error) {
  if (error && error.code === 'SUBTITLE_TEXT_REQUIRED') {
    var fields = subtitleDocumentSurface.querySelectorAll('[data-testid="subtitle-document-segment"]');
    for (var i = 0; i < fields.length; i++) {
      if (String(fields[i].textContent).trim()) continue;
      var notice = document.createElement('div');
      notice.className = 'subtitle-document__error'; notice.dataset.segmentError = fields[i].dataset.segmentId;
      notice.textContent = '字幕文字不能为空'; fields[i].parentNode.appendChild(notice);
    }
    updateDocumentStatus('请补全空白字幕'); return;
  }
  updateDocumentStatus(error && error.code === 'SUBTITLE_DOCUMENT_STALE' ? '当前字幕已更新，请重新载入' : '字幕草稿保存失败，请重试');
}
function saveCandidate() {
  clearSegmentErrors();
  try {
    var state = subtitleStore.saveDraft(getActiveProjectId(), candidateTextById());
    resetCandidateFromState(state);
    renderSubtitleDocument();
    return true;
  } catch (error) { showDocumentError(error); return false; }
}
function applyCandidate() {
  clearSegmentErrors();
  try {
    subtitleStore.applyTexts(getActiveProjectId(), candidateTextById());
    renderAllSubtitles(); rebuildDocumentFromState(); return true;
  } catch (error) {
    if (error && error.code !== 'SUBTITLE_TEXT_REQUIRED' && error.code !== 'SUBTITLE_DOCUMENT_STALE') updateDocumentStatus('字幕应用失败，请重试');
    else showDocumentError(error);
    return false;
  }
}
subtitleTrack.addEventListener('click', function(event) {
  var block = event.target.closest('[data-segment-id]'); if (!block) return;
  var segment = currentSubtitleState().segments.find(function(item) { return item.id === block.dataset.segmentId; });
  if (!segment) return;
  try { videoEl.currentTime = segment.start; } catch (_) {}
  subtitlePreview.hidden = false; subtitlePreview.textContent = segment.text;
});
subtitleDocumentSurface.addEventListener('input', function(event) {
  if (event.target.matches('[data-testid="subtitle-document-segment"]')) markCandidateChanged();
});
subtitleDocumentSurface.addEventListener('keydown', function(event) {
  var field = event.target.closest('[data-testid="subtitle-document-segment"]'); if (!field) return;
  if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); return; }
  if (event.key !== 'Tab') return;
  var fields = Array.prototype.slice.call(subtitleDocumentSurface.querySelectorAll('[data-testid="subtitle-document-segment"]'));
  var next = fields.indexOf(field) + (event.shiftKey ? -1 : 1);
  if (next >= 0 && next < fields.length) { event.preventDefault(); fields[next].focus(); }
});
subtitleDocumentSurface.addEventListener('paste', function(event) {
  var field = event.target.closest('[data-testid="subtitle-document-segment"]'); if (!field) return;
  event.preventDefault();
  var text = (event.clipboardData && event.clipboardData.getData('text') || '').replace(/[\r\n]+/g, ' ');
  var selection = window.getSelection();
  var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  var textNode = document.createTextNode(text);
  if (range && field.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  } else field.appendChild(textNode);
  markCandidateChanged();
});
subtitleDocumentToggle.addEventListener('click', function() { setDocumentExpanded(!subtitleDocumentExpanded); });
subtitleDocumentSave.addEventListener('click', saveCandidate);
subtitleDocumentApply.addEventListener('click', applyCandidate);
videoEl.addEventListener('timeupdate', renderCurrentSubtitle);
videoEl.addEventListener('loadedmetadata', renderAllSubtitles);
window.subtitleController = {
  replace: function(requestId, segments) {
    var state = subtitleStore.replace(getActiveProjectId(), requestId, segments);
    rebuildDocumentFromState(); renderAllSubtitles(); return state;
  },
  undo: function(requestId) {
    var state = subtitleStore.undo(getActiveProjectId(), requestId);
    subtitleDocument.hidden = state.segments.length === 0;
    rebuildDocumentFromState(); renderAllSubtitles(); return state;
  },
  canUndo: function(requestId) { return subtitleStore.canUndo(getActiveProjectId(), requestId); },
  count: function() { return currentSubtitleState().segments.length; },
  render: function() { rebuildDocumentFromState(); renderAllSubtitles(); },
  openAfter: function(card) {
    if (card && card.parentNode) card.parentNode.insertBefore(subtitleDocument, card.nextSibling);
    subtitleDocument.hidden = currentSubtitleState().segments.length === 0;
    rebuildDocumentFromState(); setDocumentExpanded(true);
  },
  restoreAfter: function(card) {
    if (card && card.parentNode) card.parentNode.insertBefore(subtitleDocument, card.nextSibling);
    subtitleDocument.hidden = currentSubtitleState().segments.length === 0;
    rebuildDocumentFromState(); setDocumentExpanded(false);
  },
  prepareForNextRequest: function() {
    if (documentState().dirty && !saveCandidate()) return false;
    setDocumentExpanded(false); return true;
  },
  hasPendingChanges: function() {
    var info = documentState(); return info.dirty || info.hasDraft;
  },
  confirmUndo: function() {
    if (!this.hasPendingChanges()) return true;
    return window.confirm('撤销本次字幕会丢弃当前草稿，是否继续？');
  }
};
renderAllSubtitles();
