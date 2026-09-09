/* Color preview is a projection of the current graph, in source-effect order. */
(function() {
  var video = document.getElementById('previewVideo');
  var filter = document.getElementById('previewColorFilter');
  var svgNS = 'http://www.w3.org/2000/svg';

  function primitive(name, attributes, parent) {
    var element = document.createElementNS(svgNS, name);
    Object.keys(attributes).forEach(function(key) { element.setAttribute(key, attributes[key]); });
    parent.appendChild(element);
    return element;
  }

  function appendPrimitives(parent, params) {
    var matrices = window.SRTColorAdjustment.buildPreviewMatrices(params);
    primitive('feColorMatrix', { 'data-color-temperature': '', type: 'matrix',
      values: matrices.temperature.join(' ') }, parent);
    primitive('feColorMatrix', { 'data-color-encode': '', type: 'matrix',
      values: matrices.rgbToYuv.join(' ') }, parent);
    primitive('feColorMatrix', { 'data-color-tone': '', type: 'matrix',
      values: matrices.planes.join(' ') }, parent);
    primitive('feColorMatrix', { 'data-color-decode': '', type: 'matrix',
      values: matrices.yuvToRgb.join(' ') }, parent);
  }
  window.SRTColorPreview = { appendPrimitives: appendPrimitives };

  function render() {
    filter.replaceChildren();
    video.style.filter = '';
    if (window.remotionPreviewController && window.remotionPreviewController.isActive()) return;
    if (window.sourcePreviewController && window.sourcePreviewController.render()) return;
    if (window.projectEditingState !== 'ready') return;
    var graph = window.projectEditing.load(getActiveProjectId()).graph;
    var colors = window.editCapabilityRegistry.get('video.color.adjust@1').preview(graph, video.currentTime);
    colors.forEach(function(params) { appendPrimitives(filter, params); });
    if (colors.length) video.style.filter = 'url(#previewColorFilter)';
  }

  ['timeupdate', 'seeked', 'loadedmetadata'].forEach(function(event) { video.addEventListener(event, render); });
  window.addEventListener('project-edit-state-changed', render);
  window.projectEditingReady.then(render).catch(function() { video.style.filter = ''; });
  window.colorPreviewController = { render: render };
})();
