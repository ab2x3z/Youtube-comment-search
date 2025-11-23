// db.js
const DB_NAME = 'YoutubeCommentsDB';
const DB_VERSION = 1;
const STORE_NAME = 'comments';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (e) => reject('DB Error: ' + e.target.error);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'videoId' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
    });
}

async function saveCommentsToDB(videoId, comments) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ videoId, comments });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function getCommentsFromDB(videoId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(videoId);
        request.onsuccess = () => resolve(request.result ? request.result.comments : []);
        request.onerror = (e) => reject(e.target.error);
    });
}