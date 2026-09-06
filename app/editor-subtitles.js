var subtitleStore = SRTSubtitleState.createSubtitleStore(localStorage, createLocalId);
var subtitleTrack = document.getElementById('subtitleTrack');
var subtitlePreview = document.getElementById('previewSubtitle');
var subtitleEditor = document.getElementById('subtitleEditor');
var subtitleTextInput = document.getElementById('subtitleTextInput');
var subtitleTextSave = document.getElementById('subtitleTextSave');
var selectedSubtitleId = null;

function currentSubtitleState() {
  return subtitleStore.get(getActiveProjectId());
}

function renderSubtitleTrack() {
  var state = currentSubtitleState();
  subtitleTrack.innerHTML = '';
  var duration = videoDuration || 1;
  state.segments.forEach(function(segment) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'subtitle-block';
    button.dataset.segmentId = segment.id;
    button.dataset.testid = 'subtitle-block';
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

function renderSubtitleEditor() {
  var segment = currentSubtitleState().segments.find(function(item) {
    return item.id === selectedSubtitleId;
  });
  subtitleEditor.hidden = !segment;
  subtitleTextInput.value = segment ? segment.text : '';
}

function renderAllSubtitles() {
  renderSubtitleTrack();
  renderCurrentSubtitle();
  renderSubtitleEditor();
}

subtitleTrack.addEventListener('click', function(event) {
  var block = event.target.closest('[data-segment-id]');
  if (!block) return;
  selectedSubtitleId = block.dataset.segmentId;
  var segment = currentSubtitleState().segments.find(function(item) {
    return item.id === selectedSubtitleId;
  });
  if (segment) {
    try { videoEl.currentTime = segment.start; } catch (_) {}
    subtitlePreview.hidden = false;
    subtitlePreview.textContent = segment.text;
  }
  renderSubtitleEditor();
});

function saveSelectedSubtitle() {
  if (!selectedSubtitleId) return false;
  subtitleStore.updateText(getActiveProjectId(), selectedSubtitleId, subtitleTextInput.value);
  renderAllSubtitles();
  return true;
}

subtitleTextSave.addEventListener('click', saveSelectedSubtitle);
subtitleTextInput.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') { event.preventDefault(); saveSelectedSubtitle(); }
});
videoEl.addEventListener('timeupdate', renderCurrentSubtitle);
videoEl.addEventListener('loadedmetadata', renderAllSubtitles);

window.subtitleController = {
  replace: function(requestId, segments) {
    var state = subtitleStore.replace(getActiveProjectId(), requestId, segments);
    selectedSubtitleId = null;
    renderAllSubtitles();
    return state;
  },
  undo: function(requestId) {
    var state = subtitleStore.undo(getActiveProjectId(), requestId);
    selectedSubtitleId = null;
    renderAllSubtitles();
    return state;
  },
  canUndo: function(requestId) {
    return subtitleStore.canUndo(getActiveProjectId(), requestId);
  },
  count: function() { return currentSubtitleState().segments.length; },
  render: renderAllSubtitles
};

renderAllSubtitles();
