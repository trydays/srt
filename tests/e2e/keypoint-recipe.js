module.exports = async function keypointRecipe(text, context) {
  if (text === '超长字幕反问' && (!context || !context.transcript)) {
    return { kind: 'prepare', resource: 'transcript', range: { start: 0, end: 1 } };
  }
  if (text === '超长字幕反问') return { kind: 'clarify', message: '请说明重点文字放哪侧。' };
  if (text === '超长左侧') return { kind: 'instruction', steps: [{ capability: 'visual.group@1',
    range: { start: 0.2, end: 0.8 }, params: { layers: [{ kind: 'text', params: { text: '窄范围重点' } }] } }] };
  if (text === '普通整段文字') return {kind:'instruction',steps:[{capability:'visual.group@1',params:{layers:[
    {kind:'text',params:{text:'普通文字'}}]}}]};
  if (text === '重复准备') return {kind:'prepare',resource:'transcript',range:{start:0,end:4}};
  if (!context || !context.transcript) {
    return { kind: 'prepare', resource: 'transcript', range: { start: 0, end: 4 } };
  }
  if (text === '越界要点') return { kind: 'instruction', steps: [{ capability: 'visual.group@1',
    range: { start: 3.8, end: 4.2 }, params: { layers: [{ kind: 'text', params: { text: '越界' } }] } }] };
  if (text === '延迟准备') await new Promise(resolve => setTimeout(resolve, 250));
  if (text === '准备后反问') return { kind: 'clarify', message: '请说明希望重点文字偏左还是偏右。' };
  return { kind: 'instruction', steps: [
    { capability: 'visual.group@1', range: { start: 0.2, end: 1.4 }, params: {
      layers: [
        { kind: 'shape', params: { x: 0.06, y: 0.16, width: 0.38, height: 0.22,
          color: '#24182D', cornerRadius: 0.12, fillOpacity: 0.82 } },
        { kind: 'text', params: { text: '先确定目标', x: 0.09, y: 0.2, fontSize: 0.065,
          color: '#FFFFFF', fontWeight: 700 } },
        { kind: 'text', params: { text: '再选择最合适的行动', x: 0.09, y: 0.29, fontSize: 0.035,
          color: '#F4DFF7', fontWeight: 400 } }
      ], opacity: { keyframes: [{ time: 0, value: 0 }, { time: 0.2, value: 1, easing: 'ease-out' }] }
    } },
    { capability: 'visual.group@1', range: { start: 2, end: 3.5 }, params: {
      layers: [
        { kind: 'shape', params: { x: 0.57, y: 0.18, width: 0.36, height: 0.2,
          color: '#24182D', cornerRadius: 0.12, fillOpacity: 0.82 } },
        { kind: 'text', params: { text: '持续复盘', x: 0.61, y: 0.23, fontSize: 0.065,
          color: '#FFFFFF', fontWeight: 700 } },
        { kind: 'text', params: { text: '让结果指导下一步', x: 0.61, y: 0.31, fontSize: 0.035,
          color: '#F4DFF7', fontWeight: 400 } }
      ], scale: { keyframes: [{ time: 0, value: 0.8 }, { time: 0.24, value: 1, easing: 'back-out' }] }
    } }
  ] };
};
