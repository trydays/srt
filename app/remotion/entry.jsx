import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { SrtComposition } from './SrtComposition';

// Registration only: render callers supply their validated source and graph.
const registrationInput = {
  graph: { schemaVersion: 1, projectId: 'registration', documentRevision: 0, duration: 1,
    nodes: [{ id: 'source', type: 'source.video@1', range: { start: 0, end: 1 },
      inputs: [], props: { assetId: 'source' } }],
    outputs: { video: { nodeId: 'source', port: 'video' }, audio: { nodeId: 'source', port: 'audio' } } },
  assets: { source: { src: 'http://127.0.0.1:9/registration/source' } },
  width: 320, height: 240, fps: 30, durationInFrames: 30
};

function RemotionRoot() {
  return <Composition id="SrtProject" component={SrtComposition}
    width={registrationInput.width} height={registrationInput.height} fps={registrationInput.fps}
    durationInFrames={registrationInput.durationInFrames} defaultProps={registrationInput}
    calculateMetadata={({ props }) => ({ width: props.width, height: props.height,
      fps: props.fps, durationInFrames: props.durationInFrames })} />;
}

registerRoot(RemotionRoot);
