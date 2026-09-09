import React from 'react';
import visualGroup from '../../src/visual-group';
import visualLayers from '../../src/visual-layers';
import { GlassSurface } from './glass-surface';
import { StyledText } from './styled-text';
import { MediaLayer } from './media-layer';

function formalShape(geometry) {
  return geometry.backdropBlur > 0 || geometry.glowBlur > 0 || geometry.glowOpacity > 0;
}

function formalText(geometry) {
  return geometry.fontWeight !== 400 || geometry.letterSpacing > 0
    || geometry.shadowBlur > 0 || geometry.shadowOpacity > 0;
}

export function VisualLayer({ layer, width, height }) {
  const geometry = visualLayers.geometry(layer.kind, layer.params, width, height);
  if (layer.kind === 'shape') {
    const radius = geometry.cornerRadius;
    const borderWidth = geometry.borderWidth;
    return <>
      <rect x={geometry.x} y={geometry.y} width={geometry.width}
        height={geometry.height} rx={radius} ry={radius} fill={geometry.color}
        fillOpacity={geometry.fillOpacity} />
      {borderWidth > 0 ? <rect x={geometry.x + borderWidth / 2}
        y={geometry.y + borderWidth / 2} width={geometry.width - borderWidth}
        height={geometry.height - borderWidth} rx={Math.max(0, radius - borderWidth / 2)}
        ry={Math.max(0, radius - borderWidth / 2)} fill="none"
        stroke={geometry.borderColor} strokeWidth={borderWidth} /> : null}
    </>;
  }
  if (formalText(geometry)) return <StyledText geometry={geometry} />;
  return <g fill={geometry.color} style={{ fontFamily: visualLayers.FONT_FAMILY,
    fontSize: geometry.fontSize, fontWeight: 'normal', fontStyle: 'normal', whiteSpace: 'pre' }}>
    {geometry.lines.map((line, index) => <text key={index} x={line.x} y={line.baseline}
      xmlSpace="preserve" textAnchor="start">{line.text}</text>)}
  </g>;
}

function isVisible(node, frame, fps) {
  const time = frame / fps;
  return node.range.start <= time && time < node.range.end;
}

export function StandaloneLayer({ node, frame, fps, width, height }) {
  if (!isVisible(node, frame, fps)) return null;
  const kind = node.type === 'visual.shape@1' ? 'shape' : 'text';
  const geometry = visualLayers.geometry(kind, node.props, width, height);
  if (kind === 'shape' && formalShape(geometry)) {
    return <div data-layer-id={node.id} style={{ position: 'absolute', inset: 0 }}>
      <GlassSurface geometry={geometry} />
    </div>;
  }
  return <svg data-layer-id={node.id} width={width} height={height}
    viewBox={`0 0 ${width} ${height}`} overflow="hidden"
    style={{ position: 'absolute', inset: 0 }}>
    <VisualLayer layer={{ kind, params: node.props }} width={width} height={height} />
  </svg>;
}

function rgba(hex, opacity) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${opacity})`;
}

export function SubtitleLayer({ node, frame, fps, height }) {
  if (!isVisible(node, frame, fps)) return null;
  const time = frame / fps;
  const text = node.props.segments
    .filter(segment => segment.start <= time && time < segment.end)
    .map(segment => segment.text).join('\n');
  if (!text) return null;
  const style = node.props.style;
  return <div data-subtitle-id={node.id} style={{ position: 'absolute', left: '50%',
    bottom: `${style.bottomPercent}%`, maxWidth: `${style.maxWidthPercent}%`,
    transform: 'translateX(-50%)', padding: '6px 10px', borderRadius: 4,
    backgroundColor: rgba(style.backgroundColor, style.backgroundOpacity),
    color: style.textColor, fontFamily: style.fontFamily,
    fontSize: height * style.fontSize / style.referenceHeight, lineHeight: 1.45,
    textAlign: 'center', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{text}</div>;
}

export function GroupLayer({ node, frame, fps, width, height, assets = {} }) {
  const sample = visualGroup.sample(node.props, node.range, frame / fps, width, height);
  if (!sample || sample.opacity === 0 || sample.scale === 0) return null;
  const first = node.props.layers[0];
  const firstGeometry = first?.kind === 'shape'
    ? visualLayers.geometry('shape', first.params, width, height) : null;
  const laterFormalShape = node.props.layers.slice(1).some(layer => layer.kind === 'shape'
    && formalShape(visualLayers.geometry('shape', layer.params, width, height)));
  if (laterFormalShape) throw new Error('REMOTION_GLASS_GROUP_LAYOUT');
  if (firstGeometry && formalShape(firstGeometry)) {
    const pivotX = node.props.pivotX * width;
    const pivotY = node.props.pivotY * height;
    return <div data-group-id={node.id} style={{ position: 'absolute', inset: 0 }}>
      <GlassSurface geometry={firstGeometry} clipContent={false} frameStyle={{ opacity: sample.opacity,
        scale: sample.scale, pivotX, pivotY }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
          overflow="hidden" style={{ position: 'absolute',
            left: -firstGeometry.x - firstGeometry.borderWidth,
            top: -firstGeometry.y - firstGeometry.borderWidth }}>
          {node.props.layers.slice(1).map((layer, index) =>
            layer.kind === 'image' || layer.kind === 'video'
              ? <foreignObject key={index} x="0" y="0" width={width} height={height}>
                <MediaLayer layer={layer} range={node.range} fps={fps} width={width}
                  height={height} assets={assets} />
              </foreignObject>
              : <VisualLayer key={index} layer={layer} width={width} height={height} />)}
        </svg>
      </GlassSurface>
    </div>;
  }
  const hasMedia = node.props.layers.some(layer => layer.kind === 'image' || layer.kind === 'video');
  if (hasMedia) {
    return <div data-group-id={node.id} style={{ position: 'absolute', left: sample.x,
      top: sample.y, width, height, opacity: sample.opacity,
      transform: `scale(${sample.width / width}, ${sample.height / height})`,
      transformOrigin: '0 0', overflow: 'hidden' }}>
      {node.props.layers.map((layer, index) =>
        layer.kind === 'image' || layer.kind === 'video'
          ? <MediaLayer key={index} layer={layer} range={node.range} fps={fps} width={width}
            height={height} assets={assets} />
          : <svg key={index} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
            style={{ position: 'absolute', inset: 0 }}>
            <VisualLayer layer={layer} width={width} height={height} />
          </svg>)}
    </div>;
  }
  // The nested SVG clips children in source-frame coordinates before scaling;
  // its opacity composites the whole group, including overlapping children.
  return <svg data-group-id={node.id} width={width} height={height}
    viewBox={`0 0 ${width} ${height}`} overflow="hidden"
    style={{ position: 'absolute', inset: 0 }}>
    <svg x={sample.x} y={sample.y} width={sample.width} height={sample.height}
      viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" overflow="hidden"
      opacity={sample.opacity}>
      {node.props.layers.map((layer, index) => <VisualLayer key={index} layer={layer}
        width={width} height={height} />)}
    </svg>
  </svg>;
}
