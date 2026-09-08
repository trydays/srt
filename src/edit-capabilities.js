(function(root, factory) {
  var renderRecipe = typeof module === 'object' && module.exports
    ? require('./render-recipe')
    : root && root.SRTRenderRecipe;
  var colorAdjustment = typeof module === 'object' && module.exports
    ? require('./color-adjustment')
    : root && root.SRTColorAdjustment;
  var videoTransform = typeof module === 'object' && module.exports
    ? require('./video-transform') : root && root.SRTVideoTransform;
  var api = factory(renderRecipe, colorAdjustment, videoTransform);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTEditCapabilities = api;
})(typeof window === 'undefined' ? null : window, function(renderRecipe, colorAdjustment, videoTransform) {
  'use strict';

  var SUBTITLE_STYLE = renderRecipe && renderRecipe.SUBTITLE_STYLE;
  var REQUIRED_ADAPTERS = [
    'prepare', 'toEdit', 'toGraph', 'toTimeline', 'preview', 'toExport'
  ];

  function codedError(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every(function(key) { return allowed.indexOf(key) !== -1; });
  }

  function isDataOnly(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value) && !isPlainObject(value)) return false;
    if (Object.getOwnPropertySymbols(value).length) return false;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) return false;
    seen.push(value);
    var names = Object.getOwnPropertyNames(value);
    if (Array.isArray(value)) {
      var keys = Object.keys(value);
      if (keys.length !== value.length || keys.some(function(key, index) {
        return key !== String(index);
      })) {
        seen.pop();
        return false;
      }
      names = keys;
    }
    var valid = names.every(function(name) {
      var descriptor = Object.getOwnPropertyDescriptor(value, name);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        && descriptor.enumerable && isDataOnly(descriptor.value, seen);
    });
    seen.pop();
    return valid;
  }

  function sameStyle(style) {
    if (!isPlainObject(style) || !SUBTITLE_STYLE) return false;
    var expectedKeys = Object.keys(SUBTITLE_STYLE).sort();
    var actualKeys = Object.keys(style).sort();
    return actualKeys.length === expectedKeys.length && actualKeys.every(function(key, index) {
      return key === expectedKeys[index] && style[key] === SUBTITLE_STYLE[key];
    });
  }

  function validateSubtitlePayload(payload, duration) {
    if (!isPlainObject(payload) || !hasOnlyKeys(payload, ['segments', 'style'])
        || Object.keys(payload).length !== 2 || !Array.isArray(payload.segments)
        || payload.segments.length === 0 || !sameStyle(payload.style)
        || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      throw codedError('SUBTITLE_INVALID_OUTPUT');
    }

    var ids = Object.create(null);
    var segments = payload.segments.map(function(segment) {
      if (!isPlainObject(segment) || !hasOnlyKeys(segment, ['id', 'start', 'end', 'text'])
          || Object.keys(segment).length !== 4
          || typeof segment.id !== 'string' || !segment.id || ids[segment.id]
          || typeof segment.start !== 'number' || !Number.isFinite(segment.start) || segment.start < 0
          || typeof segment.end !== 'number' || !Number.isFinite(segment.end)
          || segment.end <= segment.start || segment.end > duration + 0.001
          || typeof segment.text !== 'string' || !segment.text.trim()) {
        throw codedError('SUBTITLE_INVALID_OUTPUT');
      }
      ids[segment.id] = true;
      return {
        id: segment.id,
        start: segment.start,
        end: Math.min(segment.end, duration),
        text: segment.text.trim()
      };
    });

    return { segments: segments, style: clone(SUBTITLE_STYLE) };
  }

  function createSubtitleRegistration() {
    return {
      definition: {
        schemaVersion: 1,
        id: 'subtitle.generate@1',
        label: '生成字幕',
        description: '为整段视频生成可编辑字幕；重新生成时替换现有字幕轨',
        params: { type: 'object', additionalProperties: false, properties: {} },
        range: { allowed: false, default: 'wholeTarget' }
      },
      editMode: 'replaceByType',
      editType: 'subtitle.track@1',
      nodeType: 'visual.subtitle@1',
      graphStage: 'overlay',

      prepare: async function(_step, executionContext) {
        if (!executionContext || typeof executionContext.videoPath !== 'string'
            || !executionContext.videoPath.trim()) {
          throw codedError('VIDEO_PATH_UNAVAILABLE');
        }
        if (!executionContext || typeof executionContext.generateSubtitles !== 'function') {
          throw codedError('SUBTITLE_RUNTIME_NOT_READY');
        }
        var result = await executionContext.generateSubtitles({
          videoPath: executionContext.videoPath
        });
        if (!result || result.ok !== true || !Array.isArray(result.segments)) {
          throw codedError(result && typeof result.errorCode === 'string'
            ? result.errorCode : 'SUBTITLE_TRANSCRIPTION_FAILED');
        }
        return { segments: clone(result.segments) };
      },

      toEdit: function(prepared, step, context) {
        var idFactory = context && context.idFactory;
        if (!prepared || !Array.isArray(prepared.segments) || typeof idFactory !== 'function') {
          throw codedError('SUBTITLE_INVALID_OUTPUT');
        }
        var payload = {
          segments: prepared.segments.map(function(segment) {
            return {
              id: idFactory('subtitle-segment'),
              start: segment.start,
              end: segment.end,
              text: segment.text
            };
          }),
          style: clone(SUBTITLE_STYLE)
        };
        return {
          type: 'subtitle.track@1',
          range: clone(step.range),
          payload: validateSubtitlePayload(payload, context.duration)
        };
      },

      toGraph: function(edit, graphContext) {
        validateSubtitlePayload(edit.payload, graphContext.duration === undefined ? edit.range.end : graphContext.duration);
        return {
          id: 'node-' + edit.id,
          type: 'visual.subtitle@1',
          range: clone(edit.range),
          inputs: [{ port: 'base', nodeId: graphContext.videoHead }],
          props: clone(edit.payload)
        };
      },

      toTimeline: function(edit) {
        return {
          editId: edit.id,
          transactionId: edit.transactionId,
          lane: 'subtitle',
          range: clone(edit.range),
          label: '字幕',
          summary: edit.payload.segments.length + ' 段'
        };
      },

      preview: function(graph, time) {
        var nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
        var texts = [];
        nodes.forEach(function(node) {
          if (!node || node.type !== 'visual.subtitle@1' || !node.props
              || !Array.isArray(node.props.segments)) return;
          node.props.segments.forEach(function(segment) {
            if (time >= segment.start && time < segment.end) texts.push(segment.text);
          });
        });
        return { text: texts.join('\n'), visible: texts.length > 0 };
      },

      toExport: function(node) {
        return {
          capability: 'subtitle.burn@1',
          params: { segments: clone(node.props.segments) }
        };
      }
    };
  }

  function signed(value) {
    return value > 0 ? '+' + value : String(value);
  }

  function colorSummary(params) {
    return '色温 ' + signed(params.temperature) + '，亮度 ' + signed(params.brightness)
      + '，饱和度 ' + params.saturation + '，对比度 ' + params.contrast;
  }

  function createColorRegistration() {
    return {
      definition: {
        schemaVersion: 1,
        id: 'video.color.adjust@1',
        label: '画面调色',
        description: '调整画面的色温、亮度、饱和度和对比度',
        params: {
          type: 'object',
          additionalProperties: false,
          properties: colorAdjustment.PARAMETER_SCHEMA
        },
        range: { allowed: true, default: 'wholeTarget' }
      },
      editMode: 'append',
      editType: 'video.color.adjustment@1',
      nodeType: 'video.color@1',
      graphStage: 'sourceEffect',

      prepare: async function() { return {}; },

      toEdit: function(_prepared, step) {
        return {
          type: 'video.color.adjustment@1',
          range: clone(step.range),
          payload: colorAdjustment.normalizeParams(step.params, true)
        };
      },

      toGraph: function(edit, graphContext) {
        colorAdjustment.normalizeParams(edit.payload, false);
        return {
          id: 'node-' + edit.id,
          type: 'video.color@1',
          range: clone(edit.range),
          inputs: [{ port: 'base', nodeId: graphContext.videoHead }],
          props: clone(edit.payload)
        };
      },

      toTimeline: function(edit) {
        return {
          editId: edit.id,
          transactionId: edit.transactionId,
          lane: 'video-effect',
          range: clone(edit.range),
          label: '画面调色',
          summary: colorSummary(edit.payload)
        };
      },

      preview: function(graph, time) {
        return graph.nodes.filter(function(node) {
          return node.type === 'video.color@1'
            && colorAdjustment.isActive(node.range, time);
        }).map(function(node) {
          return colorAdjustment.normalizeParams(node.props, false);
        });
      },

      toExport: function(node) {
        return {
          capability: 'video.color.adjust@1',
          range: clone(node.range),
          params: colorAdjustment.normalizeParams(node.props, false)
        };
      }
    };
  }

  function createTransformRegistration() {
    return {
      definition: {
        schemaVersion: 1, id: 'video.transform@1', label: '画面变换',
        description: '水平或垂直翻转后居中等比缩放；至少提供一个参数，字幕保持原样',
        params: { type: 'object', additionalProperties: false, properties: videoTransform.PARAMETER_SCHEMA },
        range: { allowed: true, default: 'wholeTarget' }
      },
      editMode: 'append', editType: 'video.transform.operation@1',
      nodeType: 'video.transform@1', graphStage: 'sourceEffect',
      prepare: async function() { return {}; },
      toEdit: function(_prepared, step) {
        return { type: 'video.transform.operation@1', range: clone(step.range),
          payload: videoTransform.normalizeParams(step.params, true) };
      },
      toGraph: function(edit, graphContext) {
        return { id: 'node-' + edit.id, type: 'video.transform@1', range: clone(edit.range),
          inputs: [{ port: 'base', nodeId: graphContext.videoHead }],
          props: videoTransform.normalizeParams(edit.payload, false) };
      },
      toTimeline: function(edit) {
        var params = videoTransform.normalizeParams(edit.payload, false);
        return { editId: edit.id, transactionId: edit.transactionId, lane: 'video-effect',
          range: clone(edit.range), label: '画面变换',
          summary: '水平翻转 ' + (params.flipHorizontal ? '开' : '关')
            + '，垂直翻转 ' + (params.flipVertical ? '开' : '关') + '，缩放 ' + params.scale + ' 倍' };
      },
      preview: function(graph, time) {
        return graph.nodes.filter(function(node) {
          return node.type === 'video.transform@1' && colorAdjustment.isActive(node.range, time);
        }).map(function(node) { return videoTransform.normalizeParams(node.props, false); });
      },
      toExport: function(node) {
        return { capability: 'video.transform@1', range: clone(node.range),
          params: videoTransform.normalizeParams(node.props, false) };
      }
    };
  }

  function completeRegistration(registration) {
    var definition = registration && registration.definition;
    return isPlainObject(registration) && isPlainObject(definition)
      && ['append', 'replaceByType'].indexOf(registration.editMode) !== -1
      && typeof registration.editType === 'string' && registration.editType
      && typeof registration.nodeType === 'string' && registration.nodeType
      && ['sourceEffect', 'overlay'].indexOf(registration.graphStage) !== -1
      && definition.schemaVersion === 1 && typeof definition.id === 'string'
      && isPlainObject(definition.params) && definition.params.type === 'object'
      && definition.params.additionalProperties === false
      && isPlainObject(definition.params.properties)
      && isPlainObject(definition.range) && typeof definition.range.allowed === 'boolean'
      && definition.range.default === 'wholeTarget'
      && REQUIRED_ADAPTERS.every(function(name) {
        return typeof registration[name] === 'function';
      });
  }

  function createCapabilityRegistry(registrations) {
    var items = registrations === undefined
      ? [createSubtitleRegistration(), createColorRegistration(), createTransformRegistration()]
      : registrations.slice();
    var byId = Object.create(null);
    var byEditType = Object.create(null);
    var byNodeType = Object.create(null);
    items.forEach(function(registration) {
      var id = registration && registration.definition && registration.definition.id;
      if (typeof id !== 'string' || byId[id]) throw codedError('CAPABILITY_REGISTRATION_INVALID');
      byId[id] = registration;
      if (typeof registration.editType === 'string') byEditType[registration.editType] = registration;
      if (typeof registration.nodeType === 'string') byNodeType[registration.nodeType] = registration;
    });

    function validateRecipe(recipe) {
      if (!isDataOnly(recipe) || !isPlainObject(recipe) || Object.keys(recipe).length !== 2
          || !hasOnlyKeys(recipe, ['kind', 'steps']) || recipe.kind !== 'instruction'
          || !Array.isArray(recipe.steps) || recipe.steps.length < 1) {
        throw codedError('RECIPE_INVALID');
      }
      recipe.steps.forEach(function(step) {
        if (!isPlainObject(step) || Object.keys(step).length < 2 || Object.keys(step).length > 3
            || !hasOnlyKeys(step, ['capability', 'range', 'params'])
            || typeof step.capability !== 'string') {
          throw codedError('RECIPE_INVALID');
        }
        var registration = byId[step.capability];
        if (!registration || !completeRegistration(registration)) {
          throw codedError('RECIPE_UNSUPPORTED_CAPABILITY');
        }
        if (!isPlainObject(step.params)) throw codedError('RECIPE_INVALID_PARAM');
        var properties = registration.definition.params.properties;
        var parameterNames = Object.keys(step.params);
        if ((Object.keys(properties).length > 0 && parameterNames.length === 0)
            || parameterNames.some(function(key) {
              if (!Object.prototype.hasOwnProperty.call(properties, key)) return true;
              var schema = properties[key];
              var value = step.params[key];
              if (schema.type === 'boolean') return typeof value !== 'boolean';
              return schema.type !== 'number' || typeof value !== 'number'
                || !Number.isFinite(value)
                || (schema.minimum !== undefined && value < schema.minimum)
                || (schema.maximum !== undefined && value > schema.maximum);
            })) {
          throw codedError('RECIPE_INVALID_PARAM');
        }
        if (Object.prototype.hasOwnProperty.call(step, 'range')) {
          if (registration.definition.range.allowed === false) {
            throw codedError('RECIPE_INVALID_RANGE');
          }
          var range = step.range;
          if (!isPlainObject(range) || Object.keys(range).length !== 2
              || !hasOnlyKeys(range, ['start', 'end'])
              || typeof range.start !== 'number' || !Number.isFinite(range.start)
              || typeof range.end !== 'number' || !Number.isFinite(range.end)
              || range.start < 0 || range.end <= range.start) {
            throw codedError('RECIPE_INVALID_RANGE');
          }
        }
      });
      return clone(recipe);
    }

    return {
      get: function(id) { return byId[id] || null; },
      forEditType: function(type) { return byEditType[type] || null; },
      forNodeType: function(type) { return byNodeType[type] || null; },
      promptDefinitions: function() {
        return items.filter(completeRegistration).map(function(registration) {
          return clone(registration.definition);
        });
      },
      validateRecipe: validateRecipe,
      normalizeRecipe: function(recipe, mediaFacts) {
        var validated = validateRecipe(recipe);
        var duration = mediaFacts && mediaFacts.duration;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
          throw codedError('RECIPE_INVALID_MEDIA');
        }
        return {
          kind: 'instruction',
          steps: validated.steps.map(function(step) {
            return {
              capability: step.capability,
              target: { kind: 'source', id: 'main-video' },
              range: colorAdjustment.normalizeRange(step.range, duration),
              params: clone(step.params)
            };
          })
        };
      }
    };
  }

  return {
    createCapabilityRegistry: createCapabilityRegistry,
    createColorRegistration: createColorRegistration,
    createTransformRegistration: createTransformRegistration,
    createSubtitleRegistration: createSubtitleRegistration,
    codedError: codedError,
    clone: clone,
    validateSubtitlePayload: validateSubtitlePayload
  };
});
