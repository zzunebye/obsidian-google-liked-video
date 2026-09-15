import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const bundle = await build({
	entryPoints: ['src/utils/transcriptUtils.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	write: false,
});
const { groupTranscriptSegments: group, getTranscriptRows: rows, formatTranscriptTimestamp: timestamp } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const cue = (start, duration, text) => ({ start, duration, text });
const starts = segments => group(segments).map(paragraph => paragraph.start);

assert.deepEqual(group([]), []);
assert.deepEqual(group([cue(0, 1, ' \n ')]), []);
assert.equal(timestamp(3661.9), '1:01:01');

const originalCues = [cue(0.25, 2, ' First\nline '), cue(0.25, 1, 'Repeated timestamp'), cue(2.25, 3, 'Next caption')];
assert.deepEqual(rows(originalCues, 'original'), [
	{ start: 0.25, end: 2.25, text: ' First\nline ' },
	{ start: 0.25, end: 1.25, text: 'Repeated timestamp' },
	{ start: 2.25, end: 5.25, text: 'Next caption' },
], 'Original mode preserves every source cue, whitespace and fractional timestamp');
assert.deepEqual(rows(originalCues, 'paragraphs'), group(originalCues), 'Paragraph mode retains the current grouping rules');
assert.deepEqual(rows([], 'original'), []);

assert.deepEqual(starts([
	cue(0, 6, 'First sentence'), cue(6, 6, 'ends here.'), cue(12, 3, 'Next sentence.'),
]), [0, 12], 'A sentence boundary can split before the time target');
assert.deepEqual(starts([
	cue(0, 3, 'One.'), cue(3, 3, 'Two.'), cue(6, 3, 'Three.'),
]), [0], 'Short sentences do not each become a paragraph');
assert.deepEqual(starts([
	cue(0, 10, 'A sentence'), cue(10, 10, 'continues'), cue(20, 10, 'with more words'),
	cue(30, 3, 'and ends here.'), cue(33, 2, 'The next thought'),
]), [0, 33], 'Cross 30 seconds to finish the sentence instead of cutting it');
assert.deepEqual(starts([
	cue(0, 1, 'Before the pause'), cue(3, 1, 'After the pause'),
]), [0, 3], 'A two-second caption gap takes priority even in a short paragraph');
assert.deepEqual(starts([
	cue(0, 10, 'Opening'), cue(11, 18.9, 'still the same thought'), cue(30.7, 1, 'After a smaller pause'),
]), [0, 30.7], 'A smaller pause qualifies only once the soft target is reached');
assert.deepEqual(starts([
	cue(0, 1, 'a'.repeat(200)), cue(1, 1, 'b'.repeat(200)), cue(2, 1, 'c'.repeat(120)),
	cue(3, 1, 'The sentence finishes.'), cue(4, 1, 'Next'),
]), [0, 4], 'Cross 500 characters to finish a sentence');
assert.deepEqual(starts([
	cue(0, 1, `${'가'.repeat(160)}。”`), cue(1, 1, '다음 문장'),
]), [0, 1], 'Long sentences and closing quotation marks work without a 12-second wait');
assert.deepEqual(starts([
	cue(0, 20, 'Long overlapping cue'), cue(1, 1, 'Short overlapping cue'), cue(5, 1, 'Still overlapping'),
]), [0], 'Overlapping captions must not invent a pause');
assert.deepEqual(starts([
	cue(0, 10, 'a'), cue(10, 10, 'b'), cue(20, 10, 'c'),
	cue(30, 10, 'd'), cue(40, 5, 'e'), cue(45, 14, 'f'), cue(59, 1, 'g'), cue(60, 5, 'h'),
]), [0, 60], 'Continuous captions cross 45 seconds and split at the 60-second fallback');
assert.deepEqual(starts([
	cue(0, 1, 'a'.repeat(400)), cue(1, 1, 'b'.repeat(350)), cue(2, 1, 'c'.repeat(48)), cue(3, 1, 'd'),
]), [0, 3], 'Allow exactly 800 characters, including spaces, then split before exceeding the cap');
const oversized = cue(0, 90, 'x'.repeat(1000));
assert.deepEqual(group([oversized]), [{ start: 0, end: 90, text: oversized.text }], 'Never split an original cue or invent timestamps');
assert.deepEqual(group([cue(0, 2, '  Hello\nworld '), cue(2, 1, '\t'), cue(2, 2, ' again  ')]), [
	{ start: 0, end: 4, text: 'Hello world again' },
], 'Whitespace normalization retains words and source timing');

const many = Array.from({ length: 20000 }, (_, index) => cue(index * 0.7, 0.6,
	`word${index}${index % 19 === 0 ? '.' : ''}`));
const original = JSON.stringify(many);
const paragraphs = group(many);
assert.equal(paragraphs.map(paragraph => paragraph.text).join(' '), many.map(segment => segment.text).join(' '));
assert.equal(JSON.stringify(many), original, 'Input captions remain unmodified');
const cueStarts = new Set(many.map(segment => segment.start));
const cueEnds = new Set(many.map(segment => segment.start + segment.duration));
assert.ok(paragraphs.every(paragraph => cueStarts.has(paragraph.start) && cueEnds.has(paragraph.end)));
assert.ok(paragraphs.every((paragraph, index) => index === 0 || paragraph.start > paragraphs[index - 1].start));
console.log('Transcript grouping: sentence/pause priority, soft targets, bounded fallback, Unicode, overlap, lossless text/timing and 20,000-cue input passed.');
