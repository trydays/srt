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

function buildPrompt(userText) {
  var list = Object.keys(INSTRUCTION_CAPABILITIES).map(function (id) {
    return '- ' + id + '：' + INSTRUCTION_CAPABILITIES[id];
  }).join('\n');
  return [
    '你是视频编辑指令解析器，把用户请求映射为下列能力之一。',
    '可用能力：',
    list,
    '只输出一个 JSON 对象：{"capability":"<能力id>","params":{}}；',
    '无法匹配时输出 {"capability":null}。',
    '不要输出命令、Markdown 或解释。',
    '用户请求：' + String(userText || '')
  ].join('\n');
}

function parseInstruction(output) {
  var value;
  try {
    value = JSON.parse(String(output).trim());
  } catch (_) {
    throw invalidInstructionError();
  }
  if (!isPlainObject(value)) throw invalidInstructionError();
  if (value.capability === null || value.capability === undefined) {
    return { capability: null };
  }
  if (typeof value.capability !== 'string' || !INSTRUCTION_CAPABILITIES[value.capability]) {
    throw invalidInstructionError();
  }
  return { capability: value.capability, params: isPlainObject(value.params) ? value.params : {} };
}

module.exports = {
  INSTRUCTION_CAPABILITIES: INSTRUCTION_CAPABILITIES,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
