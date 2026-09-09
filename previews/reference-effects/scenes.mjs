// Visual fixtures only. These words and colors are never sent to the AI prompt.
export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;
export const SCENES = {
  glass: { id: 'GlassCardReference', durationInFrames: 240, title: '粉色毛玻璃素材卡片' },
  keypoints: { id: 'KeypointTextReference', durationInFrames: 420, title: '语义重点文字' }
};

export const GLASS = {
  x: 52, y: 140, width: 350, height: 396, cornerRadius: 26,
  color: '#F6AACB', fillOpacity: .22, backdropBlur: 18,
  borderWidth: 1.1, borderColor: '#F9D4E4', glowColor: '#F6AACB', glowOpacity: .4, glowBlur: 24
};

export const TEXT_CUES = [
  { start: .35, end: 8, x: 65, y: 320, title: 'Team-OK.',
    subtitle: '适合大团队、大公司', tag: 'FOR THE TEAM', fontSize: 55 },
  { start: 7.7, end: 13.85, x: 979, y: 350, title: '也行？',
    subtitle: '哥们就一个人', tag: 'ONE PERSON, TOO', fontSize: 61 }
];

export function groupAnimation(start, end, pivotX, pivotY) {
  const duration = end - start;
  return {
    layers: [{ kind: 'shape', params: { color: '#000000' } }], pivotX, pivotY,
    opacity: { keyframes: [{ time: 0, value: 0 },
      { time: .3, value: 1, easing: 'ease-out' }, { time: duration - .3, value: 1 },
      { time: duration, value: 0 }] },
    scale: { keyframes: [{ time: 0, value: .96 },
      { time: .42, value: 1, easing: 'ease-out' }] }
  };
}
