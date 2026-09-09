(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTRemotionSupport = api;
})(typeof window === 'undefined' ? null : window, function() {
  // The node types implemented by SrtComposition, not a catalog of future effects.
  var SUPPORTED_NODE_TYPES = Object.freeze([
    'source.video@1', 'video.color@1', 'video.transform@1', 'video.noise@1', 'video.vignette@1',
    'visual.shape@1', 'visual.text@1', 'visual.group@1', 'visual.subtitle@1'
  ]);
  return Object.freeze({
    SUPPORTED_NODE_TYPES: SUPPORTED_NODE_TYPES,
    supportsNodeType: function(type) { return SUPPORTED_NODE_TYPES.indexOf(type) !== -1; }
  });
});
