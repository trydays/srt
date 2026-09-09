(function(root, factory) {
  var capabilities = typeof module === 'object' && module.exports
    ? require('./edit-capabilities')
    : root && root.SRTEditCapabilities;
  var api = factory(capabilities);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTPersonalSkills = api;
})(typeof window === 'undefined' ? null : window, function(capabilities) {
  'use strict';

  var RECORD_KEYS = [
    'schemaVersion', 'id', 'name', 'intent', 'preferences', 'referenceRecipe',
    'capabilityVersions', 'createdAt', 'updatedAt'
  ];
  var CONTEXT_KEYS = [
    'name', 'intent', 'preferences', 'referenceRecipe', 'capabilityVersions'
  ];

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function invalid() {
    throw codedError('SKILL_INVALID');
  }

  function isPlainObject(value) {
    if (!value || Array.isArray(value) || typeof value !== 'object') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasExactKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    var actual = Object.keys(value).sort();
    var expected = keys.slice().sort();
    return actual.length === expected.length && actual.every(function(key, index) {
      return key === expected[index];
    });
  }

  function isDataOnly(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value) && !isPlainObject(value)) return false;
    if (Object.getOwnPropertySymbols(value).length) return false;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) return false;
    seen.push(value);
    var keys = Object.keys(value);
    if (Array.isArray(value) && (keys.length !== value.length || keys.some(function(key, index) {
      return key !== String(index);
    }))) {
      seen.pop();
      return false;
    }
    var propertyNames = Object.getOwnPropertyNames(value);
    var expectedPropertyCount = keys.length + (Array.isArray(value) ? 1 : 0);
    var valid = propertyNames.length === expectedPropertyCount && keys.every(function(key) {
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
        && descriptor.enumerable && isDataOnly(descriptor.value, seen);
    });
    seen.pop();
    return valid;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function validText(value, maximum, mayBeEmpty) {
    return typeof value === 'string' && value.length <= maximum
      && (mayBeEmpty || value.trim().length > 0);
  }

  function normalizePreferences(value) {
    if (value === undefined) return { description: '' };
    if (!hasExactKeys(value, ['description']) || !validText(value.description, 2000, true)) invalid();
    return { description: value.description };
  }

  function validateReference(value) {
    if (!isDataOnly(value) || !hasExactKeys(value, ['kind', 'steps'])
        || value.kind !== 'instruction' || !Array.isArray(value.steps) || value.steps.length < 1) invalid();
    value.steps.forEach(function(step) {
      if (!isPlainObject(step) || !isDataOnly(step)
          || !(hasExactKeys(step, ['capability', 'params'])
            || hasExactKeys(step, ['capability', 'params', 'range']))
          || typeof step.capability !== 'string' || !step.capability.trim()
          || !isPlainObject(step.params)) invalid();
      if (Object.prototype.hasOwnProperty.call(step, 'range')) {
        var range = step.range;
        if (!hasExactKeys(range, ['start', 'end'])
            || typeof range.start !== 'number' || !Number.isFinite(range.start)
            || typeof range.end !== 'number' || !Number.isFinite(range.end)
            || range.start < 0 || range.end <= range.start) invalid();
      }
    });
    return clone(value);
  }

  function versionsFromReference(reference) {
    var seen = Object.create(null);
    return reference.steps.map(function(step) { return step.capability; }).filter(function(id) {
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function validateVersions(value, reference) {
    if (!Array.isArray(value) || !isDataOnly(value)) invalid();
    var expected = versionsFromReference(reference);
    if (value.length !== expected.length || value.some(function(id, index) {
      return typeof id !== 'string' || !id || id !== expected[index];
    })) invalid();
    return value.slice();
  }

  function normalizeSkillContext(value) {
    if (value === undefined || value === null) return null;
    if (!hasExactKeys(value, CONTEXT_KEYS)
        || !validText(value.name, 60, false) || value.name !== value.name.trim()
        || !validText(value.intent, 4000, false)) invalid();
    var reference = value.referenceRecipe === null ? null : validateReference(value.referenceRecipe);
    if (reference === null && (!Array.isArray(value.capabilityVersions) || value.capabilityVersions.length)) invalid();
    return {
      name: value.name,
      intent: value.intent,
      preferences: normalizePreferences(value.preferences),
      referenceRecipe: reference,
      capabilityVersions: reference === null ? [] : validateVersions(value.capabilityVersions, reference)
    };
  }

  function validateRecord(value) {
    if (!value || value.referenceRecipe === null) invalid();
    if (!hasExactKeys(value, RECORD_KEYS) || value.schemaVersion !== 1
        || typeof value.id !== 'string' || !value.id
        || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
        || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) invalid();
    var context = normalizeSkillContext({
      name: value.name,
      intent: value.intent,
      preferences: value.preferences,
      referenceRecipe: value.referenceRecipe,
      capabilityVersions: value.capabilityVersions
    });
    return {
      schemaVersion: 1,
      id: value.id,
      name: context.name,
      intent: context.intent,
      preferences: context.preferences,
      referenceRecipe: context.referenceRecipe,
      capabilityVersions: context.capabilityVersions,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt
    };
  }

  function contextFromSkill(record) {
    var validated = validateRecord(record);
    return normalizeSkillContext({
      name: validated.name,
      intent: validated.intent,
      preferences: validated.preferences,
      referenceRecipe: validated.referenceRecipe,
      capabilityVersions: validated.capabilityVersions
    });
  }

  function referenceFromTransaction(document, transactionId, capabilityRegistry) {
    if (!isPlainObject(document) || !Array.isArray(document.edits)
        || typeof transactionId !== 'string' || !transactionId
        || !capabilityRegistry || typeof capabilityRegistry.forEditType !== 'function') invalid();
    var steps = [];
    document.edits.forEach(function(edit) {
      if (!isPlainObject(edit) || edit.enabled !== true || edit.transactionId !== transactionId) return;
      var registration = capabilityRegistry.forEditType(edit.type);
      if (!registration || !isPlainObject(registration.definition)) invalid();
      var definition = registration.definition;
      var properties = definition.params && definition.params.properties;
      if (typeof definition.id !== 'string' || !isPlainObject(properties)
          || !isPlainObject(edit.payload)) invalid();
      var params = {};
      Object.keys(properties).forEach(function(key) {
        if (Object.prototype.hasOwnProperty.call(edit.payload, key)) params[key] = clone(edit.payload[key]);
      });
      var step = { capability: definition.id, params: params };
      if (definition.range && definition.range.allowed === true) step.range = clone(edit.range);
      steps.push(step);
    });
    return validateReference({ kind: 'instruction', steps: steps });
  }

  function createPersonalSkillStore(options) {
    options = options || {};
    var storage = options.storage;
    var storageKey = options.storageKey || 'srt_personal_skills';
    var registry = options.capabilityRegistry
      || (capabilities && capabilities.createCapabilityRegistry());
    var idFactory = options.idFactory || function() {
      return 'skill-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    };
    var now = options.now || Date.now;

    function corrupt() {
      throw codedError('SKILL_STORAGE_CORRUPT');
    }

    function readEnvelope() {
      var raw;
      try {
        raw = storage.getItem(storageKey);
      } catch (_) {
        corrupt();
      }
      if (raw === null) return { schemaVersion: 1, skills: [] };
      try {
        var parsed = JSON.parse(raw);
        if (!hasExactKeys(parsed, ['schemaVersion', 'skills'])
            || parsed.schemaVersion !== 1 || !Array.isArray(parsed.skills)) corrupt();
        var ids = Object.create(null), names = Object.create(null);
        var skills = parsed.skills.map(function(record) {
          var validated = validateRecord(record);
          if (ids[validated.id] || names[validated.name]) corrupt();
          ids[validated.id] = true;
          names[validated.name] = true;
          return validated;
        });
        return { schemaVersion: 1, skills: skills };
      } catch (error) {
        if (error && error.code === 'SKILL_STORAGE_CORRUPT') throw error;
        corrupt();
      }
    }

    function writeEnvelope(envelope) {
      storage.setItem(storageKey, JSON.stringify(envelope));
    }

    function save(input) {
      var envelope = readEnvelope();
      if (!isPlainObject(input) || !Object.keys(input).every(function(key) {
        return ['name', 'intent', 'preferences', 'referenceRecipe'].indexOf(key) !== -1;
      }) || !Object.prototype.hasOwnProperty.call(input, 'name')
        || !Object.prototype.hasOwnProperty.call(input, 'intent')
        || !Object.prototype.hasOwnProperty.call(input, 'referenceRecipe')) invalid();
      var name = typeof input.name === 'string' ? input.name.trim() : input.name;
      if (!validText(name, 60, false) || !validText(input.intent, 4000, false)) invalid();
      var preferences = normalizePreferences(input.preferences);
      var reference = validateReference(input.referenceRecipe);
      try {
        reference = registry.validateRecipe(reference);
      } catch (_) {
        invalid();
      }
      if (envelope.skills.some(function(record) { return record.name === name; })) invalid();
      var id = idFactory('skill');
      var timestamp = now();
      if (typeof id !== 'string' || !id || typeof timestamp !== 'number' || !Number.isFinite(timestamp)
          || envelope.skills.some(function(record) { return record.id === id; })) invalid();
      var record = validateRecord({
        schemaVersion: 1,
        id: id,
        name: name,
        intent: input.intent,
        preferences: preferences,
        referenceRecipe: reference,
        capabilityVersions: versionsFromReference(reference),
        createdAt: timestamp,
        updatedAt: timestamp
      });
      envelope.skills.push(record);
      writeEnvelope(envelope);
      return clone(record);
    }

    function list() {
      return clone(readEnvelope().skills);
    }

    function get(id) {
      var record = readEnvelope().skills.find(function(skill) { return skill.id === id; });
      return record ? clone(record) : null;
    }

    function remove(id) {
      var envelope = readEnvelope();
      var index = envelope.skills.findIndex(function(skill) { return skill.id === id; });
      if (index === -1) return false;
      envelope.skills.splice(index, 1);
      writeEnvelope(envelope);
      return true;
    }

    return { list: list, get: get, save: save, remove: remove };
  }

  function listOfficialTemplates() {
    var name = '口播要点自动卡片';
    return [{
      id: 'official-keypoint-cards-v1', name: name,
      context: {
        name: name,
        intent: '分析当前视频的带时间语音原文，自动提炼关键要点并定位对应时段，在合适位置叠加卡片或大标题说明标签。没有完整原文时先申请 transcript。要点数量、文字和起止时间根据当前视频重新推导，不照搬旧视频，不按时长均分。',
        preferences: { description: '沿用粉色半透明毛玻璃圆角卡片、柔和发光边缘、淡入淡出，以及清晰的大标题和简短说明标签。按内容选择卡片或标题，避免遮挡主体。仅使用当前可执行能力；没有可用嵌入素材时不虚构素材地址。' },
        referenceRecipe: null, capabilityVersions: []
      }
    }];
  }

  return {
    listOfficialTemplates: listOfficialTemplates,
    createPersonalSkillStore: createPersonalSkillStore,
    referenceFromTransaction: referenceFromTransaction,
    normalizeSkillContext: normalizeSkillContext,
    contextFromSkill: contextFromSkill
  };
});
