// Pure text helpers for voice typing (no React, so they can be unit-tested with `npm test`).

export const DICT_LANGS = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
  { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
  { code: 'te-IN', label: 'తెలుగు (Telugu)' },
  { code: 'ml-IN', label: 'മലയാളം (Malayalam)' },
  { code: 'en-US', label: 'English (US)' },
];

// Spoken punctuation, English only. "period" is left out on purpose: people say it as a normal word.
const COMMANDS = [
  [/\s*\bquestion mark\b\s*/gi, '? '],
  [/\s*\bexclamation (?:mark|point)\b\s*/gi, '! '],
  [/\s*\bfull stop\b\s*/gi, '. '],
  [/\s*\bcomma\b\s*/gi, ', '],
  [/\s*\bnew line\b\s*/gi, '\n'],
];

export function applyVoiceCommands(text, lang = 'en-IN') {
  let s = String(text || '');
  if (!/^en/i.test(lang)) return s;
  for (const [re, rep] of COMMANDS) s = s.replace(re, rep);
  return s;
}

/** Combine what was already typed (base) with what was just spoken. */
export function joinSpeech(base, spoken, { lang = 'en-IN', maxLength = 1000 } = {}) {
  const b = String(base || '');
  let s = applyVoiceCommands(spoken, lang).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  if (!s) return b.slice(0, maxLength);
  s = s.replace(/([.!?]\s+|\n)([a-z])/g, (_m, a, c) => a + c.toUpperCase());      // capital after a sentence end
  const startsSentence = !b.trim() || /[.!?]\s*$/.test(b) || /\n\s*$/.test(b);
  if (startsSentence) s = s.charAt(0).toUpperCase() + s.slice(1);
  const needSpace = b && !/\s$/.test(b) && !/^[.,?!\n]/.test(s);
  return (b + (needSpace ? ' ' : '') + s).slice(0, maxLength);
}

export function dictationError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed': return 'The microphone is blocked. Allow it in your browser settings, then try again.';
    case 'no-speech': return "I didn't hear anything. Tap the mic and try again.";
    case 'audio-capture': return 'No microphone was found on this device.';
    case 'network': return 'Voice typing needs an internet connection.';
    case 'language-not-supported': return "This browser can't do voice typing in that language. Pick another one.";
    case 'aborted': return '';
    default: return 'Voice typing stopped. Please try again.';
  }
}
