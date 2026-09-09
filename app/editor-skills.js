(function() {
  'use strict';

  var registry = window.editCapabilityRegistry;
  var skills = window.SRTPersonalSkills;
  var store = skills.createPersonalSkillStore({
    storage: localStorage,
    storageKey: STORAGE_KEYS.PERSONAL_SKILLS,
    idFactory: createLocalId,
    capabilityRegistry: registry
  });
  var bankButton = document.querySelector('[data-testid="personal-skills-button"]');
  var bankDialog = document.querySelector('[data-testid="personal-skills-dialog"]');
  var bankList = bankDialog.querySelector('[data-skill-list]');
  var bankEmpty = bankDialog.querySelector('[data-skill-list-empty]');
  var bankError = bankDialog.querySelector('[data-skill-list-error]');
  var saveDialog = document.querySelector('[data-testid="skill-save-dialog"]');
  var saveForm = saveDialog.querySelector('[data-skill-save-form]');
  var nameField = saveDialog.querySelector('[data-testid="skill-name"]');
  var intentField = saveDialog.querySelector('[data-testid="skill-intent"]');
  var preferencesField = saveDialog.querySelector('[data-testid="skill-preferences"]');
  var saveButton = saveDialog.querySelector('[data-testid="skill-save"]');
  var saveError = saveDialog.querySelector('[data-skill-save-error]');
  var selectedChip = document.querySelector('[data-testid="selected-skill"]');
  var selectedName = selectedChip.querySelector('.selected-skill__name');
  var clearSelectionButton = selectedChip.querySelector('[data-testid="selected-skill-clear"]');
  var exitClarifyButton = document.querySelector('[data-testid="skill-exit-clarify"]');
  var selected = null;
  var clarifyActive = false;
  var saving = false;
  var saveRecord = null;
  var lastFocus = null;

  function showError(element, message) {
    element.textContent = message || '';
    element.hidden = !message;
  }

  function storageErrorMessage(error) {
    if (error && error.code === 'SKILL_STORAGE_CORRUPT') {
      return '技能库数据无法读取；原有内容未被改写。';
    }
    if (error && error.code === 'SKILL_INVALID') return '内容不符合要求，请检查名称和文字长度。';
    return '技能暂时无法保存，请检查可用存储后重试。';
  }

  function requestLocked() {
    return Boolean(window.timelineController && (window.timelineController.isRequestInFlight()
      || window.timelineController.hasPendingClarify()));
  }

  function userTurns(record) {
    var turns = Array.isArray(record && record.turns) ? record.turns.filter(function(turn) {
      return turn && turn.role === 'user' && typeof turn.text === 'string' && turn.text.trim();
    }).map(function(turn) { return turn.text.trim(); }) : [];
    if (!turns.length && record && typeof record.text === 'string' && record.text.trim()) {
      turns.push(record.text.trim());
    }
    return turns;
  }

  function referenceFor(record) {
    var loaded = window.projectEditing.load(getActiveProjectId());
    return skills.referenceFromTransaction(
      loaded.document,
      record.transactionId || record.id,
      registry
    );
  }

  function canSave(record) {
    if (!record || record.instructionStatus !== 'success' || record.timelineStatus !== 'success'
        || !userTurns(record).length || !projectStateReady || !window.projectEditing) return false;
    try {
      referenceFor(record);
      return true;
    } catch (_) {
      return false;
    }
  }

  function defaultIntent(record) {
    var requestText = userTurns(record).join('\n');
    if (!record.skillContext) return requestText;
    var context;
    try { context = skills.normalizeSkillContext(record.skillContext); } catch (_) { return requestText; }
    var lines = ['参考技能「' + context.name + '」', '原始意图：' + context.intent];
    if (context.preferences.description) lines.push('原始偏好：' + context.preferences.description);
    lines.push('本次需求：', requestText);
    return lines.join('\n');
  }

  function restoreFocus() {
    if (lastFocus && document.contains(lastFocus) && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function openSave(record) {
    if (!canSave(record)) return;
    saveRecord = record;
    saving = false;
    saveButton.disabled = false;
    nameField.value = '';
    intentField.value = defaultIntent(record);
    preferencesField.value = record.skillContext
      ? skills.normalizeSkillContext(record.skillContext).preferences.description : '';
    showError(saveError, '');
    lastFocus = document.activeElement;
    saveDialog.showModal();
    nameField.focus();
  }

  function appendDetail(details, label, value) {
    var row = document.createElement('div');
    var heading = document.createElement('strong');
    heading.textContent = label + '：';
    row.appendChild(heading);
    row.appendChild(document.createTextNode(value));
    details.appendChild(row);
  }

  function effectSummary(record) {
    return record.referenceRecipe.steps.map(function(step) {
      var registration = registry.get(step.capability);
      return registration ? registration.definition.label : step.capability + '（当前不可用）';
    }).join('、');
  }

  function selectSkill(record, official) {
    if (requestLocked()) return;
    selected = official ? skills.normalizeSkillContext(record.context) : skills.contextFromSkill(record);
    lastFocus = null;
    closeDialog(bankDialog);
    if (!editorEl.textContent.trim()) editorEl.textContent = '使用「' + selected.name + '」';
    editorEl.dispatchEvent(new Event('input'));
    editorEl.focus();
    refresh();
  }

  function createSkillItem(record, official) {
    var item = document.createElement('article');
    item.className = 'skill-item';
    item.dataset.testid = official ? 'official-skill-item' : 'personal-skill-item';
    item.dataset.skillId = record.id;
    var head = document.createElement('div');
    head.className = 'skill-item__head';
    var title = document.createElement('div');
    title.className = 'skill-item__name';
    title.textContent = record.name;
    if (official) {
      var badge = document.createElement('small');
      badge.textContent = ' · 官方模板';
      title.appendChild(badge);
    }
    var actions = document.createElement('div');
    actions.className = 'skill-item__actions';
    var view = document.createElement('button');
    view.type = 'button'; view.className = 'skill-button'; view.dataset.testid = 'skill-view'; view.textContent = '查看';
    var use = document.createElement('button');
    use.type = 'button'; use.className = 'skill-button'; use.dataset.testid = 'skill-use'; use.textContent = '使用';
    use.disabled = requestLocked();
    var remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'skill-button'; remove.dataset.testid = 'skill-delete'; remove.textContent = '删除';
    var details = document.createElement('div');
    details.className = 'skill-item__details'; details.hidden = true;
    var detailRecord = official ? record.context : record;
    appendDetail(details, '剪辑意图', detailRecord.intent);
    appendDetail(details, '偏好', detailRecord.preferences.description || '未填写');
    appendDetail(details, '效果', official ? '根据当前视频重新提炼内容与时间；修改后的效果可另存为个人技能。' : effectSummary(record));
    view.addEventListener('click', function() {
      details.hidden = !details.hidden;
      view.textContent = details.hidden ? '查看' : '收起';
    });
    use.addEventListener('click', function() { selectSkill(record, official); });
    remove.addEventListener('click', function() {
      if (!window.confirm('确定删除技能「' + record.name + '」吗？')) return;
      try {
        if (store.remove(record.id) && selected && selected.name === record.name) selected = null;
        renderBank(); refresh();
      } catch (error) {
        showError(bankError, storageErrorMessage(error));
      }
    });
    actions.appendChild(view); actions.appendChild(use);
    if (!official) actions.appendChild(remove);
    head.appendChild(title); head.appendChild(actions);
    item.appendChild(head); item.appendChild(details);
    return item;
  }

  function renderBank() {
    bankList.replaceChildren();
    showError(bankError, '');
    var officialTemplates = skills.listOfficialTemplates();
    officialTemplates.forEach(function(record) { bankList.appendChild(createSkillItem(record, true)); });
    try {
      var records = store.list();
      records.forEach(function(record) { bankList.appendChild(createSkillItem(record)); });
      bankEmpty.hidden = records.length + officialTemplates.length > 0;
    } catch (error) {
      bankEmpty.hidden = true;
      showError(bankError, storageErrorMessage(error));
    }
  }

  function refresh() {
    var locked = requestLocked();
    bankButton.disabled = locked;
    selectedChip.hidden = !selected;
    selectedName.textContent = selected ? selected.name : '';
    clearSelectionButton.disabled = locked;
    exitClarifyButton.hidden = !clarifyActive;
    Array.from(bankList.querySelectorAll('[data-testid="skill-use"]')).forEach(function(button) {
      button.disabled = locked;
    });
  }

  function captureSelection() {
    return selected ? skills.normalizeSkillContext(selected) : null;
  }

  function afterRequest(record) {
    if (!record) { refresh(); return; }
    if (record.instructionStatus === 'clarifying') {
      clarifyActive = true;
    } else if (record.instructionStatus === 'failed'
        || (record.instructionStatus === 'success'
          && ['success', 'failed', 'not_run'].indexOf(record.timelineStatus) !== -1)) {
      clarifyActive = false;
      selected = null;
    }
    refresh();
  }

  bankButton.addEventListener('click', function() {
    if (requestLocked()) return;
    renderBank();
    lastFocus = document.activeElement;
    bankDialog.showModal();
    bankDialog.querySelector('[data-skill-dialog-close]').focus();
  });
  bankDialog.querySelector('[data-skill-dialog-close]').addEventListener('click', function() {
    closeDialog(bankDialog);
  });
  saveDialog.querySelector('[data-testid="skill-cancel"]').addEventListener('click', function() {
    closeDialog(saveDialog);
  });
  [bankDialog, saveDialog].forEach(function(dialog) {
    dialog.addEventListener('close', restoreFocus);
  });
  clearSelectionButton.addEventListener('click', function() {
    if (requestLocked()) return;
    selected = null;
    refresh();
    editorEl.focus();
  });
  exitClarifyButton.addEventListener('click', function() {
    if (window.timelineController.exitPendingClarify()) {
      clarifyActive = false;
      selected = null;
      refresh();
      editorEl.focus();
    }
  });
  saveForm.addEventListener('submit', function(event) {
    event.preventDefault();
    if (saving || !saveRecord) return;
    var trimmedName = nameField.value.trim();
    try {
      if (store.list().some(function(record) { return record.name === trimmedName; })) {
        showError(saveError, '已有同名技能，请换一个名称。');
        nameField.focus();
        return;
      }
    } catch (error) {
      showError(saveError, storageErrorMessage(error));
      return;
    }
    saving = true;
    saveButton.disabled = true;
    showError(saveError, '');
    try {
      store.save({
        name: nameField.value,
        intent: intentField.value,
        preferences: { description: preferencesField.value },
        referenceRecipe: referenceFor(saveRecord)
      });
      closeDialog(saveDialog);
      renderBank();
    } catch (error) {
      showError(saveError, storageErrorMessage(error));
    } finally {
      saving = false;
      saveButton.disabled = false;
    }
  });

  window.personalSkillController = {
    canSave: canSave,
    openSave: openSave,
    captureSelection: captureSelection,
    afterRequest: afterRequest,
    refresh: refresh
  };

  refresh();
  window.projectEditingReady.then(function() {
    refresh();
    refreshRequestCards();
  }).catch(function() { refresh(); });
})();
