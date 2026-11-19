// Offline-first sync with Supabase.
// 1) push pending reviews and changed progress; 2) pull card, progress and review deltas.
// Progress conflicts: the row with the newest device updated_at wins (enforced server-side too).
// Deltas use server-set timestamps, so work done offline on another device is never skipped.
import * as db from './db.js';
import { sb } from './supa.js';
import { parseTs } from './util.js';

const EPOCH = '1970-01-01T00:00:00Z';
const PAGE = 1000;
const statusListeners = new Set();
const dataListeners = new Set();
let status = { state: navigator.onLine ? 'idle' : 'offline', pending: 0, lastSync: null, error: null };
let running = null;
let timer = null;

export const getStatus = () => status;
export function onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); }
export function onData(fn) { dataListeners.add(fn); return () => dataListeners.delete(fn); }
function emit(patch) { status = { ...status, ...patch }; statusListeners.forEach((f) => f(status)); }

export async function refreshPending() {
  const pending = await db.countIndex('reviews', 'synced', 0);
  const lastSync = await db.getMeta('lastSync', null);
  let state = status.state;
  if (!navigator.onLine) state = 'offline';
  else if (state === 'offline') state = 'idle';
  emit({ pending, lastSync, state });
  return pending;
}

export function scheduleSync(ms = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, ms);
}

export function syncNow() {
  if (running) return running;
  if (!navigator.onLine) return refreshPending();
  running = (async () => {
    emit({ state: 'syncing', error: null });
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) throw Object.assign(new Error('Sessão expirada. Entre novamente para sincronizar.'), { code: 'NO_SESSION' });
      await pushReviews();
      await pushProgress();
      const a = await pullCards();
      const b = await pullProgress();
      const c = await pullReviews();
      const now = new Date().toISOString();
      await db.setMeta('lastSync', now);
      const pending = await db.countIndex('reviews', 'synced', 0);
      emit({ state: 'ok', pending, lastSync: now });
      if (a || b || c) dataListeners.forEach((f) => f());
    } catch (e) {
      console.error('sync failed', e);
      const pending = await db.countIndex('reviews', 'synced', 0);
      emit({ state: navigator.onLine ? 'error' : 'offline', error: e.message || String(e), code: e.code || null, pending });
    } finally {
      running = null;
    }
  })();
  return running;
}

async function pushReviews() {
  const rows = await db.getAllIndex('reviews', 'synced', 0);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const payload = chunk.map((r) => ({
      id: r.id, card_id: r.card_id, grade: r.grade, typed_answer: r.typed_answer || null,
      time_ms: r.time_ms ?? null, device: r.device || null, reviewed_at: r.reviewed_at
    }));
    const { error } = await sb.from('reviews').upsert(payload, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    await db.putMany('reviews', chunk.map((r) => ({ ...r, synced: 1 })));
  }
}

async function pushProgress() {
  const dirty = (await db.getAll('progress')).filter((p) => p.dirty === 1);
  for (let i = 0; i < dirty.length; i += 200) {
    const chunk = dirty.slice(i, i + 200);
    const rows = chunk.map((p) => ({
      card_id: p.card_id, ease: p.ease, interval_days: p.interval_days, due_at: p.due_at,
      reps: p.reps, lapses: p.lapses, last_grade: p.last_grade, updated_at: p.updated_at
    }));
    const { error } = await sb.rpc('sync_progress', { rows });
    if (error) throw error;
    // Only clear the flag if the card wasn't studied again while we were uploading.
    const fresh = await Promise.all(chunk.map((p) => db.get('progress', p.card_id)));
    await db.putMany('progress', fresh.filter((f, k) => f && f.updated_at === chunk[k].updated_at).map((f) => ({ ...f, dirty: 0 })));
  }
}

async function pullSince(table, col, since, tiebreak) {
  let out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').gt(col, since)
      .order(col, { ascending: true }).order(tiebreak, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < PAGE) break;
  }
  return out;
}

function maxTs(rows, col, current) {
  let best = current;
  for (const r of rows) if (parseTs(r[col]) > parseTs(best)) best = r[col];
  return best;
}

async function pullCards() {
  const since = await db.getMeta('cardsSince', EPOCH);
  const rows = await pullSince('cards', 'updated_at', since, 'id');
  if (!rows.length) return false;
  await db.putMany('cards', rows);
  await db.setMeta('cardsSince', maxTs(rows, 'updated_at', since));
  return true;
}

async function pullProgress() {
  const since = await db.getMeta('progressSince', EPOCH);
  const rows = await pullSince('progress', 'server_updated_at', since, 'card_id');
  if (!rows.length) return false;
  const winners = [];
  for (const r of rows) {
    const local = await db.get('progress', r.card_id);
    if (!local || !local.updated_at || parseTs(r.updated_at) > parseTs(local.updated_at)) {
      winners.push({ ...r, dirty: 0 });
    }
  }
  await db.putMany('progress', winners);
  await db.setMeta('progressSince', maxTs(rows, 'server_updated_at', since));
  return winners.length > 0;
}

async function pullReviews() {
  const since = await db.getMeta('reviewsSince', EPOCH);
  const rows = await pullSince('reviews', 'synced_at', since, 'id');
  if (!rows.length) return false;
  await db.putMany('reviews', rows.map((r) => ({ ...r, synced: 1 })));
  await db.setMeta('reviewsSince', maxTs(rows, 'synced_at', since));
  return true;
}
