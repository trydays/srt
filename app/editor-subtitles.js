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
var candidateRevision = null;
var candidateEditId = null;

function currentSubtitleState() {
  if (projectEditingState !== 'ready') return { segments: [], draft: null, edit: null, revision: null };
  var snapshot = projectEditing.load(getActiveProjectId());
  var edit = snapshot.document.edits.find(function(item) { return item.enabled && item.type === 'subtitle.track@1'; });
  var draft = null;
  try { draft = edit && subtitleDraftStore.get(getActiveProjectId(), edit.id); }
  catch (_) { subtitleDraftWarning = '字幕草稿读取失败；已应用字幕不受影响'; }
  if (draft && draft.baseRevision !== snapshot.document.revision) {
    // Keep the old sidecar on disk, but never rebase it onto a different applied version implicitly.
    draft = null;
    if (!subtitleDraftWarning) subtitleDraftWarning = '旧草稿版本已过期，当前显示已应用字幕';
  }
  return {
    segments: edit ? edit.payload.segments : [], edit: edit || null, revision: snapshot.document.revision,
    draft: draft ? draft.textById : null, draftRevision: draft ? draft.baseRevision : null
  };
}
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
  if (projectEditingState !== 'ready') { subtitlePreview.hidden = true; return; }
  var snapshot = projectEditing.load(getActiveProjectId());
  var active = editCapabilityRegistry.get('subtitle.generate@1').preview(snapshot.graph, videoEl.currentTime);
  subtitlePreview.hidden = !active.visible;
  subtitlePreview.textContent = active.text;
}
function resetCandidateFromState(state) {
  state = state || currentSubtitleState();
  candidateRevision = state.draft ? state.draftRevision : state.revision;
  candidateEditId = state.edit && state.edit.id;
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
  subtitleDocumentStatus.textContent = candidateStatusText(info) + (message || subtitleDraftWarning ? ' · ' + (message || subtitleDraftWarning) : '');
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
  updateDocumentStatus(error && (error.code === 'SUBTITLE_DOCUMENT_STALE' || error.code === 'EDIT_REVISION_CONFLICT') ? '当前字幕已更新，请重新载入' : '字幕草稿保存失败，请重试');
}
function candidateBaseState() {
  var state = currentSubtitleState();
  if (!state.edit || state.edit.id !== candidateEditId || state.revision !== candidateRevision) {
    throw SRTEditCapabilities.codedError('SUBTITLE_DOCUMENT_STALE');
  }
  return state;
}
function saveCandidate() {
  if (window.isExporting) return false;
  clearSegmentErrors();
  try {
    var state = candidateBaseState();
    subtitleDraftStore.save(getActiveProjectId(), state.edit.id, candidateRevision, candidateTextById(), state.segments);
    subtitleDraftWarning = '';
    resetCandidateFromState();
    renderSubtitleDocument();
    return true;
  } catch (error) { showDocumentError(error); return false; }
}
function applyCandidate() {
  if (window.isExporting) return false;
  clearSegmentErrors();
  try {
    var state = candidateBaseState();
    var texts = subtitleDraftStore.validateTexts(candidateTextById(), state.segments);
    var payload = Object.assign({}, state.edit.payload, {
      segments: state.segments.map(function(segment) { return Object.assign({}, segment, { text: texts[segment.id] }); })
    });
    projectEditing.replaceEdit({ projectId: getActiveProjectId(), expectedRevision: candidateRevision, editId: state.edit.id, payload: payload });
    // The applied commit already succeeded. A sidecar cleanup failure must not report an apply failure.
    try { subtitleDraftStore.clear(getActiveProjectId(), state.edit.id); subtitleDraftWarning = ''; }
    catch (_) { subtitleDraftWarning = '字幕已应用；旧草稿清理失败，请重新打开后检查'; }
    candidateTexts = texts;
    candidateRevision = projectEditing.load(getActiveProjectId()).document.revision;
    renderAllSubtitles();
    resetCandidateFromState(Object.assign({}, currentSubtitleState(), { draft: null }));
    renderSubtitleDocument();
    window.dispatchEvent(new CustomEvent('project-edit-state-changed'));
    return true;
  } catch (error) {
    if (error && error.code !== 'SUBTITLE_TEXT_REQUIRED' && error.code !== 'SUBTITLE_DOCUMENT_STALE' && error.code !== 'EDIT_REVISION_CONFLICT') updateDocumentStatus('字幕应用失败，请重试');
    else showDocumentError(error);
    return false;
  }
}
subtitleTrack.addEventListener('click', function(event) {
  var block = event.target.closest('[data-segment-id]'); if (!block) return;
  var segment = currentSubtitleState().segments.find(function(item) { return item.id === block.dataset.segmentId; });
  if (!segment) return;
  try { videoEl.currentTime = segment.start; } catch (_) {}
  renderCurrentSubtitle();
});
subtitleDocumentSurface.addEventListener('input', function(event) {
  if (window.isExporting) return;
  if (event.target.matches('[data-testid="subtitle-document-segment"]')) markCandidateChanged();
});
subtitleDocumentSurface.addEventListener('keydown', function(event) {
  if (window.isExporting) { event.preventDefault(); return; }
  var field = event.target.closest('[data-testid="subtitle-document-segment"]'); if (!field) return;
  if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); return; }
  if (event.key !== 'Tab') return;
  var fields = Array.prototype.slice.call(subtitleDocumentSurface.querySelectorAll('[data-testid="subtitle-document-segment"]'));
  var next = fields.indexOf(field) + (event.shiftKey ? -1 : 1);
  if (next >= 0 && next < fields.length) { event.preventDefault(); fields[next].focus(); }
});
subtitleDocumentSurface.addEventListener('paste', function(event) {
  if (window.isExporting) { event.preventDefault(); return; }
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
  afterProjectEdit: function(beforeDocument, afterDocument) {
    var before = beforeDocument.edits.find(function(item) { return item.enabled && item.type === 'subtitle.track@1'; });
    var after = afterDocument.edits.find(function(item) { return item.enabled && item.type === 'subtitle.track@1'; });
    if (!before || !after || JSON.stringify(before) !== JSON.stringify(after)) return;
    // Only carry a draft across the exact unchanged subtitle version we just committed from.
    try {
      var draft = subtitleDraftStore.get(getActiveProjectId(), after.id);
      if (draft && draft.baseRevision === beforeDocument.revision) {
        subtitleDraftStore.rebase(getActiveProjectId(), after.id, afterDocument.revision, after.payload.segments);
        subtitleDraftWarning = '';
      }
    } catch (_) { subtitleDraftWarning = '编辑已应用；字幕草稿版本同步失败，请重新保存'; }
    if (candidateEditId === after.id && candidateRevision === beforeDocument.revision) {
      candidateRevision = afterDocument.revision;
    }
    renderSubtitleDocument(); renderAllSubtitles();
  },
  afterUndo: function(result) {
    var edit = result.document.edits.find(function(item) { return item.enabled && item.type === 'subtitle.track@1'; });
    if (edit) {
      try { subtitleDraftStore.rebase(getActiveProjectId(), edit.id, result.document.revision, edit.payload.segments); }
      catch (_) { subtitleDraftWarning = '字幕已撤销；之前的草稿尚未恢复'; }
    }
    var state = currentSubtitleState();
    subtitleDocument.hidden = state.segments.length === 0;
    rebuildDocumentFromState(); renderAllSubtitles(); return state;
  },
  canUndo: function(requestId) {
    return projectEditingState === 'ready' && projectEditing.canUndo({ projectId: getActiveProjectId(), transactionId: requestId });
  },
  count: function() { return currentSubtitleState().segments.length; },
  render: function() { rebuildDocumentFromState(); renderAllSubtitles(); },
  openAfter: function(card) {
    if (card && card.parentNode) card.parentNode.insertBefore(subtitleDocument, card.nextSibling);
    subtitleDocument.hidden = currentSubtitleState().segments.length === 0;
    if (card || !candidateTexts) rebuildDocumentFromState();
    setDocumentExpanded(true);
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
  getAppliedSegments: function() {
    return currentSubtitleState().segments.map(function(segment) {
      return { id: segment.id, start: segment.start, end: segment.end, text: segment.text };
    });
  },
  confirmUndo: function() {
    if (!this.hasPendingChanges()) return true;
    return window.confirm('撤销本次编辑会丢弃当前字幕草稿，是否继续？');
  }
};
renderAllSubtitles();
projectEditingReady.then(function() {
  rebuildDocumentFromState(); renderAllSubtitles();
}).catch(function() {
  subtitleDocumentStatus.textContent = '项目数据未能载入，未修改已有字幕';
});
