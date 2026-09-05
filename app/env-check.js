/* === env-check.js — 三天remotion 环境检测 === */

var environmentPage = document.querySelector('[data-testid="environment-page"]');
if (!environmentPage) {
  console.error('[env-check] 非环境检测页面，跳过初始化');
} else {
  window.__PAGE = { id: 'env' };
  renderTabs();

  var STATUS_LABELS = {
    ready: '满足',
    limited: '可用但受限',
    missing: '不满足'
  };
  var REASON_LABELS = {
    ok: '检测正常',
    absent: '未安装或未在系统路径中找到',
    incompatible: '版本不兼容，请升级后重试',
    probe_error: '检测失败，请重试或手动确认',
    unsupported: '当前系统或硬件不支持'
  };
  var TOOL_DEFINITIONS = [
    { id: 'ffmpeg', label: 'FFmpeg', description: '视频编解码引擎' },
    { id: 'node', label: 'Node.js', description: 'Remotion 渲染运行时' },
    { id: 'npm', label: 'npm', description: 'Node.js 包管理器' },
    { id: 'python', label: 'Python', description: '字幕工具运行环境' },
    { id: 'whisper', label: 'Whisper', description: 'AI 语音识别转字幕' }
  ];
  var MODE_DEFINITIONS = [
    { id: 'ffmpeg', label: '视频处理', description: '剪切、转码与导出' },
    { id: 'remotion', label: 'Remotion 渲染', description: '程序化视频渲染' },
    { id: 'subtitles', label: '语音字幕', description: '语音识别与字幕生成' }
  ];
  var INSTALL_TARGETS = { ffmpeg: 'ffmpeg', node: 'node', npm: 'node', python: 'python', whisper: 'whisper' };
  var detectionGeneration = 0;
  var pendingInstall = null;

  var platformTitle = document.getElementById('platformTitle');
  var platformMeta = document.getElementById('platformMeta');
  var statusBar = document.getElementById('statusBar');
  var hardwareList = document.getElementById('hardwareList');
  var toolList = document.getElementById('toolList');
  var modeList = document.getElementById('modeList');
  var retryButton = document.getElementById('btnRetry');
  var continueButton = document.getElementById('btnConfirm');
  var cliBadge = document.getElementById('cliBadge');
  var installDialog = document.getElementById('installDialog');
  var installTitle = document.getElementById('installTitle');
  var installPlan = document.getElementById('installPlan');
  var installError = document.getElementById('installError');
  var installCancel = document.getElementById('installCancel');
  var installConfirm = document.getElementById('installConfirm');

  function escapeText(value) {
    return String(value === undefined || value === null || value === '' ? '—' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizedStatus(value) {
    return value === 'ready' || value === 'limited' || value === 'missing' ? value : 'missing';
  }

  function reasonLabel(reason) {
    return REASON_LABELS[reason] || '状态信息不可用';
  }

  function statusMarkup(status) {
    var safeStatus = normalizedStatus(status);
    return '<span class="status-pill ' + safeStatus + '">' + STATUS_LABELS[safeStatus] + '</span>';
  }

  function platformLabel(os) {
    if (os === 'darwin') return 'macOS';
    if (os === 'win32') return 'Windows';
    if (os === 'linux') return 'Linux';
    return os || '未知系统';
  }

  function sourceLabel(source) {
    if (source === 'bundled') return '应用内置';
    if (source === 'managed') return '应用管理';
    if (source === 'system') return '系统环境';
    return source || '来源未知';
  }

  function formatGB(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '未知';
    return (Math.round(value * 10) / 10) + ' GB';
  }

  function loadingRows(container, label) {
    container.innerHTML = '<div class="report-row"><span class="report-row__name">' +
      escapeText(label) + '</span><span class="report-row__detail">正在检测…</span></div>';
  }

  function setLoadingState() {
    environmentPage.dataset.state = 'loading';
    setLocalModeBadge('⏳ 检测中', 'checking');
    platformTitle.textContent = '正在识别当前电脑…';
    platformMeta.textContent = '检测会提供建议，但不会阻止你继续使用。';
    statusBar.innerHTML = '<strong>检测中…</strong> 正在读取真实环境信息';
    loadingRows(hardwareList, '硬件');
    loadingRows(toolList, '工具');
    loadingRows(modeList, '功能');
  }

  function hardwareRow(id, label, detail, item) {
    var status = normalizedStatus(item && item.status);
    return '<div class="report-row" data-testid="row-' + id + '" data-status="' + status + '">' +
      '<span class="report-row__name">' + escapeText(label) + '</span>' +
      '<span class="report-row__detail">' + escapeText(detail) + '</span>' +
      statusMarkup(status) + '</div>';
  }

  function renderHardware(report) {
    var hardware = report.hardware || {};
    var chip = hardware.chip || {};
    var memory = hardware.memory || {};
    var disk = hardware.disk || {};
    var graphics = hardware.graphics || {};

    var chipDetail = (chip.name || '处理器名称未知') +
      (chip.cores ? ' · ' + chip.cores + ' 核' : '') +
      (chip.reason && chip.reason !== 'ok' ? ' · ' + reasonLabel(chip.reason) : '');

    var memoryDetail = '总计 ' + formatGB(memory.totalGB);
    if (memory.reason && memory.reason !== 'ok') memoryDetail += ' · ' + reasonLabel(memory.reason);
    else if (memory.status === 'ready') memoryDetail += ' · 满足建议的 16 GB';
    else if (memory.status === 'limited') memoryDetail += ' · 建议至少 16 GB';
    else memoryDetail += ' · 可用内存低于 8 GB';

    var diskDetail = escapeText(disk.path || '应用数据目录');
    diskDetail += ' · 可用 ' + escapeText(formatGB(disk.freeGB)) + ' / 共 ' + escapeText(formatGB(disk.totalGB));
    if (disk.reason && disk.reason !== 'ok') diskDetail += ' · ' + escapeText(reasonLabel(disk.reason));
    else if (disk.status === 'ready') diskDetail += ' · 可用空间充足';
    else if (disk.status === 'limited') diskDetail += ' · 建议至少保留 30 GB';
    else diskDetail += ' · 可用空间低于 10 GB';

    var graphicsParts = [];
    if (graphics.name) graphicsParts.push(graphics.name);
    if (report.platform && report.platform.os === 'darwin') {
      graphicsParts.push(graphics.metal ? 'Metal 支持' : 'Metal 不可用');
    } else if (graphics.supported) {
      graphicsParts.push('图形加速可用');
    }
    if (graphics.reason && graphics.reason !== 'ok') graphicsParts.push(reasonLabel(graphics.reason));
    if (!graphicsParts.length) graphicsParts.push('图形信息不可用');

    hardwareList.innerHTML = hardwareRow('chip', '处理器', chipDetail, chip) +
      hardwareRow('memory', '内存', memoryDetail, memory) +
      '<div class="report-row" data-testid="row-disk" data-status="' + normalizedStatus(disk.status) + '">' +
        '<span class="report-row__name">磁盘</span>' +
        '<span class="report-row__detail">' + diskDetail + '</span>' +
        statusMarkup(disk.status) + '</div>' +
      hardwareRow('graphics', '图形能力', graphicsParts.join(' · '), graphics);
  }

  function renderTools(report) {
    var reportTools = report.tools || {};
    var html = '';
    for (var i = 0; i < TOOL_DEFINITIONS.length; i++) {
      var definition = TOOL_DEFINITIONS[i];
      var tool = reportTools[definition.id] || {};
      var status = normalizedStatus(tool.status);
      var detailParts = [];
      if (tool.version) detailParts.push('版本 ' + tool.version);
      if (tool.source) detailParts.push(sourceLabel(tool.source));
      if (tool.reason && tool.reason !== 'ok') detailParts.push(reasonLabel(tool.reason));
      if (!detailParts.length) detailParts.push(reasonLabel(tool.reason));

      var action = '<span class="tool-row__action"></span>';
      var installTarget = INSTALL_TARGETS[definition.id];
      if (installTarget && status !== 'ready') {
        action = '<span class="tool-row__action"><button class="btn-install" type="button" ' +
          'data-tool-id="' + installTarget + '">查看安装方案</button></span>';
      }

      html += '<div class="tool-row" data-testid="row-' + definition.id + '" data-status="' + status + '">' +
        '<span class="tool-row__icon">' + (status === 'ready' ? '✅' : status === 'limited' ? '⚠️' : '❌') + '</span>' +
        '<span class="tool-row__name">' + escapeText(definition.label) + '</span>' +
        '<span class="tool-row__desc"><span class="tool-row__desc-text">' + escapeText(definition.description) + '</span></span>' +
        '<span class="tool-row__detail">' + escapeText(detailParts.join(' · ')) + '</span>' +
        '<span class="tool-row__status ' + (status === 'ready' ? 'ok' : status === 'limited' ? 'warn' : 'bad') + '">' +
          STATUS_LABELS[status] + '</span>' + action + '</div>';
    }
    toolList.innerHTML = html;
  }

  function renderModes(report) {
    var modes = report.modes || {};
    var html = '';
    for (var i = 0; i < MODE_DEFINITIONS.length; i++) {
      var definition = MODE_DEFINITIONS[i];
      var modeReport = modes[definition.id] || {};
      var status = normalizedStatus(modeReport.status);
      var details = [definition.description];
      if (modeReport.reason && modeReport.reason !== 'ok') {
        details.push(reasonLabel(modeReport.reason));
      }
      if (modeReport.blockers && modeReport.blockers.length) {
        details.push('受限项：' + modeReport.blockers.map(installToolLabel).join('、'));
      }
      html += '<div class="capability-card" data-testid="mode-' + definition.id + '" data-status="' + status + '">' +
        '<div class="capability-card__head"><span class="capability-card__title">' + escapeText(definition.label) + '</span>' +
        statusMarkup(status) + '</div><div class="capability-card__detail">' + escapeText(details.join(' · ')) + '</div></div>';
    }
    modeList.innerHTML = html;
  }

  function setLocalModeBadge(text, className) {
    cliBadge.textContent = text;
    cliBadge.className = 'mode-card__badge ' + className;
  }

  function renderLocalModeBadge(report) {
    var modes = report.modes || {};
    var hardware = report.hardware || {};
    var ffmpegStatus = normalizedStatus(modes.ffmpeg && modes.ffmpeg.status);
    var remotionStatus = normalizedStatus(modes.remotion && modes.remotion.status);
    var graphicsStatus = normalizedStatus(hardware.graphics && hardware.graphics.status);
    var status = ffmpegStatus !== 'ready'
      ? 'missing'
      : remotionStatus !== 'ready' || graphicsStatus !== 'ready' ? 'limited' : 'ready';
    var states = {
      ready: { text: '✅ 可用', className: 'ok' },
      limited: { text: '⚠️ 可用但受限', className: 'warn' },
      missing: { text: '❌ 需环境', className: 'bad' }
    };
    setLocalModeBadge(states[status].text, states[status].className);
  }

  function renderReport(report) {
    var renderedReport = report || {};
    var platform = renderedReport.platform || {};
    var chip = renderedReport.hardware && renderedReport.hardware.chip || {};
    var systemName = platformLabel(platform.os);
    platformTitle.textContent = systemName + (platform.version ? ' ' + platform.version : '');
    platformMeta.textContent = [chip.name, platform.arch, '检测结果仅提供建议，不影响继续使用'].filter(Boolean).join(' · ');

    renderHardware(renderedReport);
    renderTools(renderedReport);
    renderModes(renderedReport);
    renderLocalModeBadge(renderedReport);

    var statuses = [];
    Object.keys(renderedReport.hardware || {}).forEach(function(key) { statuses.push(normalizedStatus(renderedReport.hardware[key].status)); });
    Object.keys(renderedReport.tools || {}).forEach(function(key) { statuses.push(normalizedStatus(renderedReport.tools[key].status)); });
    var readyCount = statuses.filter(function(status) { return status === 'ready'; }).length;
    var attentionCount = statuses.length - readyCount;
    statusBar.innerHTML = '<strong>' + readyCount + '/' + statuses.length + '</strong> 项满足' +
      (attentionCount ? '，' + attentionCount + ' 项建议关注' : ' ✅ 当前环境已就绪');
    environmentPage.dataset.state = 'loaded';
  }

  function renderDesktopOnly() {
    setLocalModeBadge('⚠️ 需桌面检测', 'warn');
    platformTitle.textContent = '请在桌面版运行完整检测';
    platformMeta.textContent = '浏览器预览不会执行任何本机检测或安装命令。';
    statusBar.innerHTML = '<strong>浏览器模式</strong> 仍可继续使用预览功能';
    hardwareList.innerHTML = '<div class="report-row"><span class="report-row__name">硬件</span><span class="report-row__detail">请使用桌面版查看</span></div>';
    toolList.innerHTML = '<div class="report-row"><span class="report-row__name">工具</span><span class="report-row__detail">请使用桌面版查看</span></div>';
    modeList.innerHTML = '<div class="capability-card"><div class="capability-card__head"><span class="capability-card__title">浏览器预览</span>' +
      statusMarkup('ready') + '</div><div class="capability-card__detail">无需调用本机命令</div></div>';
    environmentPage.dataset.state = 'loaded';
  }

  function renderDetectionError(error) {
    setLocalModeBadge('❌ 检测失败', 'bad');
    platformTitle.textContent = '环境检测未完成';
    platformMeta.textContent = '检测失败，请重试；你仍然可以继续进入主页。';
    statusBar.innerHTML = '<strong>检测失败</strong> ' + escapeText(error && error.message || '无法读取环境信息');
    hardwareList.innerHTML = '<div class="report-row"><span class="report-row__name">硬件</span><span class="report-row__detail">检测失败，请重试或手动确认</span></div>';
    toolList.innerHTML = '<div class="report-row"><span class="report-row__name">工具</span><span class="report-row__detail">检测失败，请重试或手动确认</span></div>';
    modeList.innerHTML = '<div class="capability-card"><div class="capability-card__head"><span class="capability-card__title">功能状态</span>' +
      statusMarkup('missing') + '</div><div class="capability-card__detail">本次未取得完整报告</div></div>';
    environmentPage.dataset.state = 'error';
  }

  function detectEnvironment() {
    var generation = ++detectionGeneration;
    setLoadingState();
    if (!window.srtAPI || typeof window.srtAPI.detectEnvironment !== 'function') {
      if (generation === detectionGeneration) renderDesktopOnly();
      return Promise.resolve(null);
    }
    return window.srtAPI.detectEnvironment().then(function(report) {
      if (generation === detectionGeneration) renderReport(report);
      return report;
    }).catch(function(error) {
      if (generation === detectionGeneration) renderDetectionError(error);
      return null;
    });
  }

  function closeInstallDialog() {
    if (installDialog.open && typeof installDialog.close === 'function') installDialog.close();
    else installDialog.removeAttribute('open');
  }

  function showInstallDialog() {
    if (typeof installDialog.showModal === 'function') installDialog.showModal();
    else installDialog.setAttribute('open', '');
  }

  function installToolLabel(toolId) {
    for (var i = 0; i < TOOL_DEFINITIONS.length; i++) {
      if (TOOL_DEFINITIONS[i].id === toolId) return TOOL_DEFINITIONS[i].label;
    }
    return toolId;
  }

  function renderInstallPlan(plan) {
    var steps = Array.isArray(plan.steps) ? plan.steps : [];
    var stepsHtml = steps.length ? '<ol>' + steps.map(function(step) {
      return '<li>' + escapeText(step) + '</li>';
    }).join('') + '</ol>' : '';
    installPlan.innerHTML = '<strong>' + escapeText(plan.summary || '安装方案') + '</strong>' +
      '<div>预计下载：' + escapeText(plan.downloadEstimate) + '</div>' +
      '<div>安装位置：' + escapeText(plan.installLocation) + '</div>' +
      '<div>预计耗时：' + escapeText(plan.durationEstimate) + '</div>' + stepsHtml;
  }

  function openInstallPlan(toolId) {
    if (!INSTALL_TARGETS[toolId] || !window.srtAPI || typeof window.srtAPI.describeInstall !== 'function') return;
    var request = { toolId: toolId, plan: null };
    pendingInstall = request;
    installTitle.textContent = '安装 ' + installToolLabel(toolId);
    installPlan.textContent = '正在准备安装方案…';
    installError.textContent = '';
    installConfirm.disabled = true;
    installConfirm.textContent = '确认安装';
    installCancel.disabled = false;
    showInstallDialog();

    window.srtAPI.describeInstall(toolId).then(function(plan) {
      if (pendingInstall !== request) return;
      request.plan = plan;
      renderInstallPlan(plan || {});
      var canAutomate = Boolean(plan && plan.canAutomate && plan.confirmationId);
      installConfirm.disabled = !canAutomate;
      if (!canAutomate) installError.textContent = '无法自动安装，请按上面的步骤手动完成，然后重新检测。';
    }).catch(function(error) {
      if (pendingInstall !== request) return;
      installPlan.textContent = '暂时无法取得自动安装方案。';
      installError.textContent = (error && error.message || '安装方案加载失败') + '。请手动安装后重新检测。';
      installConfirm.disabled = true;
    });
  }

  function cancelInstall() {
    if (installConfirm.disabled && installConfirm.textContent === '安装中…') return;
    pendingInstall = null;
    installError.textContent = '';
    closeInstallDialog();
  }

  toolList.addEventListener('click', function(event) {
    var button = event.target.closest('[data-tool-id]');
    if (!button) return;
    openInstallPlan(button.dataset.toolId);
  });

  installCancel.addEventListener('click', cancelInstall);
  installDialog.addEventListener('cancel', function(event) {
    event.preventDefault();
    cancelInstall();
  });

  installConfirm.addEventListener('click', function() {
    var request = pendingInstall;
    if (!request || !request.plan || !request.plan.confirmationId || installConfirm.disabled) return;
    installConfirm.disabled = true;
    installConfirm.textContent = '安装中…';
    installCancel.disabled = true;
    installError.textContent = '';

    window.srtAPI.installTool(request.toolId, request.plan.confirmationId).then(function(result) {
      if (pendingInstall !== request) return;
      if (!result || !result.ok) {
        installError.textContent = (result && result.error || '安装失败，请稍后重试。') + ' 请按安装方案手动处理后重新检测。';
        installConfirm.textContent = '安装未完成';
        installCancel.disabled = false;
        return;
      }
      pendingInstall = null;
      installCancel.disabled = false;
      closeInstallDialog();
      detectEnvironment();
    }).catch(function(error) {
      if (pendingInstall !== request) return;
      installError.textContent = (error && error.message || '安装失败，请稍后重试。') + ' 请按安装方案手动处理后重新检测。';
      installConfirm.textContent = '安装未完成';
      installCancel.disabled = false;
    });
  });

  retryButton.addEventListener('click', function() { detectEnvironment(); });

  /* Existing cli/browser render-mode chooser. */
  var renderMode = localStorage.getItem(STORAGE_KEYS.RENDER_MODE);
  if (renderMode !== 'cli' && renderMode !== 'browser') renderMode = 'cli';
  var renderModeContainer = document.querySelector('.mode-row');
  var renderModeCards = renderModeContainer.querySelectorAll('.mode-card');
  for (var modeIndex = 0; modeIndex < renderModeCards.length; modeIndex++) {
    renderModeCards[modeIndex].classList.toggle('is-active', renderModeCards[modeIndex].dataset.mode === renderMode);
  }
  renderModeContainer.addEventListener('click', function(event) {
    var card = event.target.closest('.mode-card');
    if (!card) return;
    setActiveChip(renderModeContainer, card, '.mode-card');
    renderMode = card.dataset.mode;
  });

  continueButton.disabled = false;
  continueButton.addEventListener('click', function() {
    localStorage.setItem(STORAGE_KEYS.ENV_DONE, '1');
    localStorage.setItem(STORAGE_KEYS.RENDER_MODE, renderMode);
    location.href = '主页.html';
  });

  /* ── AI 配置（自动探测）── */
  (function initAIDetection() {
    function settled(call) {
      try {
        return Promise.resolve(call()).then(function(value) {
          return { ok: true, value: value };
        }).catch(function() {
          return { ok: false, value: null };
        });
      } catch (_) {
        return Promise.resolve({ ok: false, value: null });
      }
    }

    function validCloudConfig(config) {
      return Boolean(config && typeof config.provider === 'string' && config.provider.trim() &&
        typeof config.key === 'string' && config.key.trim());
    }

    function cloudKeyHint(key) {
      var value = String(key);
      var visibleLength = Math.min(7, Math.max(0, value.length - 1));
      return value.slice(0, visibleLength) + '...';
    }

    function renderSources(detection) {
      var title = document.getElementById('aiStatusTitle');
      var desc = document.getElementById('aiStatusDesc');
      var list = document.getElementById('aiSourceList');
      var manual = document.getElementById('aiManualSetup');

      if (!detection) {
        title.textContent = '⚠️ 开发模式 — 请在下方手动配置';
        desc.textContent = '使用浏览器开发时请手动填写 Key';
        list.innerHTML = '';
        manual.style.display = 'flex';
        var badge = document.getElementById('aiCollapseBadge');
        if (badge) { badge.textContent = '需配置'; badge.style.background = 'var(--amber-bg)'; badge.style.color = 'var(--amber)'; }
        document.getElementById('aiCollapse').open = true;
        return;
      }

      var html = '', found = 0;

      // Ollama
      if (detection.ollama && detection.ollama.available) {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm)"><span style="font-size:14px">🦙</span><span style="font-size:12px;font-weight:600;color:var(--text-strong)">Ollama 本地模型</span><span style="font-size:11px;color:var(--accent);margin-left:auto">✅ 可用</span></div>';
        found++;
      } else {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm);opacity:0.5"><span style="font-size:14px">🦙</span><span style="font-size:12px">Ollama 本地模型</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">未检测到</span></div>';
      }

      // 已合并的云端配置不包含来源信息，只显示可确认的配置状态。
      if (detection.cloudConfig && detection.cloudConfig.available) {
        var providerLabel = detection.cloudConfig.provider
          ? '（' + escapeText(detection.cloudConfig.provider) + '）'
          : '';
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm)"><span style="font-size:14px">☁️</span><span style="font-size:12px;font-weight:600;color:var(--text-strong)">已配置的云端 AI' + providerLabel + '</span><span style="font-size:11px;color:var(--accent);margin-left:auto">✅ 已配置</span></div>';
        found++;
      } else {
        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm);opacity:0.5"><span style="font-size:14px">☁️</span><span style="font-size:12px">云端 AI 配置</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">未配置</span></div>';
      }

      list.innerHTML = html;

      var badge = document.getElementById('aiCollapseBadge');
      if (found > 0) {
        title.textContent = '✅ 检测到 ' + found + ' 个可用 AI 配置来源';
        desc.textContent = '三天remotion 将自动使用以上来源进行效果翻译，无需额外配置。';
        manual.style.display = 'none';
        if (badge) { badge.textContent = '✅ 已就绪'; badge.style.background = 'var(--green-bg)'; badge.style.color = 'var(--green)'; }
      } else {
        title.textContent = '📋 未检测到预设 AI 配置';
        desc.textContent = '可安装 Ollama（免费本地 AI），或让 Agent 运行 npx srt-setup，或下方手动填写。';
        manual.style.display = 'flex';
        if (badge) { badge.textContent = '需配置'; badge.style.background = 'var(--amber-bg)'; badge.style.color = 'var(--amber)'; }
        document.getElementById('aiCollapse').open = true;
      }
    }

    // Electron 环境 → IPC 探测
    if (window.srtAPI && (typeof window.srtAPI.detectOllama === 'function' || typeof window.srtAPI.queryAIConfig === 'function')) {
      var ollamaCall = typeof window.srtAPI.detectOllama === 'function'
        ? settled(function() { return window.srtAPI.detectOllama(); })
        : Promise.resolve({ ok: false, value: null });
      var configCall = typeof window.srtAPI.queryAIConfig === 'function'
        ? settled(function() { return window.srtAPI.queryAIConfig(); })
        : Promise.resolve({ ok: false, value: null });

      Promise.all([ollamaCall, configCall]).then(function(results) {
        var ollamaResult = results[0];
        var configResult = results[1];
        if (!ollamaResult.ok && !configResult.ok) {
          renderSources(null);
          return;
        }

        var detection = {};
        if (ollamaResult.ok) detection.ollama = ollamaResult.value;
        var config = configResult.ok ? configResult.value : null;
        var hasCloudConfig = validCloudConfig(config);
        if (hasCloudConfig) detection.cloudConfig = { available: true, provider: config.provider.trim() };
        renderSources(detection);

        if (hasCloudConfig) {
          var st = document.getElementById('aiStatus');
          if (st) st.textContent = '当前 Key: ' + cloudKeyHint(config.key) + ' (' + config.provider + ')';
        }
      });
    } else {
      // 非 Electron → 手动模式
      renderSources(null);
    }

    // localStorage 回退
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.AI_CONFIG));
      if (saved && saved.key) {
        document.getElementById('aiProvider').value = saved.provider || 'deepseek';
        document.getElementById('aiKey').value = saved.key;
        var st2 = document.getElementById('aiStatus');
        if (st2) st2.textContent = '已保存（仅本浏览器）';
      }
    } catch (_) {}
  })();

  document.getElementById('btnAiSave').addEventListener('click', function() {
    var config = {
      provider: document.getElementById('aiProvider').value,
      key: document.getElementById('aiKey').value.trim()
    };
    if (!config.key) {
      document.getElementById('aiStatus').textContent = '请输入 API Key';
      return;
    }
    localStorage.setItem(STORAGE_KEYS.AI_CONFIG, JSON.stringify(config));
    document.getElementById('aiStatus').textContent = '已保存 ' + config.provider;
  });

  detectEnvironment();
}
