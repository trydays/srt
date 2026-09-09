import React from 'react';

function rgba(hex, opacity) {
  return `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${opacity})`;
}

// Keep the backdrop filter on the animated surface itself: an opacity wrapper
// would create a new backdrop root and hide the video from the blur sampler.
export function GlassSurface({ geometry, frameStyle = {}, clipContent = true, children }) {
  const { x, y, width, height, cornerRadius = 0, color = '#FFFFFF', fillOpacity = 0,
    backdropBlur = 0, borderWidth = 0, borderColor = '#FFFFFF', glowColor = '#FFFFFF',
    glowOpacity = 0, glowBlur = 0 } = geometry;
  const { opacity = 1, scale = 1, pivotX = x + width / 2, pivotY = y + height / 2 } = frameStyle;
  if (opacity === 0 || scale === 0) return null;
  return <div data-glass-surface="true" style={{ position: 'absolute',
    left: x, top: y, width, height, borderRadius: cornerRadius,
    backgroundColor: rgba(color, fillOpacity),
    backdropFilter: backdropBlur > 0 ? `blur(${backdropBlur}px)` : undefined,
    WebkitBackdropFilter: backdropBlur > 0 ? `blur(${backdropBlur}px)` : undefined,
    boxShadow: `0 0 ${glowBlur}px ${rgba(glowColor, glowOpacity)}, inset 0 0 0 ${borderWidth}px ${borderColor}`,
    opacity, transform: `scale(${scale})`, transformOrigin: `${pivotX - x}px ${pivotY - y}px` }}>
    <div data-glass-content="true" style={{ position: 'absolute', inset: borderWidth,
      borderRadius: Math.max(0, cornerRadius - borderWidth),
      overflow: clipContent ? 'hidden' : 'visible' }}>{children}</div>
  </div>;
}
