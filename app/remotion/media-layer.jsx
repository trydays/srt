import React from 'react';
import { Img, OffthreadVideo, Sequence } from 'remotion';
import visualMedia from '../../src/visual-media';

export function MediaLayer({ layer, range, fps, width, height, assets }) {
  const params = visualMedia.normalizeMediaParams(layer.kind, layer.params);
  const source = assets?.[params.assetId];
  if (!source?.src) throw new Error('REMOTION_MEDIA_MISSING');
  const geometry = visualMedia.geometry(layer.kind, params, width, height);
  const timing = visualMedia.frameTiming(range, fps,
    layer.kind === 'video' ? params.sourceStartSeconds : 0);
  const style = { position: 'absolute', left: geometry.x, top: geometry.y,
    width: geometry.width, height: geometry.height, objectFit: geometry.fit,
    borderRadius: geometry.cornerRadius };
  return <Sequence from={timing.firstFrame} durationInFrames={timing.durationInFrames}
    layout="none" name={`media-${params.assetId}`}>
    <div data-media-kind={layer.kind} data-media-asset={params.assetId}>
      {layer.kind === 'image'
        ? <Img data-media-asset={params.assetId} src={source.src} style={style} />
        : <OffthreadVideo src={source.src} startFrom={timing.sourceStartFrame}
          muted loop={false} pauseWhenBuffering style={style} />}
    </div>
  </Sequence>;
}
