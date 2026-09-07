/* Composition root: one applied document, separate unapplied text drafts. */
var editCapabilityRegistry = SRTEditCapabilities.createCapabilityRegistry();
var subtitleDraftStore = SRTSubtitleDraftState.createSubtitleDraftStore(localStorage);
var projectEditing = SRTProjectEditing.createProjectEditing({
  storage: localStorage,
  storageKey: STORAGE_KEYS.PROJECT_EDIT_STATE,
  idFactory: createLocalId,
  capabilityRegistry: editCapabilityRegistry,
  graphCompiler: SRTRenderGraph.createRenderGraphCompiler({ capabilityRegistry: editCapabilityRegistry }),
  executionContext: function() {
    return {
      videoPath: window.currentProjectVideoPath,
      generateSubtitles: function(request) { return window.srtAPI.generateSubtitles(request); }
    };
  }
});
var projectEditingError = null;
var projectEditingState = 'loading';
var subtitleDraftWarning = '';
var projectEditingReady = new Promise(function(resolve, reject) {
  var projectId = getActiveProjectId();
  function legacyState() {
    var raw = localStorage.getItem(STORAGE_KEYS.PROJECT_SUBTITLES);
    if (!raw) return null;
    try {
      var all = JSON.parse(raw);
      return all && Object.prototype.hasOwnProperty.call(all, projectId) ? all[projectId] : null;
    } catch (_) { throw SRTEditCapabilities.codedError('EDIT_STORAGE_CORRUPT'); }
  }
  function migrateDrafts(snapshot) {
    try {
      var legacy = legacyState();
      if (!legacy) return;
      var edit = snapshot.document.edits.find(function(item) { return item.enabled && item.type === 'subtitle.track@1'; });
      if (edit && snapshot.document.revision === 0 && edit.id === 'legacy-subtitles-' + (legacy.segments[0] || {}).id) {
        subtitleDraftStore.migrate(projectId, edit.id, 0, legacy.draft, edit.payload.segments);
      }
      var undo = legacy.undo;
      if (snapshot.document.revision === 0 && undo && undo.segments && undo.segments.length) {
        subtitleDraftStore.migrate(projectId, 'legacy-subtitles-' + undo.segments[0].id, 0, undo.draft, undo.segments);
      }
    } catch (_) { subtitleDraftWarning = '字幕已载入，旧草稿尚未恢复；请重新打开项目重试'; }
  }
  function ready(snapshot) {
    if (projectEditingState !== 'loading') return;
    migrateDrafts(snapshot);
    videoDuration = snapshot.document.timeline.duration;
    document.getElementById('tlTotal').textContent = formatDur(videoDuration);
    projectEditingState = 'ready';
    resolve(snapshot);
  }
  function failed(error) {
    projectEditingError = error;
    projectEditingState = 'error';
    reject(error);
  }
  function initializeFromMedia() {
    if (projectEditingState !== 'loading') return;
    if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0 || !videoEl.videoWidth || !videoEl.videoHeight) return;
    try {
      ready(projectEditing.initializeProject({
        projectId: projectId,
        mediaFacts: {
          duration: videoEl.duration,
          canvas: { width: videoEl.videoWidth, height: videoEl.videoHeight },
          source: { id: 'main-video', assetId: projectId }
        },
        legacySubtitleState: legacyState()
      }));
    } catch (error) { failed(error); }
  }
  try { ready(projectEditing.load(projectId)); }
  catch (error) {
    if (error.code !== 'EDIT_PROJECT_NOT_READY') { failed(error); return; }
    videoEl.addEventListener('loadedmetadata', initializeFromMedia);
    initializeFromMedia();
  }
});
// Consumers surface the failure in their own existing status UI.
projectEditingReady.catch(function() {});
