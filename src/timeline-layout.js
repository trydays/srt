(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTTimelineLayout = api;
})(typeof window === 'undefined' ? null : window, function() {
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function layout(items, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    var rows = [{ lane: 'source', label: '主视频', items: [{ editId: 'main-video', label: '主视频', range: { start: 0, end: duration } }] }];
    [['subtitle', '字幕'], ['visual', '卡片 / 文字'], ['video-effect', '画面效果']].forEach(function(group) {
      var lanes = [], ends = [];
      items.filter(function(item) { return item.lane === group[0]; }).slice().sort(function(a, b) {
        return a.range.start - b.range.start || a.range.end - b.range.end || (a.editId < b.editId ? -1 : a.editId > b.editId ? 1 : 0);
      }).forEach(function(item) {
        var index = ends.findIndex(function(end) { return end <= item.range.start; });
        if (index < 0) { index = lanes.length; lanes.push({ lane: group[0], label: group[1], items: [] }); }
        lanes[index].items.push(item); ends[index] = item.range.end;
      });
      lanes.forEach(function(row, i) { if (lanes.length > 1) row.label += ' ' + (i + 1); rows.push(row); });
    });
    return rows;
  }
  function contentWidth(viewport, duration, zoom) {
    return Math.max(1, viewport) * (duration > 0 ? clamp(zoom, 1, 16) : 1);
  }
  function timeAt(clientX, left, scroll, width, duration) {
    return width > 0 && duration > 0 ? clamp((clientX - left + scroll) / width * duration, 0, duration) : 0;
  }
  function zoomScroll(oldWidth, newWidth, scroll, viewport, playhead, duration) {
    if (!(duration > 0) || !(oldWidth > 0)) return 0;
    var head = playhead / duration * oldWidth;
    var anchor = head >= scroll && head <= scroll + viewport ? head : scroll + viewport / 2;
    return clamp(anchor / oldWidth * newWidth - (anchor - scroll), 0, Math.max(0, newWidth - viewport));
  }
  function formatTick(seconds, step) {
    var safeStep = Number(step);
    var precision = Number.isFinite(safeStep) && safeStep > 0
      ? Math.min(10, Math.max(0, Math.ceil(-Math.log10(safeStep))))
      : 0;
    var rounded = Number(seconds.toFixed(precision));
    if (rounded < 60) return rounded.toFixed(precision) + 's';
    var minutes = Math.floor(rounded / 60);
    var remainder = (rounded - minutes * 60).toFixed(precision);
    if (Number(remainder) < 10) remainder = '0' + remainder;
    return String(minutes).padStart(2, '0') + ':' + remainder;
  }
  return { layout: layout, contentWidth: contentWidth, timeAt: timeAt, zoomScroll: zoomScroll, formatTick: formatTick };
});
