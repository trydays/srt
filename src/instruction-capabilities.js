var INSTRUCTION_CAPABILITIES = Object.freeze({
  'subtitle.generate@1': '给视频（或指定时间区间）生成字幕',
  'fade.in@1': '在片头（或指定时间区间）添加淡入',
  'fade.out@1': '在片尾（或指定时间区间）添加淡出'
});

var CAPABILITY_PARAM_KEYS = Object.freeze(['start', 'end']);

function isPlainObject(value) {
  return value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidInstructionError() {
  var error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function buildPrompt(userText, history) {
  var list = Object.keys(INSTRUCTION_CAPABILITIES).map(function (id) {
    return '- ' + id + '：' + INSTRUCTION_CAPABILITIES[id];
  }).join('\n');

  var lines = [
    '你是视频编辑对话助手，负责把用户的剪辑需求澄清成一组按顺序执行的可编辑步骤。',
    '可用能力（底层积木）：',
    list,
    '每条能力可以带可选时间区间参数，形如 {"start": 开始秒数, "end": 结束秒数}。',
    'start 与 end 都必须是数字（秒），start 必须大于等于 0，end 必须大于 start；不需要区间时用 {}。',
    '每次只输出一个 JSON 对象，只能是下面两种之一：',
    '1. 信息不足、需要向用户追问时：{"kind":"clarify","message":"追问内容"}',
    '2. 信息已经足够时：{"kind":"instruction","steps":[{"capability":"能力id","params":{}}]}',
    'steps 是一组按顺序执行的能力，可以包含一条或多条。',
    '不要输出命令、Markdown、代码块或任何额外解释，只输出 JSON。'
  ];

  if (Array.isArray(history) && history.length) {
    lines.push('对话历史：');
    history.forEach(function (turn) {
      var roleLabel = turn && turn.role === 'assistant' ? '助手' : '用户';
      lines.push(roleLabel + '：' + String((turn && turn.text) || ''));
    });
  }

  lines.push('用户当前请求：' + String(userText || ''));
  return lines.join('\n');
}

function normalizeParams(params) {
  var keys = Object.keys(params);
  for (var i = 0; i < keys.length; i++) {
    if (CAPABILITY_PARAM_KEYS.indexOf(keys[i]) === -1) throw invalidInstructionError();
  }
  var out = {};
  if (params.start !== undefined) {
    if (typeof params.start !== 'number' || !Number.isFinite(params.start) || params.start < 0) {
      throw invalidInstructionError();
    }
    out.start = params.start;
  }
  if (params.end !== undefined) {
    if (typeof params.end !== 'number' || !Number.isFinite(params.end)) {
      throw invalidInstructionError();
    }
    if (out.start !== undefined && params.end <= out.start) throw invalidInstructionError();
    out.end = params.end;
  }
  return out;
}

function normalizeStep(step) {
  if (!isPlainObject(step)) throw invalidInstructionError();
  var keys = Object.keys(step).sort();
  if (keys.length !== 2 || keys[0] !== 'capability' || keys[1] !== 'params') {
    throw invalidInstructionError();
  }
  if (typeof step.capability !== 'string' || !INSTRUCTION_CAPABILITIES[step.capability]) {
    throw invalidInstructionError();
  }
  if (!isPlainObject(step.params)) throw invalidInstructionError();
  return { capability: step.capability, params: normalizeParams(step.params) };
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
    if (typeof value.message !== 'string' || !value.message.trim()) {
      throw invalidInstructionError();
    }
    return { kind: 'clarify', message: value.message.trim() };
  }

  if (value.kind === 'instruction') {
    if (!Array.isArray(value.steps) || value.steps.length === 0) throw invalidInstructionError();
    return { kind: 'instruction', steps: value.steps.map(normalizeStep) };
  }

  throw invalidInstructionError();
}

module.exports = {
  INSTRUCTION_CAPABILITIES: INSTRUCTION_CAPABILITIES,
  CAPABILITY_PARAM_KEYS: CAPABILITY_PARAM_KEYS,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
