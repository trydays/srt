(function(root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./edit-capabilities') : root.SRTEditCapabilities);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTRenderGraph = api;
})(typeof window === 'undefined' ? null : window, function(capabilities) {
  function fail() { throw capabilities.codedError('RENDER_GRAPH_INVALID'); }
  function keys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== allowed.length || Object.keys(value).some(function(k) { return allowed.indexOf(k) < 0; })) fail();
  }
  function positive(value) { if (!Number.isFinite(value) || value <= 0) fail(); }
  function range(value, duration) { keys(value, ['start', 'end']); if (value.start !== 0 || value.end !== duration) fail(); }
  function string(value) { if (typeof value !== 'string' || !value.trim()) fail(); }
  function createRenderGraphCompiler(options) {
    var registry = options && options.capabilityRegistry || capabilities.createCapabilityRegistry();
    function validate(graph) {
      keys(graph, ['schemaVersion', 'projectId', 'documentRevision', 'duration', 'nodes', 'outputs']);
      if (graph.schemaVersion !== 1 || !Number.isSafeInteger(graph.documentRevision) || graph.documentRevision < 0) fail();
      string(graph.projectId); positive(graph.duration);
      if (!Array.isArray(graph.nodes) || graph.nodes.length < 1 || graph.nodes.length > 2) fail();
      var ids = new Set(), head;
      graph.nodes.forEach(function(node, index) {
        keys(node, ['id', 'type', 'range', 'inputs', 'props']); string(node.id);
        if (ids.has(node.id)) fail(); ids.add(node.id); range(node.range, graph.duration);
        if (!Array.isArray(node.inputs)) fail();
        if (index === 0) {
          if (node.type !== 'source.video@1' || node.inputs.length) fail();
          keys(node.props, ['assetId']); string(node.props.assetId);
        } else {
          if (node.type !== 'visual.subtitle@1' || node.inputs.length !== 1) fail();
          keys(node.inputs[0], ['port', 'nodeId']);
          if (node.inputs[0].port !== 'base' || node.inputs[0].nodeId !== head) fail();
          capabilities.validateSubtitlePayload(node.props, graph.duration);
        }
        head = node.id;
      });
      keys(graph.outputs, ['video', 'audio']); keys(graph.outputs.video, ['nodeId', 'port']); keys(graph.outputs.audio, ['nodeId', 'port']);
      if (graph.outputs.video.nodeId !== head || graph.outputs.video.port !== 'video' || graph.outputs.audio.nodeId !== graph.nodes[0].id || graph.outputs.audio.port !== 'audio') fail();
      return capabilities.clone(graph);
    }
    function compile(document) {
      keys(document, ['schemaVersion', 'projectId', 'revision', 'timeline', 'sources', 'edits']);
      if (document.schemaVersion !== 1 || !Number.isSafeInteger(document.revision) || document.revision < 0) fail();
      string(document.projectId); keys(document.timeline, ['duration', 'canvas']); positive(document.timeline.duration);
      keys(document.timeline.canvas, ['width', 'height']); positive(document.timeline.canvas.width); positive(document.timeline.canvas.height);
      var duration = document.timeline.duration;
      if (!Array.isArray(document.sources) || document.sources.length !== 1) fail();
      var source = document.sources[0]; keys(source, ['id', 'assetId', 'kind', 'range']);
      if (source.id !== 'main-video' || source.kind !== 'video') fail(); string(source.assetId); range(source.range, duration);
      if (!Array.isArray(document.edits) || document.edits.length > 1) fail();
      var graph = { schemaVersion: 1, projectId: document.projectId, documentRevision: document.revision, duration: duration,
        nodes: [{ id: 'node-main-video', type: 'source.video@1', range: { start: 0, end: duration }, inputs: [], props: { assetId: source.assetId } }],
        outputs: { video: { nodeId: 'node-main-video', port: 'video' }, audio: { nodeId: 'node-main-video', port: 'audio' } } };
      var ids = new Set();
      document.edits.forEach(function(edit) {
        keys(edit, ['id', 'transactionId', 'type', 'target', 'range', 'payload', 'order', 'enabled']);
        string(edit.id); if (ids.has(edit.id)) fail(); ids.add(edit.id); string(edit.transactionId);
        if (edit.type !== 'subtitle.track@1' || typeof edit.enabled !== 'boolean' || !Number.isSafeInteger(edit.order) || edit.order < 0) fail();
        keys(edit.target, ['kind', 'id']); if (edit.target.kind !== 'source' || edit.target.id !== 'main-video') fail();
        range(edit.range, duration); capabilities.validateSubtitlePayload(edit.payload, duration);
        if (!edit.enabled) return;
        var node = registry.forEditType(edit.type).toGraph(edit, { videoHead: graph.outputs.video.nodeId });
        graph.nodes.push(node); graph.outputs.video.nodeId = node.id;
      });
      return validate(graph);
    }
    return { compile: compile, validate: validate };
  }
  return { createRenderGraphCompiler: createRenderGraphCompiler };
});
