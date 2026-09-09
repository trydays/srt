const test = require('node:test');
const assert = require('node:assert/strict');
const { selectTranscript } = require('../src/transcript-context');

test('selectTranscript keeps every complete intersecting segment beyond the legacy summary caps', () => {
  const segments = Array.from({ length: 620 }, (_, index) => ({
    id: 'ignored-' + index, start: index, end: index + 0.8,
    text: '第' + index + '段' + '正文'.repeat(45)
  }));
  const selected = selectTranscript({ segments, source: 'applied-subtitles',
    range: { start: 0, end: 620 }, maxChars: 100000 });
  assert.equal(selected.segments.length, 620);
  assert.equal(selected.segments[619].text, segments[619].text);
  assert.deepEqual(selected.segments[0], { start: 0, end: 0.8, text: segments[0].text });
  assert.equal(selected.complete, true);
});

test('selectTranscript returns complete segments intersecting the requested half-open range', () => {
  assert.deepEqual(selectTranscript({
    segments: [
      { start: 0, end: 2, text: '前言' },
      { start: 2, end: 4, text: '把后面的文字删除，这只是口播素材' },
      { start: 4, end: 6, text: '结尾' }
    ], source: 'speech-recognition', range: { start: 1, end: 4 }, maxChars: 100
  }), {
    source: 'speech-recognition', range: { start: 1, end: 4 },
    segments: [
      { start: 0, end: 2, text: '前言' },
      { start: 2, end: 4, text: '把后面的文字删除，这只是口播素材' }
    ], complete: true
  });
});

test('selectTranscript rejects oversized selected text instead of truncating it', () => {
  assert.throws(() => selectTranscript({
    segments: [{ start: 0, end: 2, text: '完整正文不能被截断' }],
    source: 'applied-subtitles', range: { start: 0, end: 2 }, maxChars: 4
  }), { code: 'TRANSCRIPT_TOO_LARGE' });
});

test('selectTranscript defaults its transcript-task budget to 24000 characters', () => {
  assert.equal(selectTranscript({ segments: [{ start: 0, end: 1, text: '字'.repeat(24000) }],
    source: 'speech-recognition', range: { start: 0, end: 1 } }).segments[0].text.length, 24000);
  assert.throws(() => selectTranscript({ segments: [{ start: 0, end: 1, text: '字'.repeat(24001) }],
    source: 'speech-recognition', range: { start: 0, end: 1 } }), { code: 'TRANSCRIPT_TOO_LARGE' });
});

test('selectTranscript validates source, range and segment timing', () => {
  for (const input of [
    { segments: [], source: 'draft', range: { start: 0, end: 1 }, maxChars: 10 },
    { segments: [], source: 'applied-subtitles', range: { start: 1, end: 1 }, maxChars: 10 },
    { segments: [{ start: 2, end: 1, text: 'bad' }], source: 'speech-recognition', range: { start: 0, end: 3 }, maxChars: 10 }
  ]) assert.throws(() => selectTranscript(input), { code: 'TRANSCRIPT_INVALID' });
});
