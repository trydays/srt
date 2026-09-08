/* Transparent visual-overlay preview derived from the current render graph. */
(function(root) {
  function drawGraph(canvas, graph, time, width, height) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    var context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    var count = 0;
    graph.nodes.forEach(function(node) {
      if (node.type !== 'visual.shape@1' && node.type !== 'visual.text@1') return;
      var registration = root.editCapabilityRegistry.forNodeType(node.type);
      var params = registration.preview({ nodes: [node] }, time)[0];
      if (!params) return;
      root.SRTVisualLayers.draw(context, node.type === 'visual.shape@1' ? 'shape' : 'text', params, width, height);
      count += 1;
    });
    canvas.hidden = count === 0;
    return count;
  }

  root.SRTLayerPreview = { drawGraph: drawGraph };
  if (typeof document === 'undefined') return;

  var video = document.getElementById('previewVideo');
  var canvas = document.getElementById('previewLayerCanvas');
  var scheduled = null, suspended = false, lastDecodedTime = null;
  var decodedFrames = typeof video.requestVideoFrameCallback === 'function';

  function stop() {
    if (scheduled === null) return;
    if (decodedFrames) video.cancelVideoFrameCallback(scheduled);
    else root.cancelAnimationFrame(scheduled);
    scheduled = null;
  }
  function clear() {
    var context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
  }
  function schedule() {
    if (scheduled !== null || suspended || video.paused || video.ended || video.seeking) return;
    if (decodedFrames) scheduled = video.requestVideoFrameCallback(function(_now, frame) {
      scheduled = null; lastDecodedTime = frame.mediaTime; render(frame.mediaTime);
    });
    else scheduled = root.requestAnimationFrame(function() { scheduled = null; render(video.currentTime); });
  }
  function render(time) {
    if (suspended || video.seeking || root.projectEditingState !== 'ready') { stop(); clear(); return false; }
    var snapshot = root.projectEditing.load(getActiveProjectId());
    if (!snapshot.graph.nodes.some(function(node) {
      return node.type === 'visual.shape@1' || node.type === 'visual.text@1';
    })) { stop(); clear(); return false; }
    if (video.readyState < 1 || root.projectVideoLoading) { stop(); clear(); return true; }
    var width = video.videoWidth || snapshot.document.timeline.canvas.width;
    var height = video.videoHeight || snapshot.document.timeline.canvas.height;
    drawGraph(canvas, snapshot.graph, Number.isFinite(time) ? time : video.currentTime, width, height);
    schedule(); return true;
  }
  function refresh() {
    if (decodedFrames && !video.paused && !video.ended) {
      if (Number.isFinite(lastDecodedTime)) render(lastDecodedTime);
      else schedule();
      return;
    }
    render(video.currentTime);
  }
  function reset() { stop(); lastDecodedTime = null; clear(); }
  ['play', 'loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'timeupdate'].forEach(function(event) {
    video.addEventListener(event, refresh);
  });
  ['pause', 'ended'].forEach(function(event) {
    video.addEventListener(event, function() { stop(); render(video.currentTime); });
  });
  ['loadstart', 'emptied', 'error', 'seeking'].forEach(function(event) { video.addEventListener(event, reset); });
  root.addEventListener('project-edit-state-changed', refresh);
  root.addEventListener('pagehide', function() { suspended = true; reset(); });
  root.addEventListener('pageshow', function() { suspended = false; refresh(); });
  root.layerPreviewController = { render: refresh };
  root.projectEditingReady.then(refresh);
})(typeof window !== 'undefined' ? window : globalThis);
