(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTTranscriptContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function codedError(code) {
    var error = new Error(code === 'TRANSCRIPT_TOO_LARGE'
      ? '所选语音原文超过分析上限，请缩小时间范围。' : 'Invalid transcript context');
    error.code = code;
    return error;
  }
  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function plain(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function selectTranscript(options) {
    if (plain(options) && options.maxChars === undefined) options.maxChars = 24000;
    if (!plain(options) || !Array.isArray(options.segments)
        || (options.source !== 'applied-subtitles' && options.source !== 'speech-recognition')
        || !plain(options.range) || !finite(options.range.start) || !finite(options.range.end)
        || options.range.start < 0 || options.range.end <= options.range.start
        || !Number.isInteger(options.maxChars) || options.maxChars <= 0) {
      throw codedError('TRANSCRIPT_INVALID');
    }
    var selected = [];
    var chars = 0;
    options.segments.forEach(function(segment) {
      if (!plain(segment) || !finite(segment.start) || !finite(segment.end)
          || segment.start < 0 || segment.end <= segment.start || typeof segment.text !== 'string') {
        throw codedError('TRANSCRIPT_INVALID');
      }
      if (segment.start >= options.range.end || segment.end <= options.range.start) return;
      chars += segment.text.length;
      selected.push({ start: segment.start, end: segment.end, text: segment.text });
    });
    if (chars > options.maxChars) throw codedError('TRANSCRIPT_TOO_LARGE');
    return { source: options.source, range: { start: options.range.start, end: options.range.end },
      segments: selected, complete: true };
  }
  return { selectTranscript: selectTranscript };
});
