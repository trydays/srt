(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTSubtitleDraftState = api;
})(typeof window === 'undefined' ? null : window, function() {
  var STORAGE_KEY = 'srt_project_subtitle_drafts';
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function error(code) { var value = new Error(code); value.code = code; return value; }
  function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

  function validateTexts(textById, segments) {
    if (!textById || typeof textById !== 'object' || Array.isArray(textById)
        || Object.keys(textById).length !== segments.length
        || segments.some(function(segment) { return !has(textById, segment.id); })) {
      throw error('SUBTITLE_DOCUMENT_STALE');
    }
    var normalized = {};
    segments.forEach(function(segment) {
      var text = textById[segment.id];
      if (typeof text !== 'string' || !text.trim()) throw error('SUBTITLE_TEXT_REQUIRED');
      Object.defineProperty(normalized, segment.id, {
        value: text.trim(), enumerable: true, writable: true, configurable: true
      });
    });
    return normalized;
  }

  function createSubtitleDraftStore(storage) {
    function read() {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var value;
      try { value = JSON.parse(raw); } catch (_) { throw error('SUBTITLE_DRAFT_INVALID'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('SUBTITLE_DRAFT_INVALID');
      return value;
    }
    function key(projectId, editId) { return JSON.stringify([projectId, editId]); }
    function get(projectId, editId) {
      if (!editId) return null;
      var value = read()[key(projectId, editId)];
      return value ? clone(value) : null;
    }
    function write(projectId, editId, value) {
      var all = read();
      all[key(projectId, editId)] = value;
      storage.setItem(STORAGE_KEY, JSON.stringify(all));
      return value ? clone(value) : null;
    }
    function save(projectId, editId, revision, texts, segments) {
      if (!projectId || !editId || !Number.isInteger(revision) || revision < 0) {
        throw error('SUBTITLE_DOCUMENT_STALE');
      }
      var normalized = validateTexts(texts, segments);
      var unchanged = segments.every(function(segment) { return normalized[segment.id] === segment.text.trim(); });
      return write(projectId, editId, unchanged ? null : { baseRevision: revision, textById: normalized });
    }
    function migrate(projectId, editId, revision, texts, segments) {
      if (!texts || has(read(), key(projectId, editId))) return get(projectId, editId);
      return save(projectId, editId, revision, texts, segments);
    }
    function rebase(projectId, editId, revision, segments) {
      var draft = get(projectId, editId);
      return draft ? save(projectId, editId, revision, draft.textById, segments) : null;
    }
    return {
      get: get, save: save, migrate: migrate, rebase: rebase,
      clear: function(projectId, editId) { return write(projectId, editId, null); },
      validateTexts: validateTexts
    };
  }
  return { STORAGE_KEY: STORAGE_KEY, createSubtitleDraftStore: createSubtitleDraftStore };
});
