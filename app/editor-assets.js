(function() {
  'use strict';
  var button = document.querySelector('[data-testid="project-media-import"]');
  var select = document.querySelector('[data-testid="project-media-select"]');
  var row = document.querySelector('[data-project-media-row]');
  var status = document.querySelector('[data-testid="project-media-status"]');
  var projectId = getActiveProjectId(), assets = [], busy = false;
  function message(text) { status.textContent = text || ''; status.hidden = !text; }
  function errorMessage(error) {
    if (error && error.code === 'PROJECT_ASSET_MISSING') return '素材文件已移动或不可读取，请重新导入。';
    return '素材未能读取。请使用本地 PNG、JPEG、WebP 图片或 MP4 视频后重试。';
  }
  function render() {
    var selectedId = select.value;
    select.replaceChildren();
    var empty = document.createElement('option');
    empty.value = ''; empty.textContent = '不指定，由 AI 按需求选择'; select.appendChild(empty);
    assets.forEach(function(asset) {
      var option = document.createElement('option'); option.value = asset.assetId;
      option.textContent = (asset.kind === 'video' ? '视频 · ' : '图片 · ') + asset.name;
      select.appendChild(option);
    });
    select.value = assets.some(function(asset) { return asset.assetId === selectedId; }) ? selectedId : '';
    row.hidden = assets.length === 0;
    button.disabled = busy;
    select.disabled = busy;
  }
  async function refresh() {
    if (!window.srtAPI || !window.srtAPI.listProjectMedia) return [];
    var result = await window.srtAPI.listProjectMedia({ projectId: projectId });
    if (projectId !== getActiveProjectId()) return [];
    if (!result || !result.ok) throw Object.assign(new Error('Project media unavailable'), {code:result && result.errorCode});
    assets = result.assets; render(); return assets.slice();
  }
  button.addEventListener('click', async function() {
    if (busy || !window.srtAPI || !window.srtAPI.importProjectMedia) return;
    busy = true; render(); message('');
    try {
      var result = await window.srtAPI.importProjectMedia({projectId:projectId});
      if (projectId !== getActiveProjectId()) return;
      if (!result || !result.ok) throw Object.assign(new Error('Import failed'), {code:result && result.errorCode});
      await refresh();
      if (result.assets.length) {
        select.value = result.assets[result.assets.length - 1].assetId;
        message('素材已准备好。描述显示时间、位置和卡片样式即可。视频素材默认静音。');
      }
    } catch (error) { message(errorMessage(error)); }
    finally { busy = false; render(); }
  });
  window.projectAssetsController = {
    refresh: refresh,
    list: function() { return assets.map(function(asset) { return Object.assign({}, asset); }); },
    selected: function() { return assets.find(function(asset) { return asset.assetId === select.value; }) || null; },
    ready: refresh().catch(function(error) { message(errorMessage(error)); return []; })
  };
})();
