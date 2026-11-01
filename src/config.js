const MY_SUPABASE_URL = 'https://qbcuivkpyukrexnuynsk.supabase.co';

const MY_SUPABASE_ANON_KEY = 'sb_publishable_YY7WLygeNMtNQLJPobmS9A_BTgO_V2p';

const clean = (v) => String(v || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const isPlaceholder = (v) => !v || /your[-_]|placeholder|paste_/i.test(v);

const fromCode = !isPlaceholder(MY_SUPABASE_URL) && !isPlaceholder(MY_SUPABASE_ANON_KEY);
export const SUPABASE_URL = clean(fromCode ? MY_SUPABASE_URL : import.meta.env.VITE_SUPABASE_URL);
export const SUPABASE_ANON_KEY = String(fromCode ? MY_SUPABASE_ANON_KEY : import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isConfigured = /^https?:\/\//.test(SUPABASE_URL) && !isPlaceholder(SUPABASE_URL) && !isPlaceholder(SUPABASE_ANON_KEY);
console.info('[WhisperHub] configured:', isConfigured, '| host:', SUPABASE_URL.replace(/^https?:\/\//, ''));