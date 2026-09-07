var capabilityRegistry = require('./edit-capabilities').createCapabilityRegistry();
var CAPABILITY_SCHEMAS = capabilityRegistry.promptDefinitions();

var SCHEMA_BY_ID = (function() {
  var byId = Object.create(null);
  CAPABILITY_SCHEMAS.forEach(function(definition) {
    byId[definition.id] = definition;
  });
  return byId;
})();

function getCapabilitySchema(id) {
  return SCHEMA_BY_ID[id] || null;
}

function isPlainObject(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  var prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidInstructionError() {
  var error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function rangeText(range) {
  if (!isPlainObject(range) || !finiteNumber(range.start) || !finiteNumber(range.end)) return null;
  return '[' + range.start + '–' + range.end + ' 秒]';
}

function capabilityLine(definition) {
  var line = '- ' + definition.id + '：' + definition.description;
  var propertyNames = Object.keys(definition.params.properties || {});
  if (propertyNames.length) line += '；参数：' + propertyNames.join('、');
  if (definition.range && definition.range.allowed === false) {
    line += '；只作用于整段视频，不接受时间区间';
  }
  return line;
}

function projectContextLines(context) {
  if (!isPlainObject(context)) return null;
  var lines = [];
  if (Number.isInteger(context.revision) && context.revision >= 0) {
    lines.push('当前 revision：' + context.revision);
  }

  var video = isPlainObject(context.video) ? context.video : null;
  if (video && finiteNumber(video.durationSeconds)) {
    lines.push('视频总时长：' + video.durationSeconds + ' 秒');
  }
  if (video && finiteNumber(video.width) && finiteNumber(video.height)) {
    lines.push('视频分辨率：' + video.width + 'x' + video.height);
  }
  if (finiteNumber(context.playheadSeconds)) {
    lines.push('播放头位置：' + context.playheadSeconds + ' 秒');
  }

  var edits = Array.isArray(context.edits) ? context.edits : [];
  var editLines = [];
  edits.forEach(function(edit, index) {
    if (!isPlainObject(edit) || typeof edit.id !== 'string' || !edit.id
        || typeof edit.type !== 'string' || !edit.type) return;
    var renderedRange = rangeText(edit.range);
    editLines.push('- ' + (index + 1) + '. ' + edit.id + '，' + edit.type
      + (renderedRange ? '，范围 ' + renderedRange : ''));
  });
  if (editLines.length) {
    lines.push('已应用编辑（按顺序）：');
    lines = lines.concat(editLines);
  }

  var subtitles = Array.isArray(context.subtitles) ? context.subtitles : [];
  if (subtitles.length) {
    var total = finiteNumber(context.subtitleTotal) ? context.subtitleTotal : subtitles.length;
    lines.push('字幕轨（共 ' + total + ' 段'
      + (total > subtitles.length ? '，仅列出前 ' + subtitles.length + ' 段' : '') + '）：');
    subtitles.forEach(function(segment, index) {
      if (!isPlainObject(segment)) return;
      lines.push('- 第' + (index + 1) + '段 [' + segment.start + '–' + segment.end
        + ' 秒]：' + String(segment.text || ''));
    });
  }
  return lines.length ? lines : null;
}

function buildPrompt(userText, history, context) {
  var lines = [
    '你是视频剪辑配方推导器。',
    '推导方法：先把用户目标拆解成独立的底层画面变化，再逐项检查“当前可用能力”。',
    '- 只能输出目录中明确存在的能力，不得猜测、创造或映射未列出的效果能力。',
    '- 当前目录无法完成用户目标时，必须输出 clarify，并明确说明“当前能力未接通”；不要承诺能够执行。',
    '当前可用能力：'
  ];
  CAPABILITY_SCHEMAS.forEach(function(definition) {
    lines.push(capabilityLine(definition));
  });
  lines = lines.concat([
    '每次只输出一个 JSON 对象，只能是下面两种之一：',
    '1. 能力未接通或信息不足：{"kind":"clarify","message":"清楚说明当前不可用能力或追问内容"}',
    '2. 可以执行：{"kind":"instruction","steps":[{"capability":"能力id","params":{}}]}',
    'instruction 必须严格符合能力目录；不要输出命令、Markdown、代码块或额外解释。'
  ]);

  var contextLines = projectContextLines(context);
  if (contextLines) {
    lines.push('当前编辑上下文：');
    lines = lines.concat(contextLines);
  }
  if (Array.isArray(history) && history.length) {
    lines.push('对话历史：');
    history.forEach(function(turn) {
      lines.push(turn && turn.role === 'assistant' ? '助手：' + String(turn.text || '')
        : '用户：' + String((turn && turn.text) || ''));
    });
  }
  lines.push('用户当前请求：' + String(userText || ''));
  return lines.join('\n');
}

function parseInstruction(output) {
  var value;
  try {
    value = JSON.parse(String(output).trim());
  } catch (_) {
    throw invalidInstructionError();
  }
  if (!isPlainObject(value)) throw invalidInstructionError();

  if (value.kind === 'clarify') {
    if (Object.keys(value).length !== 2 || typeof value.message !== 'string' || !value.message.trim()) {
      throw invalidInstructionError();
    }
    return { kind: 'clarify', message: value.message.trim() };
  }

  try {
    return capabilityRegistry.validateRecipe(value);
  } catch (_) {
    throw invalidInstructionError();
  }
}

module.exports = {
  CAPABILITY_SCHEMAS: CAPABILITY_SCHEMAS,
  getCapabilitySchema: getCapabilitySchema,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
