(function(root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./render-graph') : root.SRTRenderGraph,
    node ? require('./remotion-support') : root.SRTRemotionSupport);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTRemotionInput = api;
})(typeof window === 'undefined' ? null : window, function(renderGraph, support) {
  'use strict';
  function fail(code) { var error = new Error(code || 'REMOTION_INPUT_INVALID'); error.code = error.message; throw error; }
  function equal(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
        || Array.isArray(left) !== Array.isArray(right)) return false;
    var names = Object.keys(left);
    return names.length === Object.keys(right).length && names.every(function(name) {
      return Object.prototype.hasOwnProperty.call(right, name) && equal(left[name], right[name]);
    });
  }
  function supportsGraph(graph) {
    if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return false;
    if (!graph.nodes.every(function(node) { return node && support.supportsNodeType(node.type); })) return false;
    try { renderGraph.createRenderGraphCompiler().validate(graph); return true; } catch (_) { return false; }
  }
  function createRenderInput(snapshot, options) {
    if (!snapshot || !snapshot.document || !snapshot.graph || !options) fail();
    var graph = renderGraph.createRenderGraphCompiler().compile(snapshot.document);
    if (!equal(graph, snapshot.graph)) fail();
    if ((snapshot.projectId !== undefined && snapshot.projectId !== graph.projectId)
        || (snapshot.revision !== undefined && snapshot.revision !== graph.documentRevision)
        || (snapshot.duration !== undefined && snapshot.duration !== graph.duration)) fail();
    if (!supportsGraph(graph)) fail('REMOTION_GRAPH_UNSUPPORTED');
    var fps = options.fps, canvas = snapshot.document.timeline.canvas;
    if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) fail();
    var durationInFrames = Math.ceil(graph.duration * fps);
    if (!Number.isSafeInteger(durationInFrames) || durationInFrames <= 0
        || !Number.isSafeInteger(canvas.width) || canvas.width <= 0
        || !Number.isSafeInteger(canvas.height) || canvas.height <= 0) fail();
    var assets = options.assets;
    if (!assets || typeof assets !== 'object' || Array.isArray(assets)) fail();
    Object.keys(assets).forEach(function(id) {
      var asset = assets[id], url;
      if (!asset || typeof asset !== 'object' || typeof asset.src !== 'string'
          || Object.keys(asset).length !== 1) fail();
      try { url = new URL(asset.src); } catch (_) { fail(); }
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
          || url.username || url.password || url.hash) fail();
    });
    if (!Object.prototype.hasOwnProperty.call(assets, graph.nodes[0].props.assetId)) fail();
    return { graph: graph, width: canvas.width, height: canvas.height, fps: fps,
      durationInFrames: durationInFrames, assets: JSON.parse(JSON.stringify(assets)) };
  }
  return { createRenderInput: createRenderInput, supportsGraph: supportsGraph };
});
