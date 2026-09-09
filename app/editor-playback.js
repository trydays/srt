(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTEditorPlayback = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';
  function createVideoDriver(video) {
    var listeners = new Set();
    function getState() {
      return { currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0, paused: video.paused };
    }
    function emit() { listeners.forEach(function(fn) { fn(getState()); }); }
    var events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'seeked'];
    events.forEach(function(name) { video.addEventListener(name, emit); });
    return {
      getState: getState,
      play: function() { return video.play(); },
      pause: function() { video.pause(); },
      seekSeconds: function(value) { video.currentTime = value; emit(); },
      subscribe: function(fn) { listeners.add(fn); return function() { listeners.delete(fn); }; },
      setPlaybackRate: function(value) { video.playbackRate = value; },
      setVolume: function(value) { video.volume = value; },
      setMuted: function(value) { video.muted = value; },
      destroy: function() { events.forEach(function(name) { video.removeEventListener(name, emit); }); listeners.clear(); }
    };
  }
  function createEditorPlayback(initialDriver) {
    var driver = initialDriver, listeners = new Set(), rate = 1, volume = 1, muted = false;
    var detach = function() {}, destroyed = false;
    function getState() { return driver.getState(); }
    function emit() { if (!destroyed) listeners.forEach(function(fn) { fn(getState()); }); }
    function bind() { detach = driver.subscribe ? driver.subscribe(emit) : function() {}; }
    function seekSeconds(value) {
      if (!Number.isFinite(value)) return;
      driver.seekSeconds(Math.max(0, Math.min(value, getState().duration || 0)));
      emit();
    }
    bind();
    return {
      getState: getState,
      play: function() { return Promise.resolve(driver.play()); },
      pause: function() { driver.pause(); },
      seekSeconds: seekSeconds,
      subscribe: function(fn) { listeners.add(fn); return function() { listeners.delete(fn); }; },
      setPlaybackRate: function(value) { if (Number.isFinite(value) && value > 0) { rate = value; driver.setPlaybackRate(rate); } },
      setVolume: function(value) { if (Number.isFinite(value)) { volume = Math.max(0, Math.min(1, value)); driver.setVolume(volume); } },
      setMuted: function(value) { muted = Boolean(value); driver.setMuted(muted); },
      setDriver: async function(next) {
        if (next === driver) return;
        var state = getState();
        detach(); driver.pause(); driver.destroy();
        driver = next;
        driver.setPlaybackRate(rate); driver.setVolume(volume); driver.setMuted(muted);
        bind(); seekSeconds(state.currentTime);
        if (!state.paused) await driver.play();
        emit();
      },
      destroy: function() { destroyed = true; detach(); driver.pause(); driver.destroy(); listeners.clear(); }
    };
  }
  return { createEditorPlayback: createEditorPlayback, createVideoDriver: createVideoDriver };
});
