import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { ReferenceComposition } from './composition';
import { SCENES, FPS, WIDTH, HEIGHT } from './scenes.mjs';

registerRoot(() => <>{Object.entries(SCENES).map(([scene, settings]) =>
  <Composition key={scene} id={settings.id} component={ReferenceComposition}
    width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={settings.durationInFrames}
    defaultProps={{ scene }} />)}</>);
