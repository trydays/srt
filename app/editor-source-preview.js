/* Derived source frames only. ProjectEditing remains the document orchestrator. */
(function() {
  var svgNS = 'http://www.w3.org/2000/svg', nextCompositor = 0;

  function createCompositor(canvas, filterRoot) {
    var buffers = [document.createElement('canvas'), document.createElement('canvas')];
    var contexts = buffers.map(function(buffer) { return buffer.getContext('2d'); });
    var display = canvas.getContext('2d');
    var defs = document.createElementNS(svgNS, 'defs');
    filterRoot.appendChild(defs);
    var prefix = 'source-preview-' + (++nextCompositor) + '-', signature = null, filters = {};

    function prepareFilters(graph) {
      var colors = graph.nodes.filter(function(node) { return node.type === 'video.color@1'; });
      var key = JSON.stringify(colors);
      if (key === signature) return;
      defs.replaceChildren(); filters = {}; signature = key;
      colors.forEach(function(node, index) {
        var filter = document.createElementNS(svgNS, 'filter');
        var id = prefix + index;
        filter.setAttribute('id', id);
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        window.SRTColorPreview.appendPrimitives(filter, node.props);
        defs.appendChild(filter); filters[node.id] = 'url(#' + id + ')';
      });
    }

    function clear() {
      canvas.hidden = true;
      display.clearRect(0, 0, canvas.width, canvas.height);
    }

    function render(source, graph, time, width, height) {
      [canvas].concat(buffers).forEach(function(buffer) {
        if (buffer.width !== width) buffer.width = width;
        if (buffer.height !== height) buffer.height = height;
      });
      prepareFilters(graph);
      var previous = 0;
      contexts[0].filter = 'none';
      contexts[0].fillStyle = '#000'; contexts[0].fillRect(0, 0, width, height);
      contexts[0].drawImage(source, 0, 0, width, height);
      graph.nodes.forEach(function(node) {
        if (node.type !== 'video.transform@1' && node.type !== 'video.color@1'
            && node.type !== 'video.noise@1' && node.type !== 'video.vignette@1') return;
        // The registry owns activation and parameter normalization; each node
        // retains its position in the common linear graph.
        var registration = window.editCapabilityRegistry.forNodeType(node.type);
        var params = registration.preview({ nodes: [node] }, time)[0];
        if (!params) return;
        var next = 1 - previous, ctx = contexts[next];
        ctx.filter = 'none'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
        if (node.type === 'video.transform@1') {
          var g = window.SRTVideoTransform.geometry(params, width, height);
          ctx.save();
          ctx.translate(g.offsetX + (params.flipHorizontal ? g.scaledWidth : 0),
            g.offsetY + (params.flipVertical ? g.scaledHeight : 0));
          ctx.scale(params.flipHorizontal ? -1 : 1, params.flipVertical ? -1 : 1);
          ctx.drawImage(buffers[previous], 0, 0, width, height, 0, 0, g.scaledWidth, g.scaledHeight);
          ctx.restore();
        } else if (node.type === 'video.color@1') {
          ctx.filter = filters[node.id];
          ctx.drawImage(buffers[previous], 0, 0);
          ctx.filter = 'none';
        } else {
          ctx.drawImage(buffers[previous], 0, 0);
          var frame = ctx.getImageData(0, 0, width, height);
          window.SRTVideoTexture.applyFrame(node.type === 'video.noise@1' ? 'noise' : 'vignette',
            params, frame.data, width, height, time);
          ctx.putImageData(frame, 0, 0);
        }
        // Every destination is the original frame size. Cropped pixels cannot
        // reappear in subsequent transforms; black margins enter later colors.
        previous = next;
      });
      display.clearRect(0, 0, width, height);
      display.drawImage(buffers[previous], 0, 0);
      canvas.hidden = false;
    }
    return { render: render, clear: clear };
  }
  window.SRTSourcePreview = { createCompositor: createCompositor };

  var video = document.getElementById('previewVideo');
  var canvas = document.getElementById('previewSourceCanvas');
  var compositor = createCompositor(canvas, document.getElementById('previewColorFilter').parentNode);
  var scheduled = null, suspended = false, seeking = false, lastDecodedTime = null;
  var decodedFrames = typeof video.requestVideoFrameCallback === 'function';

  function stop() {
    if (scheduled === null) return;
    if (decodedFrames) video.cancelVideoFrameCallback(scheduled);
    else window.cancelAnimationFrame(scheduled);
    scheduled = null;
  }
  function schedule() {
    if (scheduled !== null || suspended || seeking || video.paused || video.ended) return;
    if (decodedFrames) scheduled = video.requestVideoFrameCallback(function(_now, frame) {
      scheduled = null;
      if (seeking) return;
      lastDecodedTime = frame.mediaTime;
      render(frame.mediaTime);
    });
    else scheduled = window.requestAnimationFrame(function() { scheduled = null; render(); });
  }
  function render(time) {
    if (suspended || seeking || window.projectEditingState !== 'ready') {
      stop(); compositor.clear(); return false;
    }
    var snapshot = window.projectEditing.load(getActiveProjectId());
    if (!snapshot.graph.nodes.some(function(node) {
      return node.type === 'video.transform@1' || node.type === 'video.noise@1'
        || node.type === 'video.vignette@1';
    })) {
      stop(); compositor.clear(); return false;
    }
    video.style.filter = '';
    if (video.readyState < 2 || window.projectVideoLoading) {
      stop(); compositor.clear(); return true;
    }
    var width = video.videoWidth || snapshot.document.timeline.canvas.width;
    var height = video.videoHeight || snapshot.document.timeline.canvas.height;
    try {
      var mediaTime = Number.isFinite(time) ? time
        : (!video.paused && Number.isFinite(lastDecodedTime) ? lastDecodedTime : video.currentTime);
      compositor.render(video, snapshot.graph, mediaTime, width, height);
    } catch (error) {
      // A decoded source can disappear during re-upload. Never leave its last
      // transformed frame covering the new source while metadata is pending.
      compositor.clear(); stop(); return true;
    }
    schedule(); return true;
  }
  function refresh() { window.colorPreviewController.render(); }
  function reset() { stop(); lastDecodedTime = null; compositor.clear(); }
  function resetSource() { seeking = false; reset(); }
  ['play', 'loadeddata', 'canplay'].forEach(function(event) { video.addEventListener(event, refresh); });
  ['pause', 'ended'].forEach(function(event) { video.addEventListener(event, function() { stop(); refresh(); }); });
  ['loadstart', 'emptied', 'error'].forEach(function(event) { video.addEventListener(event, resetSource); });
  video.addEventListener('seeking', function() { seeking = true; reset(); });
  video.addEventListener('seeked', function() { seeking = false; lastDecodedTime = video.currentTime; refresh(); });
  window.addEventListener('pagehide', function() { suspended = true; reset(); });
  window.addEventListener('pageshow', function() { suspended = false; refresh(); });
  window.sourcePreviewController = { render: render };
  refresh();
})();
