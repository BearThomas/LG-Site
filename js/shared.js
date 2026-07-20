// Appwrite is now server-side only; these compatibility constants stay blank.
export const APPWRITE_ENDPOINT = '';
export const APPWRITE_PROJECT_ID = '';
export const DATABASE_ID = 'lg';
export const COLLECTION_POSTS = 'posts';
export const COLLECTION_COMMENTS = 'comments';
export const COLLECTION_CONFESSIONS = 'confessions';
export const COLLECTION_USERS = 'users';

export async function restoreSecureKey() {
    // BACKUP_ENCRYPT_KEY is server/local-migration only. Remove any legacy
    // browser copy so encrypted private backup fields can never be decrypted
    // by arbitrary site visitors.
    delete window.secureKeyBlackBox;
    if (typeof localforage !== 'undefined') {
        try { await localforage.removeItem('secure_gate_key'); } catch {}
    }
    return null;
}

const ENCRYPTED_BACKUP_VALUE = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

export async function decryptText(value) {
    if (value === undefined || value === null) return value;
    const text = String(value);
    return ENCRYPTED_BACKUP_VALUE.test(text) ? null : value;
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

    if (window.customBoardsCache && window.customBoardsCache[boardId]) {
        return window.customBoardsCache[boardId].name || boardId;
    }

    return boardId;
}

export function formatNameWithYear(name, studentId) {
    let rawName = (name || '').toString().trim();
    const sid = (studentId || '').toString().replace(/^student_/, '').trim();
    if (!rawName) {
        rawName = sid ? `同学${sid.slice(-4)}` : '未知成员';
    }
    const escapedName = escapeHtml(rawName);
    if (sid.length >= 4) {
        return `${escapedName}<span class="year-badge">${sid.substring(0, 4)}�?/span>`;
    }
    return escapedName;
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

    let name = cachedUser?.name || (!rawName || rawName.includes(':') ? fallbackName : rawName);
    name = formatNameWithYear(name, cleanAuthorId);
    
    const avatar = cachedUser?.avatar || '';
    const isImageAvatar = avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/') || avatar.startsWith('data:');
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

export async function getUsersInfo(databases, Query, userIds) {
    if (!userIds || userIds.length === 0) return {};
    
    // Normalize IDs
    const normalizedIds = [...new Set(userIds.map(id => id.toString().replace(/^student_/, '').trim()))].filter(Boolean);
    if (normalizedIds.length === 0) return {};
    
    // Fetch from IndexedDB
    let cachedUsers = {};
    try {
        const idb = await import('./idb-cache.js');
        cachedUsers = await idb.getMultipleFromCache('users', normalizedIds);
    } catch (e) {
        console.warn('IDB failed, falling back to network', e);
    }
    
    const missingIds = normalizedIds.filter(id => !cachedUsers[id]);
    
    // Fetch missing from server
    if (missingIds.length > 0) {
        // Chunk into max 100 per request
        for (let i = 0; i < missingIds.length; i += 100) {
            const chunk = missingIds.slice(i, i + 100);
            try {
                const response = await databases.listDocuments(DATABASE_ID, COLLECTION_USERS, [
                    Query.equal('userId', chunk),
                    Query.limit(100)
                ]);
                
                const docs = response.documents || [];
                const usersToSave = docs.map(doc => {
                    const uid = (doc.userId || doc.studentId || doc.$id || '').toString().trim();
                    const cleanId = uid.replace(/^student_/, '');
                    return {
                        $id: cleanId,
                        studentId: uid,
                        name: doc.name || `\u540c\u5b66${uid.slice(-4)}`,
                        avatar: doc.avatar || ''
                    };
                });
                
                if (usersToSave.length > 0) {
                    try {
                        const idb = await import('./idb-cache.js');
                        await idb.putToCache('users', usersToSave);
                    } catch (e) {}
                    usersToSave.forEach(u => cachedUsers[u.$id] = u);
                }
            } catch (e) {
                console.error('Failed to fetch user chunk:', e);
            }
        }
    }
    
    // Update window.userCache for legacy compat
    if (!window.userCache) window.userCache = {};
    for (const id in cachedUsers) {
        const u = cachedUsers[id];
        window.userCache[id] = u;
        window.userCache[`student_${id}`] = u;
    }
    
    return cachedUsers;
}

export function goToUserProfile(userId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!userId) return;
    
    try {
        const currentUserData = localStorage.getItem('campus_user');
        if (currentUserData) {
            const currentUser = JSON.parse(currentUserData);
            const rawCurrentId = (currentUser.studentId || currentUser.userId || '').toString().replace(/^student_/, '').trim();
            const targetId = userId.toString().replace(/^student_/, '').trim();
            
            if (rawCurrentId === targetId) {
                window.location.href = 'profile.html';
                return;
            }
        }
    } catch(e) {}

    window.location.href = 'user.html?id=' + userId;
}
window.goToUserProfile = goToUserProfile;
