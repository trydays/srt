/* === editor-core.js — 三天remotion 编辑器核心 === */

/* ── Component data (from components-data.js) ── */
var COMPONENTS = window.COMPONENTS;

/* ── Render cards ── */
var compBody=document.getElementById('compBody'),activeCat='入场',searchTerm='';
function renderComps(){
  var f=COMPONENTS.filter(function(c){if(activeCat!=='all'&&c.cat!==activeCat)return false;if(searchTerm&&c.name.toLowerCase().indexOf(searchTerm.toLowerCase())===-1)return false;return true});
  var h='';
  for(var i=0;i<f.length;i++){
    var c=f[i];
    h+='<div class="comp-card" draggable="true" data-name="'+c.name+'" data-cat="'+c.cat+'"><div class="comp-card__preview"><div class="swatch"><span style="background:'+c.color+'"></span><span style="background:'+c.color+'cc"></span><span style="background:'+c.color+'88"></span><span style="background:'+c.color+'44"></span></div></div><div class="comp-card__body"><div class="comp-card__title">'+c.name+'</div><div class="comp-card__desc">'+c.desc+'</div></div></div>';
  }
  compBody.innerHTML=h||'<div style="color:var(--text-faint);text-align:center;padding:40px 0;font-size:13px">无匹配组件</div>';
  bindDrag();
}
function bindDrag(){
  var cards=compBody.querySelectorAll('.comp-card');
  for(var i=0;i<cards.length;i++){
    cards[i].addEventListener('dragstart',function(e){this.classList.add('dragging');e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',this.dataset.name)});
    cards[i].addEventListener('dragend',function(){this.classList.remove('dragging')});
  }
}
if (!compBody) { console.error('[editor-core] 非编辑器页面，跳过初始化'); }
else {
renderComps();

/* ── Search ── */
var si=document.getElementById('compSearch'),sc=document.getElementById('compSearchClear');
si.addEventListener('input',function(){searchTerm=this.value.trim();sc.style.display=searchTerm?'inline-flex':'none';renderComps()});
sc.addEventListener('click',function(){si.value='';searchTerm='';sc.style.display='none';renderComps();si.focus()});

/* ── Category chips ── */
document.getElementById('compChips').addEventListener('click',function(e){
  var chip=e.target.closest('.comp-chip');if(!chip)return;
  setActiveChip(this, chip, '.comp-chip');activeCat=chip.dataset.cat;renderComps();
});

/* ── Split resize (OD split-resize-handle) ── */
var splitRoot=document.getElementById('splitRoot'),handle=document.getElementById('splitHandle'),resizing=false,startX=0,startW=280;
handle.addEventListener('mousedown',function(e){resizing=true;splitRoot.classList.add('is-resizing');startX=e.clientX;startW=parseInt(getComputedStyle(splitRoot).gridTemplateColumns.split('px')[0]);document.body.style.cursor='col-resize';document.body.style.userSelect='none';e.preventDefault()});
document.addEventListener('mousemove',function(e){if(!resizing)return;var w=Math.max(180,Math.min(500,startW+e.clientX-startX));splitRoot.style.gridTemplateColumns=w+'px 8px minmax(0,1fr)';splitRoot.style.setProperty('--comp-panel-w',w+'px')});
document.addEventListener('mouseup',function(){if(!resizing)return;resizing=false;splitRoot.classList.remove('is-resizing');document.body.style.cursor='';document.body.style.userSelect=''});

/* ── Video ── */
var videoEl=document.getElementById('previewVideo'),videoUrl=null,videoDuration=0;
var playBtn=document.getElementById('playBtn'),previewOverlay=document.getElementById('previewOverlay');
var tlPlayBtn=document.getElementById('tlPlayBtn');
function formatDur(s){var m=Math.floor(s/60),se=Math.floor(s%60);return(m<10?'0':'')+m+':'+(se<10?'0':'')+se}

function showVideo(file){
  if(videoUrl)URL.revokeObjectURL(videoUrl);
  videoUrl=URL.createObjectURL(file);videoEl.src=videoUrl;
  var a=document.getElementById('previewArea');
  document.getElementById('previewPlaceholder').style.display='none';
  document.getElementById('previewUpload').style.display='none';
  a.classList.add('has-video');previewOverlay.style.display='flex';
  videoEl.onloadedmetadata=function(){
    videoDuration=videoEl.duration;
    document.getElementById('tlTotal').textContent=formatDur(videoDuration);
  };
}

/* Load video from IndexedDB (set by homepage upload) */
/* Try loading video from IndexedDB (set by homepage upload) */
(function(){
  try {
    var req = indexedDB.open('srt_store', 1);
    req.onupgradeneeded = function(e){ e.target.result.createObjectStore('files'); };
    req.onsuccess = function(e){
      var tx = e.target.result.transaction('files','readonly');
      var get = tx.objectStore('files').get('current_video');
      get.onsuccess = function(){ if(get.result) showVideo(get.result); };
    };
  } catch(e) { console.error('[IndexedDB] 打开失败:', e.message); }
})();

function setPlayUI(playing){
  playBtn.textContent=playing?'⏸':'▶';tlPlayBtn.textContent=playing?'⏸':'▶';
  document.getElementById('previewArea').classList.toggle('paused',!playing);
}
function togglePlay(){
  if(!videoDuration)return;
  if(videoEl.paused){videoEl.play()}
  else{videoEl.pause()}
}
videoEl.addEventListener('play',function(){setPlayUI(true)});
videoEl.addEventListener('pause',function(){setPlayUI(false)});
videoEl.addEventListener('ended',function(){setPlayUI(false)});
videoEl.addEventListener('click',togglePlay);
playBtn.addEventListener('click',function(e){e.stopPropagation();togglePlay()});
tlPlayBtn.addEventListener('click',function(e){e.stopPropagation();togglePlay()});

/* ── Speed control ── */
var speeds=[0.5,1,1.5,2],speedIdx=1;
var tlSpeedBtn=document.getElementById('tlSpeedBtn');
tlSpeedBtn.addEventListener('click',function(e){e.stopPropagation();speedIdx=(speedIdx+1)%speeds.length;var s=speeds[speedIdx];videoEl.playbackRate=s;tlSpeedBtn.textContent=s+'×'});

/* ── Volume slider ── */
var tlVolBtn=document.getElementById('tlVolBtn'),tlVolSlider=document.getElementById('tlVolSlider');
tlVolBtn.addEventListener('click',function(e){e.stopPropagation();videoEl.muted=!videoEl.muted;tlVolBtn.textContent=videoEl.muted?'🔇':'🔊'});
tlVolSlider.addEventListener('input',function(){var v=this.value/100;videoEl.volume=v;videoEl.muted=(v===0);tlVolBtn.textContent=(v===0||videoEl.muted)?'🔇':'🔊'});
videoEl.addEventListener('volumechange',function(){tlVolSlider.value=Math.round(videoEl.volume*100);tlVolBtn.textContent=videoEl.muted||videoEl.volume===0?'🔇':'🔊'});

/* Re-upload */
document.getElementById('reupload').addEventListener('change',function(){
  var f=this.files[0];if(!f)return;
  var info={name:f.name,size:f.size,type:f.type,lastMod:f.lastModified};
  try{localStorage.setItem(STORAGE_KEYS.VIDEO,JSON.stringify(info))}catch(_){}
  showVideo(f);
});
} // end if(compBody)
