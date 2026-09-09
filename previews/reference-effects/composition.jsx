import React from 'react';
import { AbsoluteFill, OffthreadVideo, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import visualGroup from '../../src/visual-group';
import { GlassSurface } from '../../app/remotion/glass-surface';
import { StyledText } from '../../app/remotion/styled-text';
import { SourceEffectsVideo } from '../../app/remotion/source-effects';
import { GLASS, TEXT_CUES, groupAnimation, WIDTH, HEIGHT } from './scenes.mjs';

function sample(start, end, time, x, y) {
  const state = visualGroup.sample(groupAnimation(start, end, x / WIDTH, y / HEIGHT),
    { start, end }, time, WIDTH, HEIGHT);
  return state ? { opacity: state.opacity, scale: state.scale, pivotX: x, pivotY: y } : null;
}

function Backdrop({ src, canvasBackground, frame, fps, diagnostic, scene }) {
  const leftPanelWidth = scene === 'glass' ? 505 : 414;
  const graph = { nodes: [{ id: 'grade', type: 'video.color@1', range: { start: 0, end: 14 },
    props: { temperature: -.2, brightness: 0, saturation: .9, contrast: 1.05 } }] };
  return <AbsoluteFill style={{ background: '#161A20' }}>
    {canvasBackground ? <SourceEffectsVideo src={src} graph={graph} frame={frame} fps={fps}
      width={WIDTH} height={HEIGHT} /> : <OffthreadVideo src={src} pauseWhenBuffering
      style={{ width: WIDTH, height: HEIGHT }} />}
    {diagnostic ? null : <>
    {/* Opaque side panels cover the source's burned-in effects. All new cards/text
        live here, so the reference cannot accidentally prove our renderer works. */}
    <div style={{ position: 'absolute', left: 0, top: 0, width: leftPanelWidth, height: HEIGHT,
      background: 'linear-gradient(125deg, #222932, #151A22)' }} />
    <div style={{ position: 'absolute', right: 0, top: 0, width: 328, height: HEIGHT,
      background: 'linear-gradient(235deg, #222932, #151A22)' }} />
    {/* A moving ruled surface makes real local background blur visible. */}
    <div style={{ position: 'absolute', left: 0, top: 0, width: leftPanelWidth, height: HEIGHT,
      backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 15px, #9EACB036 16px, transparent 18px)',
      backgroundPositionY: frame * .6 }} />
    <div style={{ position: 'absolute', left: 80 + Math.sin(frame / 55) * 55,
      top: 105, width: 10, height: 430, background: '#DE84B680', transform: 'rotate(23deg)' }} />
    <div style={{ position: 'absolute', left: leftPanelWidth, width: 45, top: 0, bottom: 0,
      background: 'linear-gradient(90deg, #151A22, transparent)' }} />
    <div style={{ position: 'absolute', right: 328, width: 75, top: 0, bottom: 0,
      background: 'linear-gradient(270deg, #151A22, transparent)' }} />
    </>}
  </AbsoluteFill>;
}

export function ReferenceComposition({ scene = 'glass', source, insetSource, image,
  canvasBackground = false, noBlur = false, diagnostic = false }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const cardState = sample(.35, 7.7, time, GLASS.x + GLASS.width / 2, GLASS.y + GLASS.height / 2);
  return <AbsoluteFill style={{ backgroundColor: '#161A20', overflow: 'hidden', fontFamily: 'Heiti SC' }}>
    <Backdrop src={source} canvasBackground={canvasBackground} frame={frame} fps={fps} diagnostic={diagnostic} scene={scene} />
    {scene === 'glass' && cardState ? <GlassSurface
      geometry={{ ...GLASS, backdropBlur: noBlur ? 0 : GLASS.backdropBlur }} frameStyle={cardState}>
      <div style={{ position: 'absolute', inset: 24, color: '#FFF4F9' }}>
        <div style={{ fontSize: 11, letterSpacing: 3, opacity: .86 }}>REFERENCE / MATERIAL</div>
        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 10 }}>灵感，放进画面</div>
        <div style={{ position: 'absolute', left: 0, top: 85, width: 300, height: 190,
          borderRadius: 15, overflow: 'hidden', background: '#161A20' }}>
          {frame < 120 ? <Img src={image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Sequence from={120} layout="none"><OffthreadVideo src={insetSource} muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></Sequence>}
        </div>
        <div style={{ position: 'absolute', top: 298, fontSize: 14, opacity: .9 }}>
          {frame < 120 ? '01 / 图片素材' : '02 / 视频素材 · 静音'}
        </div>
        <div style={{ position: 'absolute', top: 322, fontSize: 11, opacity: .7 }}>圆角 · 半透明 · 背景模糊 · 柔和边缘光</div>
      </div>
    </GlassSurface> : null}
    {scene === 'keypoints' ? <svg width={WIDTH} height={HEIGHT}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {TEXT_CUES.map((cue, index) => {
        const state = sample(cue.start, cue.end, time, cue.x + 130, cue.y);
        if (!state) return null;
        return <React.Fragment key={index}>
          <StyledText geometry={{ lines: [{ text: cue.title, x: cue.x, baseline: cue.y }],
            fontSize: cue.fontSize, color: '#FFFFFF', fontWeight: 800, shadowBlur: 10,
            shadowColor: '#000000', shadowOpacity: .28 }} frameStyle={state} />
          <StyledText geometry={{ lines: [{ text: cue.tag, x: cue.x + 2, baseline: cue.y - 64 }],
            fontSize: 10, letterSpacing: 2, color: index ? '#88BBD8' : '#ECB6CC', fontWeight: 600 }} frameStyle={state} />
          <StyledText geometry={{ lines: [{ text: cue.subtitle, x: cue.x + 2, baseline: cue.y + 34 }],
            fontSize: 18, color: '#F0F0F3', fontWeight: 600 }} frameStyle={state} />
        </React.Fragment>;
      })}
    </svg> : null}
    <div style={{ position: 'absolute', left: 24, bottom: 20, fontSize: 11,
      color: '#BCC2CD', letterSpacing: .8 }}>SRT / REMOTION · 视觉试做 · 人工配置</div>
  </AbsoluteFill>;
}
