(function(root, factory) {
  var renderRecipe = typeof module === 'object' && module.exports
    ? require('./render-recipe')
    : root && root.SRTRenderRecipe;
  var api = factory(renderRecipe);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTEditCapabilities = api;
})(typeof window === 'undefined' ? null : window, function(renderRecipe) {
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
        description: '为整段视频生成可编辑字幕',
        params: { type: 'object', additionalProperties: false, properties: {} },
        range: { allowed: false, default: 'wholeTarget' }
      },
      editMode: 'replaceByType',
      editType: 'subtitle.track@1',

      prepare: async function(_step, executionContext) {
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

  function completeRegistration(registration) {
    var definition = registration && registration.definition;
    return isPlainObject(registration) && isPlainObject(definition)
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
    var items = registrations === undefined ? [createSubtitleRegistration()] : registrations.slice();
    var byId = Object.create(null);
    var byEditType = Object.create(null);
    items.forEach(function(registration) {
      var id = registration && registration.definition && registration.definition.id;
      if (typeof id !== 'string' || byId[id]) throw codedError('CAPABILITY_REGISTRATION_INVALID');
      byId[id] = registration;
      if (typeof registration.editType === 'string') byEditType[registration.editType] = registration;
    });

    function validateRecipe(recipe) {
      if (!isPlainObject(recipe) || Object.keys(recipe).length !== 2
          || !hasOnlyKeys(recipe, ['kind', 'steps']) || recipe.kind !== 'instruction'
          || !Array.isArray(recipe.steps) || recipe.steps.length !== 1) {
        throw codedError('RECIPE_INVALID');
      }
      var step = recipe.steps[0];
      if (!isPlainObject(step) || Object.keys(step).length !== 2
          || !hasOnlyKeys(step, ['capability', 'params'])) {
        throw codedError('RECIPE_INVALID');
      }
      var registration = byId[step.capability];
      if (!registration || !completeRegistration(registration)) {
        throw codedError('RECIPE_UNSUPPORTED_CAPABILITY');
      }
      if (!isPlainObject(step.params)) throw codedError('RECIPE_INVALID_PARAM');
      var properties = registration.definition.params.properties;
      if (Object.keys(step.params).some(function(key) {
        return !Object.prototype.hasOwnProperty.call(properties, key);
      })) {
        throw codedError('RECIPE_INVALID_PARAM');
      }
      return clone(recipe);
    }

    return {
      get: function(id) { return byId[id] || null; },
      forEditType: function(type) { return byEditType[type] || null; },
      promptDefinitions: function() {
        return items.filter(completeRegistration).map(function(registration) {
          return clone(registration.definition);
        });
      },
      validateRecipe: validateRecipe,
      normalizeRecipe: function(recipe, mediaFacts) {
        var validated = validateRecipe(recipe);
        var step = validated.steps[0];
        var registration = byId[step.capability];
        var duration = mediaFacts && mediaFacts.duration;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
          throw codedError('RECIPE_INVALID_MEDIA');
        }
        return {
          kind: 'instruction',
          steps: [{
            capability: registration.definition.id,
            target: { kind: 'source', id: 'main-video' },
            range: { start: 0, end: duration },
            params: clone(step.params)
          }]
        };
      }
    };
  }

  return {
    createCapabilityRegistry: createCapabilityRegistry,
    createSubtitleRegistration: createSubtitleRegistration,
    codedError: codedError,
    clone: clone,
    validateSubtitlePayload: validateSubtitlePayload
  };
});
