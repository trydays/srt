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
    function emptyState() { return { segments: [], draft: null, undo: null }; }
    function get(projectId) {
      var state = readAll()[projectId];
      if (!state || !Array.isArray(state.segments)) return emptyState();
      var undo = state.undo && typeof state.undo === 'object' ? {
        requestId: state.undo.requestId,
        segments: Array.isArray(state.undo.segments) ? state.undo.segments : [],
        draft: state.undo.draft && typeof state.undo.draft === 'object' ? state.undo.draft : null
      } : null;
      return clone({
        segments: state.segments,
        draft: state.draft && typeof state.draft === 'object' ? state.draft : null,
        undo: undo
      });
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
        draft: null,
        undo: { requestId: requestId, segments: current.segments, draft: current.draft }
      });
    }
    function validateTexts(state, textById) {
      var expected = state.segments.map(function(segment) { return segment.id; });
      var supplied = textById && typeof textById === 'object' && !Array.isArray(textById)
        ? Object.keys(textById) : [];
      if (supplied.length !== expected.length || expected.some(function(id) {
        return !Object.prototype.hasOwnProperty.call(textById || {}, id);
      }) || supplied.some(function(id) {
        return expected.indexOf(id) === -1;
      })) throw codedError('SUBTITLE_DOCUMENT_STALE');
      var values = {};
      expected.forEach(function(id) {
        var value = String(textById[id]).trim();
        if (!value) throw codedError('SUBTITLE_TEXT_REQUIRED');
        values[id] = value;
      });
      return values;
    }
    function saveDraft(projectId, textById) {
      var state = get(projectId);
      var values = validateTexts(state, textById);
      var unchanged = state.segments.every(function(segment) {
        return values[segment.id] === String(segment.text).trim();
      });
      var draft = unchanged ? null : values;
      return write(projectId, { segments: state.segments, draft: draft, undo: state.undo });
    }
    function applyTexts(projectId, textById) {
      var state = get(projectId);
      var values = validateTexts(state, textById);
      var segments = state.segments.map(function(segment) {
        return Object.assign({}, segment, { text: values[segment.id] });
      });
      return write(projectId, { segments: segments, draft: null, undo: state.undo });
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
      state.draft = null;
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
      return write(projectId, { segments: state.undo.segments, draft: state.undo.draft, undo: null });
    }
    return {
      get: get,
      replace: replace,
      saveDraft: saveDraft,
      applyTexts: applyTexts,
      updateText: updateText,
      canUndo: canUndo,
      undo: undo
    };
  }

  return { STORAGE_KEY: STORAGE_KEY, createSubtitleStore: createSubtitleStore };
});
