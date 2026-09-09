import React, { useEffect, useState } from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig,
  delayRender, continueRender, cancelRender } from 'remotion';
import visualLayers from '../../src/visual-layers';
import { GroupLayer, StandaloneLayer, SubtitleLayer } from './layers';
import { isSourceEffect, SourceEffectsVideo } from './source-effects';

export function SrtComposition({ graph, assets, width, height }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('SRT composition fonts'));
  useEffect(() => {
    let active = true;
    const fontSet = typeof document === 'undefined' ? null : document.fonts;
    const requests = [];
    if (fontSet) {
      graph.nodes.forEach(node => {
        if (node.type === 'visual.group@1') node.props.layers.filter(layer => layer.kind === 'text').forEach(layer => {
          const geometry = visualLayers.geometry('text', layer.params, width, height);
          requests.push(fontSet.load(`normal ${geometry.fontWeight} ${geometry.fontSize}px "${visualLayers.FONT_FAMILY}"`, layer.params.text));
        });
        if (node.type === 'visual.text@1') {
          const geometry = visualLayers.geometry('text', node.props, width, height);
          requests.push(fontSet.load(`normal ${geometry.fontWeight} ${geometry.fontSize}px "${visualLayers.FONT_FAMILY}"`, node.props.text));
        }
        if (node.type === 'visual.subtitle@1') {
          const style = node.props.style;
          const size = height * style.fontSize / style.referenceHeight;
          requests.push(fontSet.load(`normal ${size}px "${style.fontFamily}"`,
            node.props.segments.map(segment => segment.text).join('\n')));
        }
      });
    }
    Promise.all(requests).then(() => fontSet?.ready).then(() => {
      if (active) continueRender(fontHandle);
    }).catch(error => { if (active) cancelRender(error); });
    return () => { active = false; continueRender(fontHandle); };
  }, [fontHandle, graph, width, height]);
  function renderNode(node) {
      if (node.type === 'source.video@1') {
        const source = assets[node.props.assetId];
        if (!source?.src) throw new Error('REMOTION_SOURCE_MISSING');
        if (graph.nodes.some(isSourceEffect)) return <SourceEffectsVideo key={node.id}
          src={source.src} graph={graph} frame={frame} fps={fps} width={width} height={height} />;
        return <OffthreadVideo key={node.id} src={source.src} pauseWhenBuffering
          style={{ width: '100%', height: '100%', objectFit: 'fill' }} />;
      }
      if (isSourceEffect(node)) return null;
      if (node.type === 'visual.group@1') return <GroupLayer key={node.id}
        node={node} frame={frame} fps={fps} width={width} height={height} assets={assets} />;
      if (node.type === 'visual.shape@1' || node.type === 'visual.text@1') {
        return <StandaloneLayer key={node.id} node={node} frame={frame} fps={fps}
          width={width} height={height} />;
      }
      if (node.type === 'visual.subtitle@1') return <SubtitleLayer key={node.id}
        node={node} frame={frame} fps={fps} width={width} height={height} />;
      throw new Error('REMOTION_GRAPH_UNSUPPORTED');
  }
  return <AbsoluteFill style={{ backgroundColor: '#000000', overflow: 'hidden' }}>
    {graph.nodes.filter(node => node.type !== 'visual.subtitle@1').map(renderNode)}
    {graph.nodes.filter(node => node.type === 'visual.subtitle@1').map(renderNode)}
  </AbsoluteFill>;
}
