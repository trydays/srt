const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const modulePath = require('node:path').join(__dirname, '../app/editor-playback.js');
const api = fs.existsSync(modulePath) ? require(modulePath) : {};

function driver() {
  const listeners = new Set();
  const state = { currentTime: 0, duration: 4, paused: true };
  const emit = () => listeners.forEach(fn => fn({ ...state }));
  return {
    state, destroyed: false, rate: 1, volume: 1, muted: false,
    getState: () => ({ ...state }),
    play() { state.paused = false; emit(); return Promise.resolve(); },
    pause() { state.paused = true; emit(); },
    seekSeconds(t) { state.currentTime = t; emit(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setPlaybackRate(v) { this.rate = v; },
    setVolume(v) { this.volume = v; },
    setMuted(v) { this.muted = v; },
    destroy() { this.destroyed = true; listeners.clear(); }
  };
}

test('routes current playback and clamps user seeks without a second clock', async () => {
  assert.equal(typeof api.createEditorPlayback, 'function');
  const source = driver(), playback = api.createEditorPlayback(source);
  const events = [];
  const unsubscribe = playback.subscribe(s => events.push(s));
  playback.seekSeconds(10);
  assert.equal(playback.getState().currentTime, 4);
  playback.seekSeconds(-1);
  assert.equal(playback.getState().currentTime, 0);
  await playback.play();
  assert.equal(playback.getState().paused, false);
  playback.pause();
  assert.equal(playback.getState().paused, true);
  assert.ok(events.length >= 3);
  unsubscribe();
  const count = events.length;
  playback.seekSeconds(2);
  assert.equal(events.length, count);
  playback.destroy();
  assert.equal(source.destroyed, true);
});

test('switching engine preserves position and audio controls while stopping the old driver', async () => {
  assert.equal(typeof api.createEditorPlayback, 'function');
  const old = driver(), next = driver(), playback = api.createEditorPlayback(old);
  playback.seekSeconds(1.5);
  playback.setPlaybackRate(1.5);
  playback.setVolume(.4);
  playback.setMuted(true);
  await playback.play();
  await playback.setDriver(next);
  assert.equal(old.state.paused, true);
  assert.equal(old.destroyed, true);
  assert.equal(next.state.currentTime, 1.5);
  assert.equal(next.state.paused, false);
  assert.equal(next.rate, 1.5);
  assert.equal(next.volume, .4);
  assert.equal(next.muted, true);
  old.seekSeconds(3);
  assert.equal(playback.getState().currentTime, 1.5);
  playback.destroy();
});

test('video driver listens to real media events and detaches on destroy', () => {
  assert.equal(typeof api.createVideoDriver, 'function');
  const video = new EventTarget();
  Object.assign(video, { currentTime: 0, duration: 4, paused: true, volume: 1,
    muted: false, playbackRate: 1,
    play() { this.paused = false; this.dispatchEvent(new Event('play')); },
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); } });
  const bound = api.createVideoDriver(video), events = [];
  bound.subscribe(state => events.push(state));
  bound.seekSeconds(2);
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.at(-1).currentTime, 2);
  bound.play();
  assert.equal(events.at(-1).paused, false);
  bound.destroy();
  const count = events.length;
  video.dispatchEvent(new Event('timeupdate'));
  assert.equal(events.length, count);
});
