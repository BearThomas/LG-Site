export const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
export const APPWRITE_PROJECT_ID = 'lg';
export const DATABASE_ID = 'lg';
export const COLLECTION_POSTS = 'posts';
export const COLLECTION_COMMENTS = 'comments';
export const COLLECTION_CONFESSIONS = 'confessions';
export const COLLECTION_USERS = 'users';

export async function restoreSecureKey() {
    try {
        if (typeof localforage === 'undefined') return null;

        const cryptoKey = await localforage.getItem('secure_gate_key');
        if (cryptoKey) {
            window.secureKeyBlackBox = cryptoKey;
            console.log('Secure key restored from IndexedDB.');
            return cryptoKey;
        }

        console.warn('Secure key is missing; encrypted content may not decrypt.');
        return null;
    } catch (error) {
        console.error('Failed to read secure key from IndexedDB:', error);
        return null;
    }
}

function hexToBytes(hex) {
    const pairs = hex.match(/.{2}/g);
    if (!pairs) return new Uint8Array();
    return new Uint8Array(pairs.map(byte => parseInt(byte, 16)));
}

export async function decryptText(encryptedText) {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;

    const cryptoKey = window.secureKeyBlackBox;
    if (!cryptoKey) {
        console.warn('Secure key is missing; refusing to decrypt.');
        return null;
    }

    try {
        const [ivHex, ...cipherParts] = encryptedText.split(':');
        const iv = hexToBytes(ivHex);
        const ciphertext = hexToBytes(cipherParts.join(':'));
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            cryptoKey,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    } catch (error) {
        console.warn('Failed to decrypt text.');
        return null;
    }
}

export function formatTime(date) {
    const parsedDate = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsedDate.getTime())) return '';

    const now = new Date();
    const diff = now - parsedDate;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '\u521a\u521a';
    if (minutes < 60) return `${minutes}\u5206\u949f\u524d`;
    if (hours < 24) return `${hours}\u5c0f\u65f6\u524d`;
    if (days < 7) return `${days}\u5929\u524d`;

    return `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}`;
}

export function formatBoardName(boardId) {
    if (!boardId) return '\u672a\u77e5\u677f\u5757';
    if (boardId === 'main') return '\u4e3b\u677f\u5757';

    const classMatch = boardId.match(/^class_(\d{4})_(\d+)$/);
    if (classMatch) return `${classMatch[1]}\u5c4a${classMatch[2]}\u73ed`;

    return boardId;
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

export function normalizeUserId(userId) {
    return (userId || '').toString().trim().replace(/^student_/, '');
}

export function getUserFromCache(userCache, userId) {
    const rawId = (userId || '').toString().trim();
    const cleanId = normalizeUserId(rawId);

    return userCache[rawId] || userCache[cleanId] || userCache[`student_${cleanId}`] || null;
}

export function getPostAuthorDisplay(post, userCache = {}) {
    const rawAuthorId = (post.authorId || '').toString().trim();
    const cleanAuthorId = normalizeUserId(rawAuthorId);
    const cachedUser = getUserFromCache(userCache, rawAuthorId);
    const rawName = (post.authorName || '').toString().trim();
    const fallbackName = cleanAuthorId ? `\u540c\u5b66${cleanAuthorId.slice(-4)}` : '\u672a\u77e5\u6210\u5458';

    const name = cachedUser?.name || (!rawName || rawName.includes(':') ? fallbackName : rawName);
    const avatar = cachedUser?.avatar || '';
    const isImageAvatar = avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/');
    const initial = name.trim().charAt(0) || cleanAuthorId.charAt(0) || '?';

    return {
        avatar,
        cleanAuthorId,
        initial,
        isImageAvatar,
        name
    };
}

export function renderAuthorAvatar(author, lineHeight = 40) {
    if (author.isImageAvatar) {
        return `<img src="${escapeHtml(author.avatar)}" style="width: 100%; height: 100%; border-radius: inherit; object-fit: cover; display: block;" alt="\u5934\u50cf">`;
    }

    return `<span style="line-height: ${lineHeight}px;">${escapeHtml(author.initial)}</span>`;
}

export function indexUsersById(documents) {
    const userCache = {};
    const allUsers = documents.map(doc => {
        const uid = (doc.userId || doc.studentId || doc.$id || '').toString().trim();
        const item = {
            studentId: uid,
            name: doc.name || `\u540c\u5b66${uid.slice(-4)}`,
            avatar: doc.avatar || ''
        };

        const cleanId = uid.replace('student_', '');
        userCache[cleanId] = item;
        userCache[`student_${cleanId}`] = item;

        return item;
    });

    window.userCache = userCache;
    return { allUsers, userCache };
}

export async function loadUserDirectory(databases, Query) {
    const response = await databases.listDocuments(DATABASE_ID, COLLECTION_USERS, [
        // Query.limit(100)
    ]);
    console.log(response);
    return indexUsersById(response.documents);
}
