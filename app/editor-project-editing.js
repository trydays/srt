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

/* Normal projects use Remotion; the disabled branch is retained for isolated legacy regression. */
(function() {
  var area = document.getElementById('previewArea');
  var surface = document.getElementById('remotionPreview');
  var message = document.getElementById('remotionPreviewMessage');
  var input = null, remotionDriver = null, sessionId = null;
  var engine = 'legacy', key = null, epoch = 0, pending = Promise.resolve('legacy');
  var disposed = false;
  var runtimeError = null, playerToken = null;
  var enabled = window.srtAPI && window.srtAPI.getRemotionState
    ? window.srtAPI.getRemotionState().then(function(value) { return Boolean(value && value.enabled); })
    : Promise.resolve(false);
  area.dataset.renderEngine = engine;
  function fit() {
    if (!input) return;
    var width = Math.min(area.clientWidth, area.clientHeight * input.width / input.height);
    surface.style.width = width + 'px';
    surface.style.height = width * input.height / input.width + 'px';
  }
  var observer = new ResizeObserver(fit);
  observer.observe(area);
  function clearLegacy() {
    videoEl.style.filter = '';
    ['previewSourceCanvas', 'previewLayerCanvas', 'previewSubtitle'].forEach(function(id) {
      var element = document.getElementById(id); if (element) element.hidden = true;
    });
  }
  function release() {
    var previous = sessionId; sessionId = null; input = null;
    if (previous) window.srtAPI.releaseRemotionPreview(previous).catch(function() {});
  }
  function fail(error) {
    if (disposed) return;
    runtimeError = error || new Error('Preview failed');
    surface.dataset.state = 'error';
    message.textContent = error && error.code === 'EXPORT_INVALID_MEDIA'
      ? '视频信息不可用，未能准备预览。请重新打开项目。'
      : error && error.code === 'REMOTION_GRAPH_UNSUPPORTED'
        ? '当前编辑包含渲染器尚不支持的内容，未能准备预览。'
        : '视频预览未完成，请重新打开项目后重试。';
    message.hidden = false;
    editorPlayback.pause();
  }
  async function render(snapshot, turn) {
    var useRemotion = await enabled;
    if (turn !== epoch || disposed) return engine;
    if (!useRemotion) {
      playerToken = null;
      if (remotionDriver) {
        await editorPlayback.setDriver(SRTEditorPlayback.createVideoDriver(videoEl));
        remotionDriver = null;
      }
      release(); engine = 'legacy'; area.dataset.renderEngine = engine;
      surface.hidden = true; message.hidden = true; surface.dataset.state = 'idle';
      if (window.layerPreviewController) window.layerPreviewController.render();
      if (window.colorPreviewController) window.colorPreviewController.render();
      return engine;
    }
    engine = 'remotion'; area.dataset.renderEngine = engine;
    clearLegacy(); surface.hidden = false; surface.dataset.state = 'loading';
    if (!SRTRemotionInput.supportsGraph(snapshot.graph)) {
      throw Object.assign(new Error('Unsupported render graph'), { code: 'REMOTION_GRAPH_UNSUPPORTED' });
    }
    if (!window.SRTRemotionPlayer) throw Object.assign(new Error('Player bundle missing'), { code: 'EXPORT_RUNTIME_NOT_READY' });
    if (remotionDriver && input) {
      input = SRTRemotionInput.createRenderInput(snapshot, { fps: input.fps, assets: input.assets });
      remotionDriver.updateInput(input);
    } else {
      var result = await window.srtAPI.prepareRemotionPreview({ snapshot: snapshot, videoPath: window.currentProjectVideoPath });
      if (!result || !result.ok) throw Object.assign(new Error('Preview could not load'), { code: result && result.errorCode });
      if (turn !== epoch || disposed) {
        window.srtAPI.releaseRemotionPreview(result.sessionId).catch(function() {});
        return engine;
      }
      input = result.input; sessionId = result.sessionId; fit();
      var token = playerToken = {};
      var driver = await SRTRemotionPlayer.mount(surface, input, { onError: function(error) {
        if (playerToken === token) fail(error);
      } });
      if (turn !== epoch || disposed) { driver.destroy(); release(); return engine; }
      remotionDriver = driver;
      await editorPlayback.setDriver(driver);
    }
    if (runtimeError) throw runtimeError;
    fit(); clearLegacy(); message.hidden = true; surface.dataset.state = 'ready';
    surface.dataset.revision = String(snapshot.document.revision);
    return engine;
  }
  function ensure(snapshot) {
    if (runtimeError) return Promise.reject(runtimeError);
    var nextKey = snapshot.document.projectId + ':' + snapshot.document.revision + ':' + window.currentProjectVideoPath;
    if (nextKey === key) return pending;
    key = nextKey;
    var turn = ++epoch;
    pending = pending.catch(function() {}).then(function() { return render(snapshot, turn); }).catch(function(error) {
      if (turn === epoch) { key = null; fail(error); }
      throw error;
    });
    return pending;
  }
  function refresh() {
    if (projectEditingState !== 'ready' || !window.currentProjectVideoPath || disposed) return;
    ensure(projectEditing.load(getActiveProjectId())).catch(function() {});
  }
  function resetToSource() {
    epoch += 1; key = null;
    playerToken = null; runtimeError = null;
    editorPlayback.pause();
    if (remotionDriver) {
      editorPlayback.setDriver(SRTEditorPlayback.createVideoDriver(videoEl)).catch(fail);
      remotionDriver = null;
    }
    release(); engine = 'legacy'; area.dataset.renderEngine = engine;
    surface.hidden = true; message.hidden = true; surface.dataset.state = 'idle';
  }
  window.remotionPreviewController = {
    ensure: ensure,
    resetToSource: resetToSource,
    isActive: function() { return engine === 'remotion'; },
    getEngine: function() { return engine; }
  };
  surface.addEventListener('click', togglePlay);
  window.addEventListener('project-edit-state-changed', refresh);
  Promise.all([projectEditingReady, window.currentProjectVideoReady]).then(refresh).catch(function() {});
  videoEl.addEventListener('loadedmetadata', refresh);
  window.addEventListener('pagehide', function() {
    disposed = true; playerToken = null; epoch += 1; observer.disconnect(); editorPlayback.destroy(); release();
  });
})();
