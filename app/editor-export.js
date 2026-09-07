/* === editor-export.js — 当前项目字幕视频导出 === */
(function() {
  var exportButton = document.querySelector('[data-testid="video-export-button"]');
  if (!exportButton) return;
  var popover = document.querySelector('[data-testid="video-export-popover"]');
  var statusEl = document.querySelector('[data-testid="video-export-status"]');
  var targetEl = document.querySelector('[data-testid="video-export-target"]');
  var progressEl = document.querySelector('[data-testid="video-export-progress"]');
  var cancelButton = document.querySelector('[data-testid="video-export-cancel"]');
  var tabsBar = document.getElementById('tabsBar');
  var timelineTrack = document.getElementById('tlTrack');
  var currentJobId = null;
  var currentPhase = null;
  var frozenControls = [];
  var frozenEditors = [];
  var tabsWereInert = false;
  window.isExporting = false;

  function showState(status, options) {
    options = options || {};
    popover.hidden = false;
    statusEl.textContent = status;
    targetEl.hidden = !options.outputPath;
    targetEl.textContent = options.outputPath || '';
    progressEl.hidden = options.percent === undefined || options.percent === null;
    progressEl.textContent = progressEl.hidden ? '' : String(options.percent) + '%';
    cancelButton.hidden = options.cancellable === undefined;
    cancelButton.disabled = options.cancellable === false || currentPhase === 'finalizing';
  }

  function freezeEditor() {
    frozenControls = Array.from(document.querySelectorAll(
      '#generateBtn, [data-testid="subtitle-document-save"], '
      + '[data-testid="subtitle-document-apply"], .request-undo, #reupload, #previewUpload'
    )).map(function(control) {
      var state = { control: control, disabled: control.disabled };
      control.disabled = true;
      return state;
    });
    frozenEditors = Array.from(document.querySelectorAll(
      '.input-editor, [data-testid="subtitle-document-segment"]'
    )).map(function(editor) {
      var state = { editor: editor, contenteditable: editor.getAttribute('contenteditable') };
      editor.setAttribute('contenteditable', 'false');
      return state;
    });
    tabsWereInert = tabsBar.inert;
    tabsBar.inert = true;
    exportButton.disabled = true;
  }

  function restoreEditor() {
    frozenControls.forEach(function(state) { state.control.disabled = state.disabled; });
    frozenEditors.forEach(function(state) {
      if (state.contenteditable === null) state.editor.removeAttribute('contenteditable');
      else state.editor.setAttribute('contenteditable', state.contenteditable);
    });
    tabsBar.inert = tabsWereInert;
    exportButton.disabled = false;
    frozenControls = [];
    frozenEditors = [];
  }

  function exportErrorMessage(code) {
    var messages = {
      VIDEO_PATH_UNAVAILABLE: '当前视频路径不可用',
      EXPORT_BUSY: '已有视频正在导出',
      EXPORT_UNSUPPORTED_OPERATION: '当前编辑暂不支持导出',
      EXPORT_RUNTIME_NOT_READY: '导出工具尚未准备好',
      EXPORT_INVALID_RECIPE: '当前字幕无法导出',
      EXPORT_TARGET_EXISTS: '目标文件已存在',
      EXPORT_SOURCE_OVERWRITE: '不能覆盖源视频',
      EXPORT_INVALID_MEDIA: '视频文件不可用',
      EXPORT_WRITE_FAILED: '视频保存失败',
      EXPORT_RENDER_FAILED: '导出失败'
    };
    return messages[code] || '导出失败';
  }

  function onProgress(value) {
    if (!value || value.jobId !== currentJobId) return;
    currentPhase = value.phase;
    var outputPath = value.outputPath || targetEl.textContent || '';
    if (value.phase === 'preparing') {
      showState('准备导出', { outputPath: outputPath, cancellable: true });
    } else if (value.phase === 'rendering') {
      showState('导出中 ' + Number(value.percent || 0) + '%', {
        outputPath: outputPath, percent: Number(value.percent || 0), cancellable: true
      });
    } else if (value.phase === 'finalizing') {
      showState('正在保存', { outputPath: outputPath, percent: value.percent, cancellable: false });
    }
  }

  if (window.srtAPI && window.srtAPI.onVideoExportProgress) {
    window.srtAPI.onVideoExportProgress(onProgress);
  }

  function blockTimelineMutation(event) {
    if (!window.isExporting) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  timelineTrack.addEventListener('drop', blockTimelineMutation, true);
  timelineTrack.addEventListener('contextmenu', blockTimelineMutation, true);

  exportButton.addEventListener('click', async function() {
    if (window.isExporting) return;
    if (!window.currentProjectVideoPath) {
      showState(exportErrorMessage('VIDEO_PATH_UNAVAILABLE'));
      return;
    }
    if (window.timelineController.isRequestInFlight()) {
      showState('当前编辑仍在处理中');
      return;
    }
    if (window.subtitleController.hasPendingChanges()) {
      window.subtitleController.openAfter(null);
      showState('请先应用字幕修改');
      return;
    }
    var unsupported = window.timelineController.getUnsupportedExportItems();
    if (unsupported.length) {
      showState('暂不支持导出：' + unsupported.join('、'));
      return;
    }
    var recipe;
    try {
      var segments = JSON.parse(JSON.stringify(window.subtitleController.getAppliedSegments()));
      recipe = window.SRTRenderRecipe.buildSubtitleRecipe(segments);
    } catch (error) {
      showState(exportErrorMessage(error && error.code));
      return;
    }

    currentJobId = window.crypto.randomUUID();
    currentPhase = 'dialog';
    window.isExporting = true;
    freezeEditor();
    showState('准备导出', { cancellable: true });
    try {
      var result = await window.srtAPI.startVideoExport({
        jobId: currentJobId,
        videoPath: window.currentProjectVideoPath,
        recipe: recipe
      });
      if (!result || result.jobId !== currentJobId) return;
      if (result.status === 'completed') {
        showState('导出完成', { outputPath: result.outputPath });
      } else if (result.status === 'cancelled') {
        showState('已取消');
      } else {
        showState(exportErrorMessage(result.errorCode));
      }
    } catch (_) {
      showState(exportErrorMessage('EXPORT_WRITE_FAILED'));
    } finally {
      window.isExporting = false;
      currentJobId = null;
      currentPhase = null;
      restoreEditor();
    }
  });

  cancelButton.addEventListener('click', function() {
    if (!currentJobId || currentPhase === 'finalizing') return;
    cancelButton.disabled = true;
    window.srtAPI.cancelVideoExport(currentJobId).catch(function() {});
  });
})();
