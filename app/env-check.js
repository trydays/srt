/* === env-check.js — 三天remotion 环境检测 === */

var toolList = document.getElementById('toolList');
if (!toolList) { console.error('[env-check] 非环境检测页面，跳过初始化'); }
else {

window.__PAGE = { id: 'env' };

/* Tab bar — 由 shared.js 提供 */
renderTabs();

/* Drive data (from Bash detection) */
var drives=[{name:'C:',free:2.9,total:93},{name:'D:',free:160.5,total:426},{name:'E:',free:268.6,total:426},{name:'F:',free:2.7,total:4}];
/* Auto-select largest */
var best=drives[0];for(var i=1;i<drives.length;i++){if(drives[i].free>best.free)best=drives[i]}
var selDrive=best;
/* Check localStorage override */
var saved=localStorage.getItem(STORAGE_KEYS.WORK_DRIVE);
if(saved){for(var i=0;i<drives.length;i++){if(drives[i].name===saved){selDrive=drives[i];break}}}

function renderDriveCard(){
  document.getElementById('driveSpace').textContent=selDrive.free+' GB 剩余';
  document.getElementById('driveTotal').textContent='共 '+selDrive.total+' GB';
  var chips='';
  for(var i=0;i<drives.length;i++){
    var d=drives[i];
    chips+='<button class="dchip'+(d.name===selDrive.name?' is-active':'')+'" onclick="selectDrive(\''+d.name+'\')">'+d.name+' <span class="dchip__free">'+d.free+'G</span></button>';
  }
  document.getElementById('driveChips').innerHTML=chips;
}
function selectDrive(name){
  for(var i=0;i<drives.length;i++){if(drives[i].name===name){selDrive=drives[i];break}}
  localStorage.setItem(STORAGE_KEYS.WORK_DRIVE,name);renderDriveCard();
}
renderDriveCard();

function cliInstall(tool, cb){
  if (window.electronAPI && window.electronAPI.install) {
    window.electronAPI.install(tool).then(function(r){ cb(r); }).catch(function(e){ cb({ok:false,stderr:e.message||'IPC 错误',exitCode:1}); });
  } else {
    fetch('/api/install', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:tool}) })
      .then(function(r){ return r.json(); }).then(cb).catch(function(e){ cb({ok:false,stderr:'无法连接本地服务',exitCode:1}); });
  }
}

/* ── 工具定义 + 检测命令 ── */
var tools=[
  {k:'ffmpeg', label:'FFmpeg', desc:'视频编解码引擎', size:'~300 MB', cmd:'ffmpeg -version',   install:'ffmpeg'},
  {k:'python', label:'Python', desc:'Whisper 语音转字幕', size:'~200 MB', cmd:'python --version', install:'python'},
  {k:'node',   label:'Node.js',desc:'Remotion 渲染运行时',size:'~100 MB', cmd:'node --version',   install:'node'},
  {k:'npm',    label:'npm',    desc:'包管理器',           size:'—',        cmd:'npm --version'},
  {k:'gpu',    label:'GPU',    desc:'CUDA 硬件加速渲染',  size:'~1 GB',   cmd:'nvidia-smi --query-gpu=name --format=csv,noheader'},
  {k:'cpu',    label:'CPU',    desc:'处理器',             size:'—',        cmd:'wmic cpu get name'},
  {k:'memory', label:'内存',   desc:'系统内存',           size:'—',        cmd:'wmic memorychip get capacity'},
  {k:'whisper',label:'Whisper',desc:'AI 语音识别转字幕',  size:'~1.5 GB', cmd:'pip show faster-whisper', install:'whisper'}
];

var envData={};  /* 检测结果: { ffmpeg: {ok,version}, ... } */
var installing={}; /* 正在安装中的工具 */

var statusBar=document.getElementById('statusBar');

/* ── 渲染工具列表 ── */
function renderTools(){
  var ok=0,warn=0,bad=0, h='';
  for(var i=0;i<tools.length;i++){
    var t=tools[i], v=envData[t.k];
    if(v&&v.ok){ok++}else if(v){warn++}else{bad++}
    var icon,status,slabel,detail,action='';
    if(v===undefined){ icon='⏳'; status=''; slabel='检测中…'; detail='—'; }
    else if(v.ok){ icon='✅'; status='ok'; slabel='已安装'; detail=v.version||'—'; }
    else { icon='❌'; status='bad'; slabel='未安装'; detail=v.error||'—';
      if(t.install){
        var busy=installing[t.install];
        action='<span class="tool-row__action">'+
          (busy?'<button class="btn-install installing" disabled>⏳ 安装中…</button>':
           '<button class="btn-install" onclick="doInstall(\''+t.install+'\')">⬇ 一键安装</button>')+
          '</span>';
      } else { action='<span class="tool-row__action"></span>'; }
    }
    h+='<div class="tool-row"><span class="tool-row__icon">'+icon+'</span><span class="tool-row__name">'+t.label+'</span><span class="tool-row__desc"><span class="tool-row__desc-text">'+t.desc+'</span><span class="tool-row__desc-size">'+t.size+'</span></span><span class="tool-row__detail">'+detail+'</span><span class="tool-row__status '+status+'">'+slabel+'</span>'+action+'</div>';
  }
  toolList.innerHTML=h;

  /* Status bar */
  var total=tools.length,detected=ok+warn+bad;
  statusBar.innerHTML=detected===total?
    '<strong>'+ok+'/'+total+'</strong> 项已就绪'+(bad>0?', <span style="color:var(--red)">'+bad+' 项缺失</span>':' ✅ 全部就绪'):
    '<strong>检测中…</strong> '+detected+'/'+total;

  if(bad===0 && detected===total){
    document.getElementById('cliBadge').textContent='✅ 可用';
    document.getElementById('cliBadge').className='mode-card__badge ok';
  }

  /* Disk estimate */
  updateDiskEstimate();
}

/* ── 获取捆绑工具（IPC 优先 → 开发模式无 IPC 回退 null） ── */
function getBundledToolsAsync(){
  return new Promise(function(resolve){
    if (window.electronAPI && window.electronAPI.getBundledTools) {
      window.electronAPI.getBundledTools().then(function(r){
        if (r && Object.keys(r).length > 0) { resolve({ source: 'ipc', tools: r }); return; }
        resolve(null);
      }).catch(function(){ resolve(null); });
    } else {
      resolve(null);
    }
  });
}

/* ── 并行执行检测（捆绑优先 → PATH 回退） ── */
function runParallelDetection(){
  renderTools();
  getBundledToolsAsync().then(function(bundled){
    var pending = [];
    for(var i=0;i<tools.length;i++){
      var t=tools[i];
      if(!t.cmd){ envData[t.k]={ok:true,version:'—'}; continue; }

      /* 步骤1: 检查捆绑工具（安装包 → AppData） */
      var btool = bundled && bundled.tools && bundled.tools[t.k];
      if (btool && btool.path) {
        envData[t.k] = { ok: true, version: btool.version, source: bundled.source };
        continue;
      }

      /* 步骤2: 捆绑不可用 → PATH 扫描 */
      pending.push(new Promise(function(resolve){
        cliExec(t.cmd, 10000, function(r){
          if(r.ok){
            var v=r.stdout.split('\n')[0].trim().substring(0,80);
            envData[t.k]={ok:true, version:v};
          } else {
            envData[t.k]={ok:false, error:r.stderr||r.stdout||'未找到'};
          }
          resolve();
        });
      }));
    }
    if(pending.length > 0){
      Promise.all(pending).then(function(){ renderTools(); });
    } else {
      renderTools();
    }
  }).catch(function(){
    /* 获取捆绑信息异常 → 全部回退 PATH 扫描 */
    var pending = [];
    for(var i=0;i<tools.length;i++){
      var t=tools[i];
      if(!t.cmd){ envData[t.k]={ok:true,version:'—'}; continue; }
      pending.push(new Promise(function(resolve){
        cliExec(t.cmd, 10000, function(r){
          if(r.ok){
            var v=r.stdout.split('\n')[0].trim().substring(0,80);
            envData[t.k]={ok:true, version:v};
          } else {
            envData[t.k]={ok:false, error:r.stderr||r.stdout||'未找到'};
          }
          resolve();
        });
      }));
    }
    Promise.all(pending).then(function(){ renderTools(); });
  });
}

/* ── 磁盘估算 ── */
function updateDiskEstimate(){
  var needMB=0,missingList=[];
  for(var i=0;i<tools.length;i++){
    var t=tools[i],v=envData[t.k];
    if(v && !v.ok && t.install){
      if(t.k==='ffmpeg'){needMB+=300;missingList.push('FFmpeg (~300 MB)')}
      else if(t.k==='python'){needMB+=200;missingList.push('Python (~200 MB)')}
      else if(t.k==='node'){needMB+=100;missingList.push('Node.js (~100 MB)')}
      else if(t.k==='whisper'){needMB+=1500;missingList.push('Whisper (~1.5 GB)')}
      else if(t.k==='gpu'){needMB+=1000;missingList.push('GPU 驱动 (~1 GB)')}
    }
  }
  var needGB=(needMB/1024).toFixed(1);
  var diskEl=document.getElementById('diskEstimate');
  if(needMB===0){
    diskEl.innerHTML='<div class="disk-estimate__icon">✅</div><div class="disk-estimate__body"><div class="disk-estimate__title">无需额外磁盘空间</div><div class="disk-estimate__desc">所有必需工具已安装。</div></div>';
  } else {
    var enough=selDrive.free>=needGB;
    diskEl.innerHTML='<div class="disk-estimate__icon">'+(enough?'✅':'⚠️')+'</div><div class="disk-estimate__body"><div class="disk-estimate__title">预计需要 ~'+needGB+' GB 磁盘空间</div><div class="disk-estimate__desc">需安装: '+missingList.join('、')+(enough?'。当前 '+selDrive.name+' 剩余 '+selDrive.free+' GB, 空间充足。':'。当前 '+selDrive.name+' 仅剩 '+selDrive.free+' GB, 空间不足! 请清理或切换工作盘。')+'</div></div>';
  }
}

/* ── 一键安装 ── */
function doInstall(tool){
  if(installing[tool])return;
  installing[tool]=true; renderTools();
  cliInstall(tool, function(r){
    installing[tool]=false;
    if(r.ok){
      /* 重新检测该工具 */
      var t=null; for(var i=0;i<tools.length;i++){if(tools[i].install===tool){t=tools[i];break}}
      if(t&&t.cmd){
        cliExec(t.cmd, 10000, function(r2){
          if(r2.ok) envData[t.k]={ok:true, version:r2.stdout.split('\n')[0].trim().substring(0,80)};
          else envData[t.k]={ok:false, error:r2.stderr||'安装后仍检测不到'};
          renderTools();
        });
      }
    } else {
      alert(tool+' 安装失败:\n\n'+(r.stderr||r.stdout||'未知错误')+'\n\n请手动安装后点击"重新检测"。');
      renderTools();
    }
  });
}

/* ── 重新检测 ── */
document.getElementById('btnRetry').addEventListener('click',function(){
  envData={}; installing={}; renderTools();
  setTimeout(function(){ runParallelDetection(); }, 200);
});

/* ── 模式选择 ── */
var mode='cli';
var modeContainer=document.querySelector('.mode-row');
modeContainer.addEventListener('click',function(e){
  var el=e.target.closest('.mode-card');if(!el)return;
  setActiveChip(this, el, '.mode-card');mode=el.dataset.mode;
});

/* ── AI 配置（自动探测）── */
(function initAIDetection() {
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

    // Claude Code 凭证
    if (detection.claudeCredentials && detection.claudeCredentials.available) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm)"><span style="font-size:14px">🤖</span><span style="font-size:12px;font-weight:600;color:var(--text-strong)">Claude Code 凭证</span><span style="font-size:11px;color:var(--accent);margin-left:auto">✅ 已检测到</span></div>';
      found++;
    } else {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm);opacity:0.5"><span style="font-size:14px">🤖</span><span style="font-size:12px">Claude Code 凭证</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">未检测到</span></div>';
    }

    // OpenAI API Key
    if (detection.openaiCredentials && detection.openaiCredentials.available) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm)"><span style="font-size:14px">🔑</span><span style="font-size:12px;font-weight:600;color:var(--text-strong)">OpenAI API Key (Codex/Cursor 等)</span><span style="font-size:11px;color:var(--accent);margin-left:auto">✅ 已设置</span></div>';
      found++;
    } else {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm);opacity:0.5"><span style="font-size:14px">🔑</span><span style="font-size:12px">OpenAI API Key (Codex/Cursor 等)</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">未设置</span></div>';
    }

    // 环境变量
    if (detection.env && detection.env.available) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm)"><span style="font-size:14px">🔧</span><span style="font-size:12px;font-weight:600;color:var(--text-strong)">环境变量 SRT_AI_KEY</span><span style="font-size:11px;color:var(--accent);margin-left:auto">✅ 已设置</span></div>';
      found++;
    } else {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm);opacity:0.5"><span style="font-size:14px">🔧</span><span style="font-size:12px">环境变量 SRT_AI_KEY</span><span style="font-size:11px;color:var(--text-muted);margin-left:auto">未设置</span></div>';
    }

    // 配置文件
    if (detection.configFile && detection.configFile.available) {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-subtle);border-radius:var(--radius-sm)"><span style="font-size:14px">📄</span><span style="font-size:12px;font-weight:600;color:var(--text-strong)">配置文件 .srt.config.json</span><span style="font-size:11px;color:var(--accent);margin-left:auto">✅ 已配置</span></div>';
      found++;
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
  if (window.electronAPI && window.electronAPI.detectAI) {
    window.electronAPI.detectAI().then(function(r) { renderSources(r); })
    .catch(function() { renderSources(null); });
    // 同时查询当前配置（key hint）
    window.electronAPI.getAIConfig().then(function(cfg) {
      if (cfg && cfg.hasKey) {
        var st = document.getElementById('aiStatus');
        if (st) st.textContent = '当前 Key: ' + cfg.keyHint + ' (' + cfg.provider + ')';
      }
    }).catch(function(){});
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
  } catch(_) {}
})();

// 保存按钮（手动模式用）
document.getElementById('btnAiSave').addEventListener('click', function(){
  var cfg = { provider: document.getElementById('aiProvider').value, key: document.getElementById('aiKey').value.trim() };
  if (!cfg.key) { document.getElementById('aiStatus').textContent = '请输入 API Key'; return; }
  localStorage.setItem(STORAGE_KEYS.AI_CONFIG, JSON.stringify(cfg));
  document.getElementById('aiStatus').textContent = '已保存 ' + cfg.provider;
});

/* ── 确认 ── */
document.getElementById('btnConfirm').addEventListener('click',function(){
  localStorage.setItem(STORAGE_KEYS.ENV_DONE,'1');localStorage.setItem(STORAGE_KEYS.RENDER_MODE,mode);
  location.href='主页.html';
});

/* ── 启动：先尝试实时检测，失败则回退到静态 JSON ── */
(function init(){
  /* 先标全部为"等待中" */
  for(var i=0;i<tools.length;i++){if(!tools[i].cmd)envData[tools[i].k]={ok:true,version:'—'}}
  renderTools();

  /* 测试 server.js 是否可达 */
  fetch('/api/exec', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cmd:'echo ok',timeout:3000}) })
    .then(function(r){ return r.json(); })
    .then(function(r){
      if(r&&r.ok){ runParallelDetection(); return; }
      throw new Error('unreachable');
    })
    .catch(function(e){
      console.error('[环境检测] CLI 不可达，回退静态 JSON:', e.message);
      /* 异步回退到静态 JSON */
      fetch('env-result.json?v='+Date.now())
        .then(function(r){ return r.ok ? r.json() : Promise.reject('HTTP '+r.status); })
        .then(function(d){
          for(var i=0;i<tools.length;i++){
            var t=tools[i],v=d[t.k];
            if(v&&v.status==='ok')envData[t.k]={ok:true,version:v.version||v.name||'—'};
            else if(v)envData[t.k]={ok:false,error:'未安装'};
          }
          renderTools();
        })
        .catch(function(err){
          console.error('[环境检测] 静态 JSON 也加载失败:', err);
          renderTools();
        });
    });
})();

} /* end if(toolList) page guard */
