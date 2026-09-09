'use strict';

const { parseInstruction } = require('../../src/instruction-capabilities');

module.exports = function cardStyleRecipe(text, context) {
  const portrait = context.video.height > context.video.width;
  const slots = portrait
    ? [[.08, .08], [.53, .08], [.08, .32], [.53, .32]]
    : [[.03, .12], [.28, .12], [.53, .12], [.78, .12]];
  const size = portrait ? [.39, .16] : [.19, .23];
  const cards = slots.map(([x, y], index) => ({
    capability: 'visual.group@1',
    range: { start: .5 + index * .25, end: 2.8 + index * .1 },
    params: {
      layers: [
        { kind: 'shape', params: index === 3
          ? { x, y, width: size[0], height: size[1], color: '#CC3322', cornerRadius: .18,
            borderWidth: .08, borderColor: '#22CC88', fillOpacity: 0 }
          : { x, y, width: size[0], height: size[1], color: '#CC3322', cornerRadius: .18,
            borderWidth: .08, borderColor: '#268AFF', fillOpacity: .5 } },
        { kind: 'text', params: { text: `卡片${index + 1}`, x: x + .025, y: y + .055,
          fontSize: portrait ? .035 : .04, color: '#FFFFFF' } }
      ], pivotX: x + size[0] / 2, pivotY: y + size[1] / 2
    }
  }));
  // An omitted-style shape is deliberately retained as the compatibility fixture.
  cards.push({ capability: 'visual.shape@1', range: { start: .5, end: 2.8 },
    params: { x: .03, y: portrait ? .57 : .48, width: .12, height: .08, color: '#8844AA' } });

  const instruction = /第二请求/.test(text)
    ? { kind: 'instruction', steps: [{ capability: 'visual.group@1', range: { start: 3.1, end: 3.8 }, params: {
      layers: [
        { kind: 'shape', params: { x: .2, y: .7, width: .6, height: .14, color: '#16324F',
          cornerRadius: .3, borderWidth: .06, borderColor: '#FFCC33', fillOpacity: .8 } },
        { kind: 'text', params: { text: '第二请求 · 新样式', x: .26, y: .735,
          fontSize: .04, color: '#FFFFFF' } }
      ]
    } }] }
    : { kind: 'instruction', steps: cards };
  return parseInstruction(JSON.stringify(instruction));
};
