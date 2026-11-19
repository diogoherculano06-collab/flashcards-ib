// Minimal promise wrapper around IndexedDB.
// Stores: cards (by id), progress (by card_id, with dirty flag),
//         reviews (by id, with synced flag 0/1), meta (key/value).
const DB_NAME = 'ibfc';
const DB_VERSION = 1;
const STORES = ['cards', 'progress', 'reviews', 'meta'];
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress', { keyPath: 'card_id' });
        if (!d.objectStoreNames.contains('reviews')) {
          const s = d.createObjectStore('reviews', { keyPath: 'id' });
          s.createIndex('synced', 'synced');
        }
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

const done = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});

export async function getAll(store) {
  const d = await open();
  return req(d.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const d = await open();
  return req(d.transaction(store).objectStore(store).get(key));
}

export async function getAllIndex(store, index, value) {
  const d = await open();
  return req(d.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function countIndex(store, index, value) {
  const d = await open();
  return req(d.transaction(store).objectStore(store).index(index).count(value));
}

export async function putMany(store, items) {
  if (!items.length) return;
  const d = await open();
  const t = d.transaction(store, 'readwrite');
  const s = t.objectStore(store);
  for (const it of items) s.put(it);
  return done(t);
}

export const put = (store, item) => putMany(store, [item]);

export async function clearAll() {
  const d = await open();
  const t = d.transaction(STORES, 'readwrite');
  for (const s of STORES) t.objectStore(s).clear();
  return done(t);
}

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}
