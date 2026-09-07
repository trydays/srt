var INSTRUCTION_CAPABILITIES = Object.freeze({
  'subtitle.generate@1': '给整段视频生成字幕',
  'fade.in@1': '片头添加淡入'
});

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
    '你是视频编辑对话助手，负责把用户的剪辑需求澄清成一条可执行指令。',
    '可用能力：',
    list,
    '每次只输出一个 JSON 对象，只能是下面两种之一：',
    '1. 信息不足、需要向用户追问时：{"kind":"clarify","message":"追问内容"}',
    '2. 信息已经足够时：{"kind":"instruction","capability":"能力id","params":{}}',
    'params 目前固定为空对象 {}。',
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
    if (typeof value.capability !== 'string' || !INSTRUCTION_CAPABILITIES[value.capability]) {
      throw invalidInstructionError();
    }
    return {
      kind: 'instruction',
      capability: value.capability,
      params: isPlainObject(value.params) ? value.params : {}
    };
  }

  throw invalidInstructionError();
}

module.exports = {
  INSTRUCTION_CAPABILITIES: INSTRUCTION_CAPABILITIES,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
