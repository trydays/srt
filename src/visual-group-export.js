const keyframes = require('./keyframes');
const visualGroup = require('./visual-group');
const visualLayers = require('./visual-layers');

function fail() {
  const error = new Error('EXPORT_INVALID_RECIPE');
  error.code = 'EXPORT_INVALID_RECIPE';
  throw error;
}

function unsupported() {
  const error = new Error('EXPORT_UNSUPPORTED_OPERATION');
  error.code = 'EXPORT_UNSUPPORTED_OPERATION';
  throw error;
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const sorted = expected.slice().sort();
  return keys.length === sorted.length
    && keys.every((key, index) => key === sorted[index]);
}

function normalizeInputs(step, stepIndex, media) {
  if (!plain(step) || !exactKeys(step, ['capability', 'params', 'range'])
      || step.capability !== 'visual.group@1' || !plain(step.range)
      || !exactKeys(step.range, ['start', 'end'])
      || typeof step.range.start !== 'number' || !Number.isFinite(step.range.start)
      || typeof step.range.end !== 'number' || !Number.isFinite(step.range.end)
      || step.range.start < 0 || step.range.end <= step.range.start
      || !Number.isSafeInteger(stepIndex) || stepIndex < 0 || !plain(media)
      || !Number.isSafeInteger(media.displayWidth) || media.displayWidth <= 0
      || !Number.isSafeInteger(media.displayHeight) || media.displayHeight <= 0) fail();
  let params;
  try {
    params = visualGroup.normalizeParams(step.params, step.range.end - step.range.start);
  } catch (_) {
    fail();
  }
  return { params, range: step.range };
}

function textFilename(stepIndex, layerIndex, lineIndex) {
  return `group-${stepIndex}-${layerIndex}-${lineIndex}.txt`;
}

function groupTextFiles(step, stepIndex, media) {
  const { params } = normalizeInputs(step, stepIndex, media);
  const files = [];
  params.layers.forEach((layer, layerIndex) => {
    if (layer.kind !== 'text') return;
    const geometry = visualLayers.geometry('text', layer.params,
      media.displayWidth, media.displayHeight);
    geometry.lines.forEach((line, lineIndex) => {
      if (line.text) files.push({
        filename: textFilename(stepIndex, layerIndex, lineIndex),
        text: line.text
      });
    });
  });
  return files;
}

function buildGroupFilter(step, stepIndex, media) {
  const normalized = normalizeInputs(step, stepIndex, media);
  const params = normalized.params;
  const range = normalized.range;
  if (typeof media.sampleAspectRatio !== 'string'
      || !/^\d+\/\d+$/.test(media.sampleAspectRatio)
      || media.sampleAspectRatio.split('/').some((part) => Number(part) <= 0)) fail();

  const branch = [
    'format=rgba',
    'drawbox=x=0:y=0:w=iw:h=ih:color=black@0:t=fill:replace=1'
  ];
  params.layers.forEach((layer, layerIndex) => {
    const geometry = visualLayers.geometry(layer.kind, layer.params,
      media.displayWidth, media.displayHeight);
    if (layer.kind === 'shape') {
      if (geometry.cornerRadius !== 0 || geometry.borderWidth !== 0
          || geometry.fillOpacity !== 1) unsupported();
      branch.push(`drawbox=x=${geometry.x}:y=${geometry.y}:w=${geometry.width}:h=${geometry.height}:color=0x${geometry.color.slice(1)}:t=fill:replace=1`);
      return;
    }
    geometry.lines.forEach((line, lineIndex) => {
      if (!line.text) return;
      branch.push(`drawtext=font='${visualLayers.FONT_FAMILY}':textfile=${textFilename(stepIndex, layerIndex, lineIndex)}:expansion=none:fontsize=${geometry.fontSize}:x=${line.x}:y=${line.baseline}:y_align=baseline:fontcolor=0x${geometry.color.slice(1)}`);
    });
  });

  let opacityExpression;
  let scaleExpression;
  try {
    opacityExpression = keyframes.expression(params.opacity, `(T-${range.start})`, 0, 1);
    scaleExpression = keyframes.expression(params.scale, `(t-${range.start})`, 0, 2);
  } catch (_) {
    fail();
  }
  branch.push('format=gbrap');
  branch.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityExpression})'`);
  branch.push('format=gbrap');
  branch.push(`scale=w='max(1,floor(iw*(${scaleExpression})+0.5))':h='max(1,floor(ih*(${scaleExpression})+0.5))':eval=frame:flags=bilinear`);
  branch.push(`setsar=${media.sampleAspectRatio}`);

  const base = `groupBase${stepIndex}`;
  const work = `groupWork${stepIndex}`;
  const scaled = `groupScaled${stepIndex}`;
  return `split=2[${base}][${work}];[${work}]${branch.join(',')}[${scaled}];`
    + `[${base}][${scaled}]overlay=x='floor(${params.pivotX}*(W-w)+0.5)'`
    + `:y='floor(${params.pivotY}*(H-h)+0.5)':eval=frame:format=rgb:alpha=straight`
    + `:enable='gte(t,${range.start})*lt(t,${range.end})*gt(${scaleExpression},0)'`;
}

module.exports = { buildGroupFilter, groupTextFiles };
