(function(root) {
  'use strict';
  var model = root.SRTTimelineLayout, LABEL = 0, PAD = 12, HEADER = 28, ROW = 30;
  function create(options) {
    var track = options.track, viewport = options.viewport, ruler = options.ruler;
    var items = [], duration = 0, time = 0, zoom = 1, width = 1, dragging = false;
    function available() { return Math.max(1, viewport.clientWidth - LABEL - PAD * 2); }
    function setTime(seconds) {
      time = Math.max(0, Math.min(duration, Number(seconds) || 0));
      options.current.textContent = formatDur(time);
      options.playhead.style.left = (LABEL + PAD + (duration ? time / duration * width : 0)) + 'px';
      options.playhead.hidden = !duration;
    }
    function node(className, text) {
      var el = document.createElement('div'); el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    }
    function draw() {
      var scroll = viewport.scrollLeft;
      width = model.contentWidth(available(), duration, zoom);
      track.dataset.timeWidth = String(width);
      track.style.width = (LABEL + PAD * 2 + width) + 'px';
      track.querySelectorAll('.tl-row').forEach(function(el) { el.remove(); });
      var rows = model.layout(items, duration);
      track.style.height = (HEADER + Math.max(1, rows.length) * ROW) + 'px';
      rows.forEach(function(row, index) {
        var el = node('tl-row'); el.dataset.lane = row.lane;
        if (index > 0 && rows[index - 1].lane !== row.lane) el.classList.add('tl-lane-divider');
        el.style.top = (HEADER + index * ROW) + 'px';
        row.items.forEach(function(item) {
          var marker = node(row.lane === 'source' ? 'tl-source' : 'tl-marker', item.label + (item.summary ? ' · ' + item.summary : ''));
          marker.style.left = (LABEL + PAD + item.range.start / duration * width) + 'px';
          marker.style.width = ((item.range.end - item.range.start) / duration * width) + 'px';
          marker.title = (item.label || row.label) + ' · ' + item.range.start.toFixed(2) + '–' + item.range.end.toFixed(2) + ' 秒' + (item.summary ? ' · ' + item.summary : '');
          marker.dataset.editId = item.editId; marker.dataset.lane = row.lane;
          if (item.transactionId) marker.dataset.transactionId = item.transactionId;
          if (item.editIds) marker.dataset.editIds = item.editIds.join(',');
          el.appendChild(marker);
        });
        track.appendChild(el);
      });
      ruler.replaceChildren();
      if (duration) {
        var intervals = Math.max(1, Math.floor(width / 90));
        for (var i = 0; i <= intervals; i++) {
          var seconds = duration * i / intervals;
          var tick = node('tl-ruler-tick', model.formatTick(seconds, duration / intervals));
          tick.style.left = (LABEL + PAD + width * i / intervals) + 'px';
          if (i === intervals) tick.classList.add('is-last');
          ruler.appendChild(tick);
        }
      }
      options.total.textContent = formatDur(duration);
      options.zoomIn.disabled = !duration || zoom >= 16;
      options.zoomOut.disabled = !duration || zoom <= 1;
      options.fit.disabled = !duration;
      viewport.scrollLeft = scroll;
      setTime(time);
    }
    function changeZoom(value) {
      if (!duration) return;
      var next = Math.max(1, Math.min(16, value));
      var nextWidth = model.contentWidth(available(), duration, next);
      var scroll = model.zoomScroll(width, nextWidth, viewport.scrollLeft, available(), time, duration);
      zoom = next; draw(); viewport.scrollLeft = scroll;
    }
    function seek(event) {
      var left = viewport.getBoundingClientRect().left + viewport.clientLeft + LABEL + PAD;
      var seconds = model.timeAt(event.clientX, left, viewport.scrollLeft, width, duration);
      options.seek(seconds); setTime(seconds);
    }
    track.addEventListener('mousedown', function(event) {
      if (event.button !== 0 || !duration || event.target.closest('.tl-row-label,.tl-ruler-label')) return;
      dragging = true; seek(event); event.preventDefault();
    });
    document.addEventListener('mousemove', function(event) { if (dragging) seek(event); });
    document.addEventListener('mouseup', function() { dragging = false; });
    root.addEventListener('blur', function() { dragging = false; });
    options.zoomIn.addEventListener('click', function() { changeZoom(zoom * 2); });
    options.zoomOut.addEventListener('click', function() { changeZoom(zoom / 2); });
    options.fit.addEventListener('click', function() { changeZoom(1); viewport.scrollLeft = 0; });
    var pending = false;
    function resize() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function() { pending = false; draw(); });
    }
    var observer = new ResizeObserver(resize); observer.observe(viewport);
    root.addEventListener('pagehide', function() { observer.disconnect(); });
    return {
      render: function(nextItems, nextDuration) {
        items = nextItems;
        var next = Number.isFinite(nextDuration) && nextDuration > 0 ? nextDuration : 0;
        if (next !== duration) { zoom = 1; viewport.scrollLeft = 0; viewport.scrollTop = 0; }
        duration = next; draw();
      },
      setTime: setTime, resize: resize
    };
  }
  root.SRTTimelineView = { create: create };
})(window);
