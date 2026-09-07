var CAPABILITY_SCHEMAS = Object.freeze([
  Object.freeze({
    id: 'subtitle.generate@1',
    description: '给视频（或指定时间区间）生成字幕',
    timing: true,
    params: Object.freeze({})
  }),
  Object.freeze({
    id: 'fade.in@1',
    description: '画面从黑场淡入（或指定时间区间淡入）',
    timing: true,
    params: Object.freeze({})
  }),
  Object.freeze({
    id: 'fade.out@1',
    description: '画面淡出到黑场（或指定时间区间淡出）',
    timing: true,
    params: Object.freeze({})
  }),
  Object.freeze({
    id: 'color.grade@1',
    description: '调整画面整体色调',
    timing: true,
    params: Object.freeze({
      warmth: Object.freeze({
        type: 'number', min: -1, max: 1, default: 0,
        description: '正值偏暖色，负值偏冷色'
      }),
      saturation: Object.freeze({
        type: 'number', min: 0, max: 2, default: 1,
        description: '1 为原饱和度，0 为黑白，大于 1 更鲜艳'
      }),
      contrast: Object.freeze({
        type: 'number', min: 0, max: 2, default: 1,
        description: '1 为原对比度，大于 1 更强，小于 1 更柔和'
      })
    })
  }),
  Object.freeze({
    id: 'texture.grain@1',
    description: '叠加胶片颗粒质感',
    timing: true,
    params: Object.freeze({
      amount: Object.freeze({
        type: 'number', min: 0, max: 1, default: 0,
        description: '0 无颗粒，1 颗粒最强'
      })
    })
  }),
  Object.freeze({
    id: 'vignette@1',
    description: '为画面四周添加暗角',
    timing: true,
    params: Object.freeze({
      strength: Object.freeze({
        type: 'number', min: 0, max: 1, default: 0,
        description: '0 无暗角，1 暗角最强'
      })
    })
  })
]);

var SCHEMA_BY_ID = (function () {
  var map = {};
  for (var i = 0; i < CAPABILITY_SCHEMAS.length; i++) {
    map[CAPABILITY_SCHEMAS[i].id] = CAPABILITY_SCHEMAS[i];
  }
  return map;
})();

function getCapabilitySchema(id) {
  return SCHEMA_BY_ID[id] || null;
}

function describeParam(key, spec) {
  var range = typeof spec.min === 'number' ? ' ' + spec.min + '~' + spec.max : '';
  return key + '(' + spec.type + range + ', 默认 ' + spec.default + ')：' + spec.description;
}

function capabilityLine(schema) {
  var ownParams = Object.keys(schema.params).map(function (key) {
    return describeParam(key, schema.params[key]);
  });
  var text = '- ' + schema.id + '：' + schema.description;
  if (ownParams.length) text += '；参数：' + ownParams.join('，');
  if (schema.timing) text += '；可带 start/end 时间区间（秒）';
  return text;
}

function isPlainObject(value) {
  return value && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidInstructionError() {
  var error = new Error('Invalid local CLI instruction output');
  error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
  return error;
}

function projectContextLines(context) {
  if (!isPlainObject(context)) return null;
  var lines = [];
  var video = isPlainObject(context.video) ? context.video : null;
  if (video && typeof video.durationSeconds === 'number' && Number.isFinite(video.durationSeconds)) {
    lines.push('视频总时长：' + video.durationSeconds + ' 秒');
  }
  if (video && typeof video.width === 'number' && Number.isFinite(video.width)
      && typeof video.height === 'number' && Number.isFinite(video.height)) {
    lines.push('视频分辨率：' + video.width + 'x' + video.height);
  }
  if (typeof context.playheadSeconds === 'number' && Number.isFinite(context.playheadSeconds)) {
    lines.push('播放头位置：' + context.playheadSeconds + ' 秒');
  }

  var operations = Array.isArray(context.operations) ? context.operations : [];
  if (operations.length) {
    lines.push('已执行编辑命令（按执行顺序）：');
    operations.forEach(function (operation, index) {
      if (!operation || typeof operation.capability !== 'string') return;
      var params = isPlainObject(operation.params) ? operation.params : {};
      var values = Object.keys(params).map(function (key) {
        return key + ':' + params[key];
      });
      lines.push('- ' + (index + 1) + '. ' + operation.capability + '，参数 ' + (values.length ? '{' + values.join(', ') + '}' : '{}'));
    });
  }

  var subtitles = Array.isArray(context.subtitles) ? context.subtitles : [];
  if (subtitles.length) {
    var total = typeof context.subtitleTotal === 'number' ? context.subtitleTotal : subtitles.length;
    lines.push('字幕轨（共 ' + total + ' 段' + (total > subtitles.length ? '，仅列出前 ' + subtitles.length + ' 段' : '') + '）：');
    subtitles.forEach(function (segment) {
      if (!segment) return;
      var start = typeof segment.start === 'number' ? segment.start : 0;
      var end = typeof segment.end === 'number' ? segment.end : 0;
      lines.push('- 第' + segment.index + '段 [' + start + '–' + end + ' 秒]：' + String(segment.text || ''));
    });
  }

  return lines.length ? lines : null;
}

function buildPrompt(userText, history, context) {
  var lines = [
    '你是视频剪辑配方推导器。把用户想要的效果实时拆解成底层能力的有序组合，不要输出“预设效果名”。',
    '推导规则：',
    '- 先判断这个效果由哪些底层画面变化构成，再选择能力；一个能力只负责一种变化。',
    '- 颜色变化优先选 color.grade@1；颗粒质感选 texture.grain@1；暗角选 vignette@1；明暗过渡选 fade.in@1/fade.out@1；需要画面文字时选 subtitle.generate@1。',
    '- 必须只使用下面“可用能力（底层积木）”中列出的 id；没有合适能力时输出 clarify 追问，不要创建新的能力。',
    '- 一个步骤只能调用一个能力，只能输出该能力声明过的参数；没有把握的强度参数就用能力声明的默认值，不要写。',
    '- 需要限定作用时间时，只使用 start/end（数字秒，start 大于等于 0，end 大于 start）；不限定就不写。',
    '- 多个步骤按实际施加顺序排列：先发生的在前，整体过渡（如淡出）放最后。',
    '可用能力（底层积木）：'
  ];

  for (var i = 0; i < CAPABILITY_SCHEMAS.length; i++) {
    lines.push(capabilityLine(CAPABILITY_SCHEMAS[i]));
  }

  lines = lines.concat([
    '每次只输出一个 JSON 对象，只能是下面两种之一：',
    '1. 信息不足、需要向用户追问时：{"kind":"clarify","message":"追问内容"}',
    '2. 信息已经足够时：{"kind":"instruction","steps":[{"capability":"能力id","params":{}}]}',
    'steps 是一组按顺序执行的能力，可以包含一条或多条。',
    '不要输出命令、Markdown、代码块或任何额外解释，只输出 JSON。'
  ]);

  var contextLines = projectContextLines(context);
  var hasOperationContext = Array.isArray(context && context.operations) && context.operations.length > 0;
  var hasSubtitleContext = Array.isArray(context && context.subtitles) && context.subtitles.length > 0;
  if (contextLines) {
    lines.push('当前编辑上下文：');
    lines = lines.concat(contextLines);
    lines.push('- 能根据上面编辑上下文确定的时间与参数就直接推导；只有上下文确实无法确定时才输出 clarify 追问。');
    if (hasOperationContext || hasSubtitleContext) {
      lines.push('- 新的编辑命令会叠加在“已执行编辑命令”与当前字幕轨之上；同区间同能力先判断是叠加、替换还是撤销，无法确定才追问。');
    }
  }

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

function validateNumericValue(key, value, spec) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidInstructionError();
  }
  if (typeof spec.min === 'number' && value < spec.min) throw invalidInstructionError();
  if (typeof spec.max === 'number' && value > spec.max) throw invalidInstructionError();
}

function normalizeParams(schema, params) {
  if (!isPlainObject(params)) throw invalidInstructionError();
  var allowed = {};
  Object.keys(schema.params).forEach(function (key) { allowed[key] = true; });
  if (schema.timing) {
    allowed.start = true;
    allowed.end = true;
  }
  Object.keys(params).forEach(function (key) {
    if (!allowed[key]) throw invalidInstructionError();
  });

  var out = {};
  Object.keys(schema.params).forEach(function (key) {
    if (params[key] === undefined) return;
    validateNumericValue(key, params[key], schema.params[key]);
    out[key] = params[key];
  });

  if (schema.timing) {
    if (params.start !== undefined) {
      validateNumericValue('start', params.start, { min: 0 });
      out.start = params.start;
    }
    if (params.end !== undefined) {
      validateNumericValue('end', params.end, { min: 0 });
      out.end = params.end;
    }
    if (out.start !== undefined && out.end !== undefined && out.end <= out.start) {
      throw invalidInstructionError();
    }
  }
  return out;
}

function normalizeStep(step) {
  if (!isPlainObject(step)) throw invalidInstructionError();
  var keys = Object.keys(step).sort();
  if (keys.length !== 2 || keys[0] !== 'capability' || keys[1] !== 'params') {
    throw invalidInstructionError();
  }
  var schema = getCapabilitySchema(step.capability);
  if (!schema) throw invalidInstructionError();
  return {
    capability: step.capability,
    params: normalizeParams(schema, step.params)
  };
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
  CAPABILITY_SCHEMAS: CAPABILITY_SCHEMAS,
  getCapabilitySchema: getCapabilitySchema,
  buildPrompt: buildPrompt,
  parseInstruction: parseInstruction
};
