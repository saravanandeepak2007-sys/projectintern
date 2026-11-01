// Run with: npm test   (Node 18+, no extra packages)
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySentiment, maskProfanity, slugify, roomCode, deviceToken, countdown, uid } from '../src/lib/util.js';

test('sentiment: praise is positive', () => {
  assert.equal(classifySentiment('Your talk on Friday was the clearest I have heard all year.'), 'positive');
  assert.equal(classifySentiment('Great work, thank you!'), 'positive');
});
test('sentiment: advice is constructive', () => {
  assert.equal(classifySentiment('You should slow down in the demo.'), 'constructive');
  assert.equal(classifySentiment('Could you slow down in the demo part? I got lost there.'), 'constructive');
  assert.equal(classifySentiment('Great talk, but it could be shorter.'), 'constructive');
});
test('sentiment: negation and whole words', () => {
  assert.equal(classifySentiment("The slides were not good"), 'constructive');
  assert.equal(classifySentiment('goodbye everyone'), 'neutral');
  assert.equal(classifySentiment(''), 'neutral');
  assert.equal(classifySentiment('See you at 5'), 'neutral');
});
test('profanity filter masks words, not innocent look-alikes', () => {
  assert.equal(maskProfanity('what the fuck'), 'what the f***');
  assert.equal(maskProfanity('you are a bitch.'), 'you are a b****.');
  assert.equal(maskProfanity('Mr Dickens wrote novels'), 'Mr Dickens wrote novels');
  assert.equal(maskProfanity('shitake mushrooms'), 'shitake mushrooms');
});
test('slugs and room codes are valid for the database rules', () => {
  for (let i = 0; i < 200; i++) {
    assert.match(slugify('Deepak Kumar!!'), /^[a-z0-9-]{3,40}$/);
    assert.match(roomCode(), /^[A-Z0-9]{6}$/);
  }
  assert.match(slugify('???'), /^user-[a-z0-9]{4}$/);
});
test('device codes are separate per purpose and long enough', () => {
  const a = deviceToken('inbox'), b = deviceToken('room'), c = deviceToken('vote');
  assert.ok(a.length >= 8 && b.length >= 8 && c.length >= 8);
  assert.notEqual(a, b); assert.notEqual(b, c);
  assert.equal(deviceToken('inbox'), a);          // stable within a session
  assert.notEqual(uid(), uid());
});
test('countdown formats', () => {
  assert.match(countdown(new Date(Date.now() + 3 * 864e5 + 5 * 36e5).toISOString()), /^3d \d+h$/);
  assert.equal(countdown(new Date(Date.now() - 1000).toISOString()), '0m');
});

test('uid() is always a valid UUID, even without crypto.randomUUID', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(uid(), re);
  const saved = crypto.randomUUID;
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try { for (let i = 0; i < 50; i++) assert.match(uid(), re); } finally { Object.defineProperty(crypto, 'randomUUID', { value: saved, configurable: true }); }
});
