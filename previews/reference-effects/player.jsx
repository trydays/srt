import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from '@remotion/player';
import { ReferenceComposition } from './composition';
import { SCENES, FPS, WIDTH, HEIGHT } from './scenes.mjs';

function Preview({ inputs }) {
  const [noBlur, setNoBlur] = useState(false);
  const [canvasBackground, setCanvasBackground] = useState(false);
  const [diagnostic, setDiagnostic] = useState(false);
  return <main>
    <header><span className="eyebrow">SRT · REMOTION / R5</span><h1>两种参考效果 · 视觉试做</h1>
      <p>本轮新绘制毛玻璃与重点文字。文案、时段为人工配置，尚未接入自动提炼或正式编辑器。</p></header>
    <div className="note">参考原音与人物来自 2–10 秒、14–28 秒。为避开原片烧录效果，两侧使用演示背景；中间原有字幕仍属原片。粉色按你的要求调整。</div>
    {Object.entries(SCENES).map(([scene, settings]) => <section key={scene}>
      <div className="heading"><h2>{scene === 'glass' ? '01' : '02'} / {settings.title}</h2>
        <a href={`/${scene}.mp4`} download>{settings.durationInFrames / FPS} 秒成片 ↗</a></div>
      <Player component={ReferenceComposition} inputProps={{ ...inputs[scene],
        ...(scene === 'glass' ? { noBlur, canvasBackground, diagnostic } : {}) }}
        durationInFrames={settings.durationInFrames} fps={FPS}
        compositionWidth={WIDTH} compositionHeight={HEIGHT} controls
        style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden' }} />
      <p>{scene === 'glass' ? '粉色半透明底板、真实背景模糊、圆角柔光；前半段图片，后半段静音视频。'
        : '大标题 + 短说明 + 小标签，按两处语义错时出现、淡入淡出。'}</p>
      {scene === 'glass' ? <details><summary>画面核验</summary><div className="checks">
        <label><input type="checkbox" checked={noBlur} onChange={event => setNoBlur(event.target.checked)} />关闭模糊作对比</label>
        <label><input type="checkbox" checked={canvasBackground} onChange={event => setCanvasBackground(event.target.checked)} />使用调色后的背景</label>
        <label><input type="checkbox" checked={diagnostic} onChange={event => setDiagnostic(event.target.checked)} />直接叠加原片背景（仅核验，含原片已有卡片）</label>
      </div></details> : null}
    </section>)}
  </main>;
}
fetch('/inputs.json').then(response => {
  if (!response.ok) throw new Error('Preview inputs unavailable');
  return response.json();
}).then(inputs => createRoot(document.getElementById('root')).render(<Preview inputs={inputs} />))
  .catch(error => { document.getElementById('root').textContent = `预览加载失败：${error.message}`; });
