(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTSubtitleState = api;
})(typeof window === 'undefined' ? null : window, function() {
  var STORAGE_KEY = 'srt_project_subtitles';

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSubtitleStore(storage, idFactory) {
    function readAll() {
      try {
        var value = JSON.parse(storage.getItem(STORAGE_KEY));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (_) { return {}; }
    }
    function emptyState() { return { segments: [], undo: null }; }
    function get(projectId) {
      var state = readAll()[projectId];
      return clone(state && Array.isArray(state.segments) ? state : emptyState());
    }
    function write(projectId, state) {
      var all = readAll();
      all[projectId] = clone(state);
      storage.setItem(STORAGE_KEY, JSON.stringify(all));
      return clone(state);
    }
    function replace(projectId, requestId, rawSegments) {
      var current = get(projectId);
      var nextSegments = rawSegments.map(function(segment) {
        return { id: idFactory(), start: segment.start, end: segment.end, text: segment.text };
      });
      return write(projectId, {
        segments: nextSegments,
        undo: { requestId: requestId, segments: current.segments }
      });
    }
    function updateText(projectId, segmentId, text) {
      var value = String(text || '').trim();
      if (!value) throw codedError('SUBTITLE_TEXT_REQUIRED');
      var state = get(projectId);
      var found = false;
      state.segments = state.segments.map(function(segment) {
        if (segment.id !== segmentId) return segment;
        found = true;
        return Object.assign({}, segment, { text: value });
      });
      if (!found) throw codedError('SUBTITLE_SEGMENT_NOT_FOUND');
      return write(projectId, state);
    }
    function canUndo(projectId, requestId) {
      var undo = get(projectId).undo;
      return !!undo && undo.requestId === requestId;
    }
    function undo(projectId, requestId) {
      var state = get(projectId);
      if (!state.undo || state.undo.requestId !== requestId) {
        throw codedError('SUBTITLE_UNDO_UNAVAILABLE');
      }
      return write(projectId, { segments: state.undo.segments, undo: null });
    }
    return { get: get, replace: replace, updateText: updateText, canUndo: canUndo, undo: undo };
  }

  return { STORAGE_KEY: STORAGE_KEY, createSubtitleStore: createSubtitleStore };
});
