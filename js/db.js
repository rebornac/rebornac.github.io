const DB_NAME = 'ForjaFitDB';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const FALLBACK_KEY = 'forjafit_state_fallback_v1';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

export async function dbGet(key) {
  const db = await openDB();
  if (!db) {
    try {
      const raw = localStorage.getItem(`${FALLBACK_KEY}_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function dbSet(key, value) {
  const db = await openDB();
  if (!db) {
    try {
      localStorage.setItem(`${FALLBACK_KEY}_${key}`, JSON.stringify(value));
    } catch (err) {
      console.warn('LocalStorage fallback failed:', err);
    }
    return;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    tx.objectStore(STORE_KV).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function exportAllData() {
  const state = await dbGet('appState');
  const payload = {
    app: 'ForjaFit',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };
  return JSON.stringify(payload, null, 2);
}

export async function importAllData(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || parsed.app !== 'ForjaFit' || !parsed.data) {
    throw new Error('Arquivo de backup inválido para o ForjaFit.');
  }
  await dbSet('appState', parsed.data);
  return parsed.data;
}
