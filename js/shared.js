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



export function formatFeedContent(rawContent, processTextFn) {
    if (!rawContent) return '';
    const imgRegex = /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s]*)?)/gi;
    
    // 1. 提取图片链接
    const images = [];
    let match;
    while ((match = imgRegex.exec(rawContent)) !== null) {
        images.push(match[1]);
    }
    
    // 2. 从原文本中移除图片链接，避免占据预览截断空间
    const cleanText = rawContent.replace(imgRegex, '').trim();
    
    // 3. 处理纯文本 (通常是传入 markdownToPreview 或截断 + escapeHtml)
    let processedHtml = processTextFn ? processTextFn(cleanText) : escapeHtml(cleanText);
    
    // 4. 追加图片
    if (images.length > 0) {
        const imagesHtml = images.map(url => `
            <div class="feed-image-container" style="display: flex; justify-content: center; padding: 12px 0; width: 100%;">
                <img src="${escapeHtml(url)}" class="feed-image" onclick="if(window.previewImage){window.previewImage('${escapeHtml(url)}'); event.stopPropagation();}" loading="lazy" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: var(--shadow-sm); cursor: zoom-in; background: var(--surface-2);" />
            </div>
        `).join('');
        processedHtml += `<div class="feed-images-wrapper" style="margin-top: 10px;">${imagesHtml}</div>`;
    }
    
    return processedHtml;
}

// 全局图片预览功能
if (typeof window !== 'undefined') {
    window.previewImage = function(url) {
        let overlay = document.getElementById('global-image-preview-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'global-image-preview-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                backgroundColor: 'rgba(0,0,0,0.9)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: '999999',
                cursor: 'zoom-out',
                opacity: '0',
                transition: 'opacity 0.3s ease'
            });
            
            const img = document.createElement('img');
            img.id = 'global-image-preview-img';
            Object.assign(img.style, {
                maxWidth: '95%',
                maxHeight: '95%',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                transform: 'scale(0.95)',
                transition: 'transform 0.3s ease'
            });
            
            overlay.appendChild(img);
            document.body.appendChild(overlay);
            
            overlay.onclick = function() {
                overlay.style.opacity = '0';
                img.style.transform = 'scale(0.95)';
                setTimeout(() => { overlay.style.display = 'none'; }, 300);
            };
        }
        
        const img = document.getElementById('global-image-preview-img');
        img.src = url;
        overlay.style.display = 'flex';
        // 强制重绘以触发动画
        void overlay.offsetWidth;
        overlay.style.opacity = '1';
        img.style.transform = 'scale(1)';
    };
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
        return `${escapedName}<span class="year-badge">${sid.substring(0, 4)}级</span>`;
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
    const fallbackName = cleanAuthorId ? `同学${cleanAuthorId.slice(-4)}` : '未知成员';

    const plainName = cachedUser?.name || (!rawName || rawName.includes(':') ? fallbackName : rawName);
    const name = formatNameWithYear(plainName, cleanAuthorId);
    
    const avatar = cachedUser?.avatar || '';
    const cleanAvatar = String(avatar).trim();
    const isImageAvatar = cleanAvatar.startsWith('http://') || cleanAvatar.startsWith('https://') || cleanAvatar.startsWith('/') || cleanAvatar.startsWith('data:');
    const initial = (plainName || cleanAuthorId || '?').trim().charAt(0) || '?';

    return {
        avatar: cleanAvatar,
        cleanAuthorId,
        initial,
        isImageAvatar,
        name,
        plainName
    };
}

export function renderAuthorAvatar(author, lineHeight = 40) {
    const initial = (author.initial || author.plainName || '?').trim().charAt(0) || '?';
    const initialEscaped = escapeHtml(initial);
    const fallbackSpan = `<span style="line-height: ${lineHeight}px; color: #ffffff; font-weight: bold; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background-color: var(--accent, #228be6); border-radius: 50%;">${initialEscaped}</span>`;

    if (author.isImageAvatar) {
        return `<img src="${escapeHtml(author.avatar)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" alt="头像" onerror="this.onerror=null;this.outerHTML='${fallbackSpan.replace(/'/g, "&#39;").replace(/"/g, "&quot;")}'">`;
    }

    return fallbackSpan;
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
