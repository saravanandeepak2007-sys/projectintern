export const MOODS = [
  { id: 'happy', emoji: '😊', label: 'Happy', color: '#F2B100' },
  { id: 'sad', emoji: '💙', label: 'Sad', color: '#4C7DFF' },
  { id: 'motivation', emoji: '💪', label: 'Motivation', color: '#FF7A2F' },
  { id: 'appreciation', emoji: '❤️', label: 'Appreciation', color: '#EC4E8C' },
];
export const moodOf = (id) => MOODS.find((m) => m.id === id);

export const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'feedback', label: 'Honest feedback' },
  { id: 'praise', label: 'Praise' },
  { id: 'question', label: 'Question' },
];
export const catLabel = (id) => (id === 'capsule' ? 'Time capsule' : CATEGORIES.find((c) => c.id === id)?.label || id);

export const TOPICS = ['General Discussion', 'College Events', 'Hackathons', 'Academics', 'Suggestions'];

/* ---------- device tokens (random, local only) ----------
   One separate random code per purpose, so a browser can never be linked between an inbox, a room and a poll.
   The server hashes them again before storing. */
export const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
export const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* */ } };
export const uid = () => {   // always a valid UUID v4, even on plain http where crypto.randomUUID is missing
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const mem = {};
export function deviceToken(scope = 'inbox') {
  if (mem[scope]) return mem[scope];
  const key = `wh_dev_${scope}`;
  let t = lsGet(key);
  if (!t) { t = uid(); lsSet(key, t); }
  mem[scope] = t;   // also remembered in memory, so it stays stable when storage is blocked
  return t;
}

/* ---------- anonymous display names ---------- */
const ADJ = ['Blue', 'Silent', 'Golden', 'Misty', 'Brave', 'Cosmic', 'Gentle', 'Swift', 'Neon', 'Quiet', 'Amber', 'Lucky'];
const ANI = ['Falcon', 'Panda', 'Otter', 'Tiger', 'Fox', 'Heron', 'Lynx', 'Koala', 'Owl', 'Dolphin', 'Mynah', 'Peacock'];
export const randomAnonName = () => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${ANI[Math.floor(Math.random() * ANI.length)]}`;
export function roomAnonName(code, reroll = false) {
  const key = `wh_name_${code}`;
  let n = reroll ? null : lsGet(key);
  if (!n) { n = randomAnonName(); lsSet(key, n); }
  return n;
}

/* ---------- text helpers ---------- */
const BAD = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'slut', 'cunt', 'whore'];
const badRe = new RegExp(`\\b(${BAD.join('|')})(s|es|ed|er|ers|ing|in|y|head|heads)?\\b`, 'gi');
export const maskProfanity = (t) => t.replace(badRe, (w) => w[0] + '*'.repeat(w.length - 1));

/* Keyword scoring (not machine learning): whole words, simple negation, and "strong" vs "soft" advice words. */
const POS = ['good', 'great', 'amazing', 'awesome', 'love', 'loved', 'best', 'nice', 'thank', 'thanks', 'proud', 'inspiring', 'inspired', 'brilliant', 'excellent', 'helpful', 'kind', 'wonderful', 'impressive', 'well done', 'fantastic', 'happy', 'clear', 'clearest'];
const STRONG = ['improve', 'should', 'need to', 'needs to', 'must', 'try to', 'try ', 'work on', 'avoid', 'lacking', 'mistake', 'mistakes', 'wrong', 'too much', 'too little', 'too fast', 'too slow', 'stop', 'bad', 'boring', 'confusing', 'rude', 'unclear'];
const SOFT = ['could', 'would be better', 'better if', 'however', 'but', 'slow down', 'maybe'];
const NEG = ['not', "isn't", "wasn't", "don't", "didn't", 'never', 'no'];
const has = (t, w) => new RegExp(`(^|[^a-z])${w.trim().replace(/ /g, '\\s+')}([^a-z]|$)`).test(t);
export function classifySentiment(text) {
  const t = String(text || '').toLowerCase().replace(/[’]/g, "'");
  if (!t.trim()) return 'neutral';
  const negatedPos = POS.some((w) => NEG.some((n) => has(t, `${n.replace("'", "'")} (?:very |really |so |that )?${w}`)));
  const pos = POS.some((w) => has(t, w)) && !negatedPos;
  const strong = negatedPos || STRONG.some((w) => has(t, w));
  const soft = SOFT.some((w) => has(t, w));
  if (strong) return 'constructive';
  if (pos && soft) return 'constructive';   // "great talk, but could be shorter" is advice
  if (pos) return 'positive';
  if (soft) return 'constructive';
  return 'neutral';
}

export function slugify(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'user';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
export const roomCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

/* ---------- client cooldown (server also enforces its own limits) ---------- */
export function cooldownLeft(key, ms) {
  const last = Number(lsGet(`wh_cd_${key}`) || 0);
  return Math.max(0, last + ms - Date.now());
}
export const markSent = (key) => lsSet(`wh_cd_${key}`, String(Date.now()));

/* ---------- dates ---------- */
export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export function countdown(iso) {
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export const errText = (e) => e?.message || 'Something went wrong. Please try again.';
export const shareUrl = (slug) => `${location.origin}${location.pathname}#/u/${slug}`;
