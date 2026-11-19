// Login with a 6-digit e-mail code (OTP). The session persists in localStorage;
// once signed in, the user id is kept in IndexedDB so the app opens offline.
import { sb } from './supa.js';
import * as db from './db.js';

function friendly(e) {
  const m = String(e?.message || '').toLowerCase();
  if (!navigator.onLine) return new Error('Sem conexão. O primeiro login precisa de internet.');
  if (m.includes('database error') || m.includes('signup') || m.includes('not allowed')) return new Error('Este e-mail não está autorizado a entrar.');
  if (e?.status === 429 || m.includes('rate') || m.includes('security purposes')) return new Error('Muitas tentativas. Espere alguns minutos e tente de novo.');
  if (m.includes('expired') || m.includes('invalid') || m.includes('token')) return new Error('Código inválido ou expirado. Peça um novo código.');
  return new Error(e?.message || 'Erro inesperado. Tente de novo.');
}

export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw friendly(error);
}

export async function verifyCode(email, token) {
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw friendly(error);
  const uid = data.user.id;
  const previous = await db.getMeta('userId');
  if (previous && previous !== uid) await db.clearAll();
  await db.setMeta('userId', uid);
  await db.setMeta('email', email);
  return uid;
}

export function currentUserId() {
  return db.getMeta('userId', null);
}

export async function signOut() {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (_) { /* offline: local session is cleared anyway */ }
  await db.clearAll();
}
