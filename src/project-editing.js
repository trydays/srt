(function(root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./edit-capabilities') : root.SRTEditCapabilities, node ? require('./render-graph') : root.SRTRenderGraph, node ? require('./render-recipe') : root.SRTRenderRecipe);
  if (node) module.exports = api;
  if (root) root.SRTProjectEditing = api;
})(typeof window === 'undefined' ? null : window, function(capabilities, graphs, recipes) {
  var clone = capabilities.clone, error = capabilities.codedError;
  function createProjectEditing(options) {
    options = options || {};
    var storage = options.storage, storageKey = options.storageKey || 'srt_project_edit_state';
    var observedProjects = new Set();
    var registry = options.capabilityRegistry || capabilities.createCapabilityRegistry();
    var compiler = options.graphCompiler || graphs.createRenderGraphCompiler({ capabilityRegistry: registry });
    var idFactory = options.idFactory || function(prefix) { return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2); };
    function readMap() {
      var raw = storage.getItem(storageKey);
      if (raw === null) return Object.create(null);
      try {
        var map = JSON.parse(raw);
        if (!map || Array.isArray(map) || typeof map !== 'object') throw new Error();
        Object.keys(map).forEach(function(id) {
          var entry = map[id];
          if (!entry || Object.keys(entry).length !== 2 || !entry.document || entry.document.projectId !== id || !Array.isArray(entry.undoStack) || entry.undoStack.length > 1) throw new Error();
          compiler.compile(entry.document);
          entry.undoStack.forEach(function(inverse) {
            if (!inverse || typeof inverse.transactionId !== 'string' || !inverse.transactionId || inverse.afterRevision !== entry.document.revision || !Array.isArray(inverse.edits)) throw new Error();
            var previous = clone(entry.document); previous.edits = inverse.edits; compiler.compile(previous);
          });
        });
        return map;
      } catch (cause) { throw error('EDIT_STORAGE_CORRUPT'); }
    }
    function entry(map, projectId) {
      if (!Object.prototype.hasOwnProperty.call(map, projectId)) throw error('EDIT_PROJECT_NOT_READY');
      observedProjects.add(projectId);
      return map[projectId];
    }
    function check(current, revision) { if (current.document.revision !== revision) throw error('EDIT_REVISION_CONFLICT'); }
    function result(document, graph, transactionId) {
      var value = { document: clone(document), graph: clone(graph) };
      if (transactionId !== undefined) value.transactionId = transactionId;
      return value;
    }
    function commit(projectId, revision, document, undoStack, transactionId) {
      var graph = compiler.compile(document), latest = readMap();
      check(entry(latest, projectId), revision);
      Object.defineProperty(latest, projectId, { value: { document: document, undoStack: undoStack }, enumerable: true, configurable: true, writable: true });
      storage.setItem(storageKey, JSON.stringify(latest));
      return result(document, graph, transactionId);
    }
    function facts(document) { return { duration: document.timeline.duration, canvas: clone(document.timeline.canvas), source: { id: 'main-video', assetId: document.sources[0].assetId } }; }
    function legacyEdit(segments, duration, transactionId) {
      var payload = { segments: clone(segments), style: clone(recipes.SUBTITLE_STYLE) };
      capabilities.validateSubtitlePayload(payload, duration);
      return { id: 'legacy-subtitles-' + segments[0].id, transactionId: transactionId, type: 'subtitle.track@1', target: { kind: 'source', id: 'main-video' }, range: { start: 0, end: duration }, payload: payload, order: 0, enabled: true };
    }
    function initializeProject(input) {
      var map = readMap();
      if (Object.prototype.hasOwnProperty.call(map, input.projectId)) return load(input.projectId);
      if (observedProjects.has(input.projectId)) throw error('EDIT_PROJECT_NOT_READY');
      var media = input.mediaFacts;
      if (!media || !media.source || media.source.id !== 'main-video') throw error('EDIT_INVALID_MEDIA');
      var document = { schemaVersion: 1, projectId: input.projectId, revision: 0, timeline: { duration: media.duration, canvas: clone(media.canvas) }, sources: [{ id: 'main-video', assetId: media.source.assetId, kind: 'video', range: { start: 0, end: media.duration } }], edits: [] };
      var legacy = input.legacySubtitleState, undoStack = [];
      if (legacy && Array.isArray(legacy.segments) && legacy.segments.length) {
        var transactionId = legacy.undo && legacy.undo.requestId || 'legacy-migration';
        document.edits = [legacyEdit(legacy.segments, media.duration, transactionId)];
      }
      if (legacy && legacy.undo && typeof legacy.undo.requestId === 'string' && legacy.undo.requestId) {
        var previous = legacy.undo.segments || [];
        undoStack = [{ transactionId: legacy.undo.requestId, afterRevision: 0, edits: previous.length ? [legacyEdit(previous, media.duration, 'legacy-migration')] : [] }];
      }
      var graph = compiler.compile(document);
      map = readMap();
      if (Object.prototype.hasOwnProperty.call(map, input.projectId)) return load(input.projectId);
      Object.defineProperty(map, input.projectId, { value: { document: document, undoStack: undoStack }, enumerable: true, configurable: true, writable: true });
      storage.setItem(storageKey, JSON.stringify(map)); observedProjects.add(input.projectId); return result(document, graph);
    }
    function load(projectId) { var current = entry(readMap(), projectId); return result(current.document, compiler.compile(current.document)); }
    async function applyRecipe(input) {
      var current = entry(readMap(), input.projectId); check(current, input.expectedRevision);
      if (typeof input.requestId !== 'string' || !input.requestId.trim()) throw error('EDIT_INVALID_TRANSACTION');
      var normalized = registry.normalizeRecipe(input.recipe, facts(current.document));
      var context = typeof options.executionContext === 'function' ? options.executionContext(input.projectId) : options.executionContext;
      var prepared = [];
      for (var i = 0; i < normalized.steps.length; i++) {
        var step = normalized.steps[i], registration = registry.get(step.capability);
        prepared.push({ step: step, registration: registration, value: await registration.prepare(step, context) });
      }
      var document = clone(current.document);
      var order = document.edits.reduce(function(next, edit) { return Math.max(next, edit.order + 1); }, 0);
      prepared.forEach(function(item) {
        var lowered = item.registration.toEdit(item.value, item.step, { idFactory: idFactory, duration: document.timeline.duration });
        if (lowered.type !== item.registration.editType) throw error('EDIT_INVALID_TYPE');
        if (item.registration.editMode === 'replaceByType') {
          document.edits = document.edits.filter(function(edit) { return edit.type !== item.registration.editType; });
        }
        document.edits.push({ id: idFactory('edit'), transactionId: input.requestId, type: lowered.type, target: clone(item.step.target), range: clone(lowered.range), payload: clone(lowered.payload), order: order++, enabled: true });
      });
      document.revision++;
      return commit(input.projectId, input.expectedRevision, document, [{ transactionId: input.requestId, afterRevision: document.revision, edits: clone(current.document.edits) }], input.requestId);
    }
    function replaceEdit(input) {
      var current = entry(readMap(), input.projectId); check(current, input.expectedRevision);
      var document = clone(current.document), edit = document.edits.find(function(value) { return value.id === input.editId; });
      if (!edit) throw error('EDIT_NOT_FOUND');
      edit.payload = capabilities.validateSubtitlePayload(input.payload, document.timeline.duration); document.revision++;
      var undoStack = clone(current.undoStack);
      if (undoStack.length && undoStack[0].transactionId === edit.transactionId) undoStack[0].afterRevision = document.revision;
      else undoStack = [];
      return commit(input.projectId, input.expectedRevision, document, undoStack);
    }
    function canUndo(input) { var current = entry(readMap(), input.projectId); return current.undoStack.length === 1 && current.undoStack[0].transactionId === input.transactionId && current.undoStack[0].afterRevision === current.document.revision; }
    function undo(input) {
      var current = entry(readMap(), input.projectId); check(current, input.expectedRevision);
      if (!current.undoStack.length || current.undoStack[0].transactionId !== input.transactionId) throw error('EDIT_UNDO_UNAVAILABLE');
      var document = clone(current.document); document.edits = clone(current.undoStack[0].edits); document.revision++;
      return commit(input.projectId, input.expectedRevision, document, []);
    }
    function timelineItems(projectId) { return load(projectId).document.edits.filter(function(edit) { return edit.enabled; }).map(function(edit) { return clone(registry.forEditType(edit.type).toTimeline(edit)); }); }
    function aiContext(projectId) {
      var document = load(projectId).document, active = document.edits.filter(function(edit) { return edit.enabled; });
      var subtitle = active.find(function(edit) { return edit.type === 'subtitle.track@1'; });
      var segments = subtitle ? subtitle.payload.segments : [];
      return { revision: document.revision, video: { durationSeconds: document.timeline.duration, width: document.timeline.canvas.width, height: document.timeline.canvas.height }, operations: active.map(function(edit) { return { capability: registry.forEditType(edit.type).definition.id, params: clone(edit.payload), range: clone(edit.range) }; }), subtitles: segments.slice(0, 500).map(function(segment) { return { id: segment.id, start: segment.start, end: segment.end, text: segment.text.slice(0, 80) }; }), subtitleTotal: segments.length, edits: document.edits.map(function(edit) { return { id: edit.id, type: edit.type, range: clone(edit.range), order: edit.order, enabled: edit.enabled }; }) };
    }
    return { initializeProject: initializeProject, load: load, applyRecipe: applyRecipe, replaceEdit: replaceEdit, canUndo: canUndo, undo: undo, timelineItems: timelineItems, aiContext: aiContext };
  }
  return { createProjectEditing: createProjectEditing };
});
