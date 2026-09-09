'use strict';

module.exports = function recipe(_text, context) {
  const video = context && context.video;
  const portrait = Boolean(video && video.height > video.width);
  const range = { start: 1, end: 3.5 };
  const independentShape = portrait
    ? { x: .07, y: .08, width: .86, height: .15, color: '#159B76' }
    : { x: .05, y: .1, width: .34, height: .2, color: '#159B76' };
  const independentText = portrait
    ? { text: '竖屏八项编辑\n固定配方', x: .12, y: .11, fontSize: .045, color: '#FFFFFF' }
    : { text: '横屏八项编辑\n固定配方', x: .09, y: .14, fontSize: .045, color: '#FFFFFF' };
  const groupShape = portrait
    ? { x: .08, y: .3, width: .84, height: .16, color: '#C84B31' }
    : { x: .56, y: .1, width: .38, height: .2, color: '#C84B31' };
  const groupText = portrait
    ? { text: '混合效果', x: .2, y: .345, fontSize: .052, color: '#FFFFFF' }
    : { text: '混合效果', x: .61, y: .155, fontSize: .05, color: '#FFFFFF' };

  return { kind: 'instruction', steps: [
    { capability: 'video.color.adjust@1', range: { ...range },
      params: { temperature: .25, brightness: .08, saturation: .85, contrast: 1.1 } },
    { capability: 'video.transform@1', range: { ...range },
      params: { flipHorizontal: true } },
    { capability: 'video.noise@1', range: { ...range }, params: { amount: .3 } },
    { capability: 'video.vignette@1', range: { ...range }, params: { strength: .35 } },
    { capability: 'visual.shape@1', range: { ...range }, params: independentShape },
    { capability: 'visual.text@1', range: { ...range }, params: independentText },
    { capability: 'visual.group@1', range: { ...range }, params: {
      layers: [
        { kind: 'shape', params: groupShape },
        { kind: 'text', params: groupText }
      ],
      pivotX: portrait ? .5 : .75,
      pivotY: portrait ? .38 : .2,
      opacity: { keyframes: [{ time: 0, value: 0 }, { time: .4, value: 1, easing: 'ease-out' }] },
      scale: { keyframes: [{ time: 0, value: .85 }, { time: .4, value: 1, easing: 'back-out' }] }
    } },
    { capability: 'subtitle.generate@1', params: {} }
  ] };
};
