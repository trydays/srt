import React, { useCallback, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { OffthreadVideo, useDelayRender, useRemotionEnvironment } from 'remotion';
import colorAdjustment from '../../src/color-adjustment';
import videoTransform from '../../src/video-transform';
import videoTexture from '../../src/video-texture';

export function isSourceEffect(node) {
  return ['video.color@1', 'video.transform@1', 'video.noise@1', 'video.vignette@1'].includes(node.type);
}

// Both Player video frames and render-time extracted images enter this same
// intrinsic-size path. Each destination clips before the next graph operation.
function createSourceCompositor(canvas) {
  const buffers = [document.createElement('canvas'), document.createElement('canvas')];
  const contexts = buffers.map(buffer => buffer.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }));
  const display = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!display || contexts.some(context => !context)) throw new Error('REMOTION_SOURCE_CANVAS_UNAVAILABLE');
  return (source, nodes, filters, frame, fps, width, height) => {
    for (const buffer of [canvas, ...buffers]) {
      if (buffer.width !== width) buffer.width = width;
      if (buffer.height !== height) buffer.height = height;
    }
    let previous = 0;
    contexts[0].filter = 'none';
    contexts[0].fillStyle = '#000000';
    contexts[0].fillRect(0, 0, width, height);
    contexts[0].drawImage(source, 0, 0, width, height);
    for (const node of nodes) {
      if (!isSourceEffect(node) || !colorAdjustment.isActive(node.range, frame / fps)) continue;
      const next = 1 - previous, context = contexts[next];
      context.filter = 'none'; context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      if (node.type === 'video.transform@1') {
        const geometry = videoTransform.geometry(node.props, width, height);
        const { flipHorizontal, flipVertical } = geometry.params;
        context.save();
        context.translate(geometry.offsetX + (flipHorizontal ? geometry.scaledWidth : 0),
          geometry.offsetY + (flipVertical ? geometry.scaledHeight : 0));
        context.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
        context.drawImage(buffers[previous], 0, 0, width, height,
          0, 0, geometry.scaledWidth, geometry.scaledHeight);
        context.restore();
      } else if (node.type === 'video.color@1') {
        context.filter = `url(#${filters.get(node.id)})`;
        context.drawImage(buffers[previous], 0, 0);
        context.filter = 'none';
      } else {
        context.drawImage(buffers[previous], 0, 0);
        const pixels = context.getImageData(0, 0, width, height);
        videoTexture.applyFrame(node.type === 'video.noise@1' ? 'noise' : 'vignette',
          node.props, pixels.data, width, height, frame / fps);
        context.putImageData(pixels, 0, 0);
      }
      previous = next;
    }
    display.clearRect(0, 0, width, height);
    display.drawImage(buffers[previous], 0, 0);
    canvas.dataset.drawnFrame = String(frame);
  };
}

export function SourceEffectsVideo({ src, graph, frame, fps, width, height }) {
  const canvas = useRef(null), compositor = useRef(null), pending = useRef(null);
  const current = useRef(null), decoded = useRef(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const colors = useMemo(() => graph.nodes.filter(node => node.type === 'video.color@1')
    .map((node, index) => ({ node, id: `source-color-${id}-${index}`,
      matrices: colorAdjustment.buildPreviewMatrices(node.props) })), [graph, id]);
  const filters = useMemo(() => new Map(colors.map(color => [color.node.id, color.id])), [colors]);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const { isRendering } = useRemotionEnvironment();
  // Keep onVideoFrame stable: changing it makes Remotion's existing Img decode
  // its previous blob while OffthreadVideo is already revoking that blob.
  const draw = useCallback((image, _now, metadata) => {
    if (!canvas.current || !current.current) return;
    const { graph, filters, frame, fps, width, height, src } = current.current;
    // Remotion also calls onVideoFrame synchronously when the callback changes.
    // A seeking/not-yet-decoded video still contains the preceding image.
    if ('readyState' in image && (image.readyState < 2 || image.seeking
        || Math.abs((metadata?.mediaTime ?? image.currentTime) - frame / fps) > 1 / fps + 1e-6)) return;
    try {
      if (!compositor.current) compositor.current = createSourceCompositor(canvas.current);
      compositor.current(image, graph.nodes, filters, frame, fps, width, height);
      decoded.current = { image, frame, src };
      if (pending.current !== null) continueRender(pending.current);
      pending.current = null;
    } catch (error) {
      canvas.current.getContext('2d')?.clearRect(0, 0, width, height);
      delete canvas.current.dataset.drawnFrame;
      cancelRender(error);
    }
  }, [continueRender, cancelRender]);
  useLayoutEffect(() => {
    current.current = { graph, filters, frame, fps, width, height, src };
    delete canvas.current.dataset.drawnFrame;
    // Audio-only extraction does not request an image. Otherwise every new
    // frame/revision stays pending until its synchronous Canvas draw completes.
    if (isRendering && window.remotion_videoEnabled !== false) {
      pending.current = delayRender(`Drawing source frame ${frame}`);
    }
    const last = decoded.current;
    // A paused revision has no new decoded frame event; re-use only the exact
    // current frame, never the preceding extracted image after a seek.
    if (last?.src === src && last.frame === frame) draw(last.image);
    return () => {
      if (pending.current !== null) continueRender(pending.current);
      pending.current = null;
    };
  }, [graph, filters, frame, fps, width, height, src, isRendering, delayRender, continueRender, draw]);
  return <>
    <OffthreadVideo src={src} pauseWhenBuffering onVideoFrame={draw}
      onLoadedData={event => draw(event.currentTarget)} onSeeked={event => draw(event.currentTarget)}
      acceptableTimeShiftInSeconds={1 / fps} style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0 }} />
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
      {colors.map(color => <filter key={color.id} id={color.id} colorInterpolationFilters="sRGB">
        {Object.entries(color.matrices).map(([name, matrix]) =>
          <feColorMatrix key={name} type="matrix" values={matrix.join(' ')} />)}
      </filter>)}
    </defs></svg>
    <canvas ref={canvas} data-source-effects="" width={width} height={height}
      style={{ position: 'absolute', width: '100%', height: '100%' }} />
  </>;
}
