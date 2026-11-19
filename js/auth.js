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

/** The app's own address (no hash/query), used as the e-mail link's return URL. */
export function appUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: appUrl() } });
  if (error) throw friendly(error);
}

/** Stores the signed-in user locally; wipes local data if a different account signs in. */
async function adoptUser(user, fallbackEmail) {
  const previous = await db.getMeta('userId');
  if (previous && previous !== user.id) await db.clearAll();
  await db.setMeta('userId', user.id);
  await db.setMeta('email', user.email || fallbackEmail || '');
  return user.id;
}

/**
 * Handles the return from a tapped e-mail link: the session arrives in the URL
 * (picked up by supabase-js) or an error arrives in the hash.
 * Returns { userId } when a session was adopted, { error } on a link error, or null.
 */
export async function handleRedirect() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const hadAuthParams = hash.has('access_token') || hash.has('error') || query.has('error') || query.has('code');
  if (!hadAuthParams) return null;
  const errDesc = hash.get('error_description') || query.get('error_description');
  const { data } = await sb.auth.getSession();
  history.replaceState(null, '', appUrl());
  if (data.session) return { userId: await adoptUser(data.session.user) };
  if (errDesc) {
    const expired = /expired|invalid/i.test(errDesc);
    return { error: expired ? 'Esse link já foi usado ou expirou. Peça um novo e-mail.' : errDesc.replace(/\+/g, ' ') };
  }
  return null;
}

const LINK_TYPES = ['magiclink', 'signup', 'email', 'invite'];

/**
 * Accepts either the 6-digit code or the full sign-in link copied from the e-mail.
 * Pasting the link keeps the login inside the installed app (on iPhone, tapping the
 * link would open Safari instead of the PWA).
 */
export function parseLoginInput(input) {
  const raw = String(input || '').trim();
  if (/^https?:\/\//i.test(raw) || raw.includes('token=')) {
    let url;
    try { url = new URL(raw); } catch (_) { throw new Error('Link inválido. Copie o link inteiro do e-mail.'); }
    const tokenHash = url.searchParams.get('token') || url.searchParams.get('token_hash');
    const type = url.searchParams.get('type') || 'magiclink';
    if (!tokenHash || !LINK_TYPES.includes(type)) throw new Error('Esse link não parece ser o de login. Copie o link do botão do e-mail.');
    return { tokenHash, type };
  }
  const code = raw.replace(/\D/g, '');
  if (code.length < 6) throw new Error('Digite o código de 6 dígitos ou cole o link do e-mail.');
  return { code };
}

export async function verifyCode(email, input) {
  const parsed = parseLoginInput(input);
  const { data, error } = parsed.tokenHash
    ? await sb.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type })
    : await sb.auth.verifyOtp({ email, token: parsed.code, type: 'email' });
  if (error) throw friendly(error);
  if (!data?.user) throw new Error('Não foi possível entrar. Peça um novo e-mail.');
  return adoptUser(data.user, email);
}

export function currentUserId() {
  return db.getMeta('userId', null);
}

export async function signOut() {
  try { await sb.auth.signOut({ scope: 'local' }); } catch (_) { /* offline: local session is cleared anyway */ }
  await db.clearAll();
}
