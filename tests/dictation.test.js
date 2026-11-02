import test from 'node:test';
import assert from 'node:assert/strict';
import { joinSpeech, applyVoiceCommands, dictationError, DICT_LANGS } from '../src/lib/dictation.js';

test('dictation: starts a new message with a capital letter', () => {
  assert.equal(joinSpeech('', 'hello everyone'), 'Hello everyone');
});
test('dictation: continues typed text with one space and no forced capital', () => {
  assert.equal(joinSpeech('Meet me at', 'the library'), 'Meet me at the library');
  assert.equal(joinSpeech('Meet me at ', 'the library'), 'Meet me at the library');
});
test('dictation: capital after a finished sentence', () => {
  assert.equal(joinSpeech('See you soon.', 'bring your laptop'), 'See you soon. Bring your laptop');
});
test('dictation: spoken punctuation works in English', () => {
  assert.equal(joinSpeech('', 'hi comma how are you question mark'), 'Hi, how are you?');
  assert.equal(joinSpeech('', 'great job full stop thank you exclamation mark'), 'Great job. Thank you!');
  assert.equal(joinSpeech('', 'first line new line second line'), 'First line\nSecond line');
});
test('dictation: the word "period" is NOT turned into punctuation', () => {
  assert.equal(joinSpeech('', 'the exam period is long'), 'The exam period is long');
});
test('dictation: punctuation commands are not applied to other languages', () => {
  assert.equal(applyVoiceCommands('comma', 'ta-IN'), 'comma');
  assert.equal(joinSpeech('', 'வணக்கம் நண்பா', { lang: 'ta-IN' }), 'வணக்கம் நண்பா');
});
test('dictation: respects maxLength and keeps the base when nothing was spoken', () => {
  assert.equal(joinSpeech('abc', 'defghij', { maxLength: 6 }), 'abc de');
  assert.equal(joinSpeech('keep me', '   '), 'keep me');
});
test('dictation: friendly error messages', () => {
  assert.match(dictationError('not-allowed'), /blocked/i);
  assert.match(dictationError('no-speech'), /didn't hear/i);
  assert.equal(dictationError('aborted'), '');
  assert.ok(DICT_LANGS.some((l) => l.code === 'ta-IN'));
});
