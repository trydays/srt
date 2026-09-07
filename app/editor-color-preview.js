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

  function render() {
    filter.replaceChildren();
    video.style.filter = '';
    if (window.projectEditingState !== 'ready') return;
    var graph = window.projectEditing.load(getActiveProjectId()).graph;
    var colors = window.editCapabilityRegistry.get('video.color.adjust@1').preview(graph, video.currentTime);
    colors.forEach(function(params) {
      var red = 1 + 0.2 * params.temperature, blue = 1 - 0.2 * params.temperature;
      primitive('feColorMatrix', { 'data-color-temperature': '', type: 'matrix',
        values: [red, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, blue, 0, 0, 0, 0, 0, 1, 0].join(' ') }, filter);
      primitive('feColorMatrix', { 'data-color-saturation': '', type: 'saturate', values: params.saturation }, filter);
      var tone = primitive('feComponentTransfer', { 'data-color-tone': '' }, filter);
      ['feFuncR', 'feFuncG', 'feFuncB'].forEach(function(channel) {
        primitive(channel, { type: 'linear', slope: params.contrast,
          intercept: 0.25 * params.brightness + 0.5 * (1 - params.contrast) }, tone);
      });
    });
    if (colors.length) video.style.filter = 'url(#previewColorFilter)';
  }

  ['timeupdate', 'seeked', 'loadedmetadata'].forEach(function(event) { video.addEventListener(event, render); });
  window.addEventListener('project-edit-state-changed', render);
  window.projectEditingReady.then(render).catch(function() { video.style.filter = ''; });
  window.colorPreviewController = { render: render };
})();
