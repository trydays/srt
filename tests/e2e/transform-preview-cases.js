// Runs in a real browser; shared by Playwright and the standalone browser check.
function runTransformPreviewCases() {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', 0); svg.setAttribute('height', 0);
  const defs = document.createElementNS(svgNS, 'defs'); svg.appendChild(defs); document.body.appendChild(svg);
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
  const compositor = window.SRTSourcePreview.createCompositor(canvas, defs), evidence = [];
  function source(width = 96, height = 64) {
    const frame = document.createElement('canvas'); frame.width = width; frame.height = height;
    const ctx = frame.getContext('2d');
    [['#d02020', 0, 0], ['#20c040', width / 2, 0], ['#2070d0', 0, height / 2], ['#e0b020', width / 2, height / 2]]
      .forEach(([color, x, y]) => { ctx.fillStyle = color; ctx.fillRect(x, y, width / 2, height / 2); });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(16, 12, 8, 8); return frame;
  }
  function graph(steps) {
    let previous = 'source';
    return { nodes: [{ id: previous, type: 'source.video@1' }].concat(steps.map(([capability, params], i) => {
      const registration = window.editCapabilityRegistry.get(capability);
      const edit = { id: 'pixel-' + i, range: { start: 1, end: 3 }, payload: capability === 'video.transform@1'
        ? window.SRTVideoTransform.normalizeParams(params, true) : window.SRTColorAdjustment.normalizeParams(params, true) };
      const node = registration.toGraph(edit, { videoHead: previous }); previous = node.id; return node;
    })) };
  }
  const transform = p => ['video.transform@1', p], color = p => ['video.color.adjust@1', p];
  const pixel = (x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
  function equal(label, actual, expected, tolerance = 1) {
    if (actual.some((v, i) => Math.abs(v - expected[i]) > tolerance)) {
      throw new Error(label + ': ' + JSON.stringify({ actual, expected, tolerance }));
    }
    evidence.push({ label, actual, expected });
  }
  function draw(steps, time = 2, frame = source()) { compositor.render(frame, graph(steps), time, frame.width, frame.height); }
  try {
    const red = [208, 32, 32, 255], green = [32, 192, 64, 255], blue = [32, 112, 208, 255];
    for (const time of [0.5, 1, 2.999, 3, 3.5]) {
      draw([transform({ flipHorizontal: true })], time);
      equal('horizontal [1,3) at ' + time, pixel(8, 8), time >= 1 && time < 3 ? green : red);
    }
    draw([transform({ flipVertical: true })]); equal('vertical orientation', pixel(8, 8), blue);
    draw([transform({ flipHorizontal: true, flipVertical: true })]);
    equal('both flips orientation', pixel(8, 8), [224, 176, 32, 255]);
    draw([transform({ scale: 1.25 })]); equal('center enlargement detail', pixel(12, 12), [255, 255, 255, 255]);
    draw([transform({ flipHorizontal: true, scale: 1.25 })]);
    equal('flip then center enlargement detail', pixel(84, 12), [255, 255, 255, 255]);
    draw([transform({ scale: 0.5 })]);
    equal('opaque black shrink margin', pixel(10, 10), [0, 0, 0, 255]);
    equal('shrink retains centered source', pixel(30, 20), red);
    draw([transform({ scale: 2 }), transform({ scale: 0.5 })]);
    equal('each transform commits lost cropped edges', pixel(10, 10), [0, 0, 0, 255]);
    equal('sequential transforms keep center', pixel(32, 24), red);
    draw([transform({ scale: 0.5 }), color({ brightness: 0.8 })]);
    const litMargin = pixel(10, 10);
    if (litMargin[0] < 40 || litMargin[3] !== 255) throw new Error('color after transform must lighten black: ' + litMargin);
    evidence.push({ label: 'color after shrink processes black margins', actual: litMargin });
    draw([color({ brightness: 0.8 }), transform({ scale: 0.5 })]);
    equal('color before shrink leaves new margins black', pixel(10, 10), [0, 0, 0, 255]);
    draw([transform({ scale: 1 }), color({ temperature: 0.6, brightness: 0.1, contrast: 0.8, saturation: 0.7 })]);
    const combined = pixel(8, 48);
    // Isolate the pipeline from filter construction with a direct application
    // of the existing four SVG primitives in Chromium, not JS matrix math.
    const filter = document.createElementNS(svgNS, 'filter'); filter.setAttribute('id', 'pixel-reference-color');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    window.SRTColorPreview.appendPrimitives(filter, { temperature: 0.6, brightness: 0.1, contrast: 0.8, saturation: 0.7 });
    defs.appendChild(filter);
    const reference = document.createElement('canvas'); reference.width = 96; reference.height = 64;
    const referenceCtx = reference.getContext('2d'); referenceCtx.filter = 'url(#pixel-reference-color)';
    referenceCtx.drawImage(source(), 0, 0);
    equal('mixed pipeline uses verified color primitives', combined, Array.from(referenceCtx.getImageData(8, 48, 1, 1).data));
    if (combined.slice(0, 3).every((value, i) => value === blue[i])) throw new Error('Canvas URL filter did not change blue patch');
    draw([transform({ scale: 0.5, flipHorizontal: true })], 2, source(64, 96));
    equal('portrait intrinsic black margin', pixel(8, 48), [0, 0, 0, 255]);
    equal('portrait intrinsic horizontal orientation', pixel(20, 30), green);
    if (canvas.width !== 64 || canvas.height !== 96) throw new Error('portrait intrinsic dimensions changed');
    const editorCanvas = document.getElementById('previewSourceCanvas');
    if (getComputedStyle(editorCanvas).objectFit !== 'contain' || getComputedStyle(editorCanvas).pointerEvents !== 'none') {
      throw new Error('editor canvas must contain intrinsic portrait frame and pass through playback clicks');
    }
    return evidence;
  } finally { canvas.remove(); svg.remove(); }
}
if (typeof module === 'object') module.exports = { runTransformPreviewCases };
