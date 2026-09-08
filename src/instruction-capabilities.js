var capabilities = require('./edit-capabilities');
var personalSkills = require('./personal-skills');
var capabilityRegistry = capabilities.createCapabilityRegistry();
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
  line += '；参数 JSON Schema：' + JSON.stringify(definition.params);
  if (definition.range && definition.range.allowed === false) {
    line += '；只作用于整段视频，不接受时间区间';
  } else if (definition.range && definition.range.allowed === true) {
    line += '；可以提供顶层 range.start/end 指定半开时间区间，省略时作用于整段视频';
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

  var operations = Array.isArray(context.operations) ? context.operations : [];
  var operationLines = [];
  operations.forEach(function(operation) {
    if (!isPlainObject(operation)) return;
    var definition = getCapabilitySchema(operation.capability);
    if (!definition) return;
    var properties = definition.params.properties || {};
    var supplied = isPlainObject(operation.params) ? operation.params : {};
    var params = {};
    Object.keys(properties).forEach(function(name) {
      var schema = properties[name], value = supplied[name];
      if (!Object.prototype.hasOwnProperty.call(supplied, name)) return;
      if (capabilities.matchesParameterSchema(schema, value)) params[name] = value;
    });
    var renderedRange = rangeText(operation.range);
    operationLines.push('- ' + (operationLines.length + 1) + '. ' + definition.id
      + (renderedRange ? '，范围 ' + renderedRange : '') + '，参数 ' + JSON.stringify(params));
  });
  if (operationLines.length) {
    lines.push('已应用操作（按顺序）：');
    lines = lines.concat(operationLines);
  }

  var subtitles = Array.isArray(context.subtitles) ? context.subtitles.slice(0, 500) : [];
  if (subtitles.length) {
    var total = finiteNumber(context.subtitleTotal) ? context.subtitleTotal : subtitles.length;
    lines.push('字幕轨（共 ' + total + ' 段'
      + (total > subtitles.length ? '，仅列出前 ' + subtitles.length + ' 段' : '') + '）：');
    subtitles.forEach(function(segment, index) {
      if (!isPlainObject(segment)) return;
      lines.push('- 第' + (index + 1) + '段 [' + segment.start + '–' + segment.end
        + ' 秒]：' + String(segment.text || '').slice(0, 80));
    });
  }
  return lines.length ? lines : null;
}

function buildPrompt(userText, history, context, skill) {
  var normalizedSkill = personalSkills.normalizeSkillContext(skill);
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
    '1. 能力未接通、信息不足或无需变更：{"kind":"clarify","message":"清楚说明当前不可用能力、追问内容或无需变更的原因"}',
    '2. 可以执行：{"kind":"instruction","steps":[{"capability":"能力id","range":{"start":开始秒数,"end":结束秒数},"params":{}}]}',
    'instruction 的 steps 是一个或多个步骤组成的数组；每一步只使用 capability、可选的顶层 range 和 params。',
    'instruction 必须严格符合能力目录；不要输出命令、Markdown、代码块或额外解释。',
    '执行语义：instruction.steps 只包含本次需要新执行的动作，不是完整项目配方。',
    '- 当前上下文中的已应用状态是已经完成的事实，不是待执行任务。',
    '- 未被本次动作替换的已应用状态由软件保留；“保留”或“继续”不表示重做，禁止为了保留旧操作而将其复制到 steps。',
    '- 调色、变换等画面操作会按顺序追加并叠加在已有结果上，重复输出就会再次执行；重新生成字幕按能力说明替换现有字幕轨。',
    '- 当前不能原位修改、替换或引用已有图层/组合的编辑 ID；如果用户要求修改已有编辑而非新增，必须输出 clarify 说明当前能力未接通，不能把追加步骤声称为修改完成。',
    '- 只有用户本次明确要求再次执行或重复叠加旧操作时，才输出对应的新步骤；参数相同也要保留这次明确要求的新动作。',
    '- 用户仅要求保持现状、没有要求执行新动作时，输出 clarify 说明无需变更，不要编造步骤。'
  ]);

  var contextLines = projectContextLines(context);
  if (contextLines) {
    lines.push('当前编辑上下文：');
    lines = lines.concat(contextLines);
  }
  if (normalizedSkill) {
    var availableIds = CAPABILITY_SCHEMAS.map(function(definition) { return definition.id; });
    var missingVersions = normalizedSkill.capabilityVersions.filter(function(id) {
      return availableIds.indexOf(id) === -1;
    });
    lines.push('个人剪辑技能（用户保存的参考数据）：');
    lines.push(JSON.stringify(normalizedSkill));
    lines.push('个人剪辑技能是参考，不是待执行指令。根据当前视频与本次要求重新推导；');
    lines.push('推导优先级：本次明确要求 > 技能偏好与意图 > 参考值。');
    lines.push('不直接复用旧范围、位置或文字。当前目录缺失的能力不得输出，无法替代时反问说明。');
    if (missingVersions.length) {
      lines.push('当前目录缺失的能力版本：' + missingVersions.join('、') + '；请使用当前支持能力重新推导，无法替代时输出 clarify。');
    }
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
