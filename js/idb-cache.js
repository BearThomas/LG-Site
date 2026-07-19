export const DB_NAME = 'LGCacheDB';
export const DB_VERSION = 1;

let dbPromise = null;

function initDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('users')) {
                    db.createObjectStore('users', { keyPath: '$id' });
                }
                if (!db.objectStoreNames.contains('posts')) {
                    const store = db.createObjectStore('posts', { keyPath: '$id' });
                    store.createIndex('created_at', '$createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('confessions')) {
                    const store = db.createObjectStore('confessions', { keyPath: '$id' });
                    store.createIndex('created_at', '$createdAt', { unique: false });
                }
            };
        });
    }
    return dbPromise;
}

export async function getFromCache(storeName, id) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn(`IDB GET Error [${storeName}]:`, e);
        return null;
    }
}

export async function getMultipleFromCache(storeName, ids) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const results = {};
            let count = 0;
            
            if (ids.length === 0) return resolve(results);
            
            ids.forEach(id => {
                const req = store.get(id);
                req.onsuccess = () => {
                    if (req.result) results[id] = req.result;
                    count++;
                    if (count === ids.length) resolve(results);
                };
                req.onerror = () => {
                    count++;
                    if (count === ids.length) resolve(results);
                };
            });
        });
    } catch (e) {
        console.warn(`IDB GET Multiple Error [${storeName}]:`, e);
        return {};
    }
}

export async function putToCache(storeName, items) {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            
            const arr = Array.isArray(items) ? items : [items];
            arr.forEach(item => store.put(item));
            
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn(`IDB PUT Error [${storeName}]:`, e);
    }
}

export async function getAllFromCache(storeName, limit = 50, sortDirection = 'desc') {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            
            let request;
            if (store.indexNames.contains('created_at')) {
                const index = store.index('created_at');
                const direction = sortDirection === 'desc' ? 'prev' : 'next';
                request = index.openCursor(null, direction);
            } else {
                request = store.openCursor();
            }
            
            const results = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.warn(`IDB GET ALL Error [${storeName}]:`, e);
        return [];
    }
}

export async function getLatestFromCache(storeName) {
    const items = await getAllFromCache(storeName, 1, 'desc');
    return items.length > 0 ? items[0] : null;
}
