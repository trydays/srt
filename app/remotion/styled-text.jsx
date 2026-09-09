import React from 'react';
import visualLayers from '../../src/visual-layers';

const { FONT_FAMILY } = visualLayers;

function shadowFilter(color, opacity, blur) {
  if (!blur) return undefined;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const shadowColor = match
    ? `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${opacity})`
    : color;
  return `drop-shadow(0 0 ${blur}px ${shadowColor})`;
}

export function StyledText({ geometry, frameStyle = {} }) {
  const {
    lines,
    fontSize,
    color,
    fontWeight = 400,
    letterSpacing = 0,
    shadowBlur = 0,
    shadowColor = '#000000',
    shadowOpacity = 0
  } = geometry;
  const { opacity = 1, scale = 1, pivotX = 0, pivotY = 0 } = frameStyle;
  const transform = `translate(${pivotX} ${pivotY}) scale(${scale}) translate(${-pivotX} ${-pivotY})`;
  const style = {
    fill: color,
    fontFamily: FONT_FAMILY,
    fontSize,
    fontWeight,
    letterSpacing,
    whiteSpace: 'pre',
    filter: shadowFilter(shadowColor, shadowOpacity, shadowBlur)
  };

  return <g opacity={opacity} transform={transform}>
    {lines.map((line, index) => <text key={index} x={line.x} y={line.baseline}
      xmlSpace="preserve" style={style}>{line.text}</text>)}
  </g>;
}
