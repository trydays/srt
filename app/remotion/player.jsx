import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Player } from '@remotion/player';
import remotionInput from '../../src/remotion-input';
import { SrtComposition } from './SrtComposition';

function validateInput(input) {
  if (!input || !remotionInput.supportsGraph(input.graph)
      || !Number.isFinite(input.fps) || input.fps <= 0
      || !Number.isSafeInteger(input.width) || input.width <= 0
      || !Number.isSafeInteger(input.height) || input.height <= 0
      || !Number.isSafeInteger(input.durationInFrames) || input.durationInFrames <= 0
      || input.durationInFrames !== Math.ceil(input.graph.duration * input.fps)) {
    throw new Error('REMOTION_INPUT_INVALID');
  }
  return structuredClone(input);
}

export async function mount(container, initialInput, { onState, onError } = {}) {
  let input = validateInput(initialInput);
  let playbackRate = 1;
  let destroyed = false;
  const listeners = new Set();
  if (onState) listeners.add(onState);
  const ref = createRef();
  const root = createRoot(container);
  const state = () => ({ currentTime: (ref.current?.getCurrentFrame() || 0) / input.fps,
    duration: input.graph.duration, paused: !ref.current?.isPlaying() });
  const notify = () => { if (!destroyed) listeners.forEach(listener => listener(state())); };
  const reportError = event => { if (!destroyed && onError) onError(event.detail.error); };
  const render = () => flushSync(() => root.render(<Player ref={ref}
    component={SrtComposition} inputProps={input} durationInFrames={input.durationInFrames}
    compositionWidth={input.width} compositionHeight={input.height} fps={input.fps}
    playbackRate={playbackRate} style={{ width: '100%', height: '100%' }}
    controls={false} autoPlay={false} loop={false} allowFullscreen={false}
    clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false}
    moveToBeginningWhenEnded={false} numberOfSharedAudioTags={0}
    initialVolume={1} initiallyMuted={false} noSuspense
    errorFallback={() => null} />));
  try { render(); } catch (error) { root.unmount(); throw error; }
  if (!ref.current) { root.unmount(); throw new Error('REMOTION_PLAYER_NOT_READY'); }
  const player = ref.current;
  const events = ['frameupdate', 'seeked', 'play', 'pause', 'ended', 'ratechange', 'volumechange', 'mutechange'];
  events.forEach(name => player.addEventListener(name, notify));
  player.addEventListener('error', reportError);
  const live = () => { if (destroyed) throw new Error('REMOTION_PLAYER_DESTROYED'); };
  const driver = {
    play() { live(); player.play(); },
    pause() { live(); player.pause(); },
    seekSeconds(seconds) {
      live(); if (!Number.isFinite(seconds)) throw new Error('REMOTION_SEEK_INVALID');
      player.seekTo(Math.max(0, Math.min(input.durationInFrames - 1, Math.round(seconds * input.fps))));
    },
    getState: state,
    subscribe(listener) {
      live(); if (typeof listener !== 'function') throw new Error('REMOTION_LISTENER_INVALID');
      listeners.add(listener); listener(state()); return () => listeners.delete(listener);
    },
    updateInput(nextInput) {
      live(); const next = validateInput(nextInput), previous = state();
      input = next; render();
      player.seekTo(Math.min(input.durationInFrames - 1, Math.round(previous.currentTime * input.fps)));
      notify();
    },
    setPlaybackRate(rate) {
      live(); if (!Number.isFinite(rate) || rate <= 0 || rate > 4) throw new Error('REMOTION_RATE_INVALID');
      playbackRate = rate; render();
    },
    setVolume(value) {
      live(); if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('REMOTION_VOLUME_INVALID');
      player.setVolume(value);
    },
    setMuted(value) { live(); if (value) player.mute(); else player.unmute(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      player.pause();
      events.forEach(name => player.removeEventListener(name, notify));
      player.removeEventListener('error', reportError);
      listeners.clear(); root.unmount();
    }
  };
  notify();
  return driver;
}

window.SRTRemotionPlayer = { mount };
