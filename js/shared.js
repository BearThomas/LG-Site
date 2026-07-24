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
    const imgRegex = /(?:!\[[^\]]*\]\()?((?:https?:\/\/[^\s)]+?|\/api\/images\/[^\s)]+?)\.(?:png|jpe?g|gif|webp|bmp)(?:\?[^\s)]*)?)(?:\))?/gi;
    
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
    
    // 4. 追加图片 (横向滑动图库)
    if (images.length > 0) {
        const imagesHtml = images.map(url => `
            <img src="${escapeHtml(url)}" onclick="if(window.previewImage){window.previewImage('${escapeHtml(url)}'); event.stopPropagation();}" loading="lazy" style="flex: 0 0 auto; max-height: 160px; width: auto; max-width: 85vw; border-radius: 8px; box-shadow: var(--shadow-sm); cursor: zoom-in; background: var(--surface-2); object-fit: cover; object-position: top;" />
        `).join('');
        
        // 使用 -webkit-scrollbar 隐藏滚动条需要写在 CSS 里，这里用内联样式尽可能控制
        processedHtml += `
            <div class="feed-images-wrapper" style="display: flex; overflow-x: auto; gap: 8px; margin-top: 10px; padding-bottom: 4px; scroll-snap-type: x mandatory; -ms-overflow-style: none; scrollbar-width: none;">
                ${imagesHtml}
            </div>
        `;
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
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function normalizeUserId(userId) {
    return (userId || '').toString().trim().replace(/^student_/, '');
}

export function getUserFromCache(userCache, userId) {
    const rawId = (userId || '').toString().trim();
    const cleanId = normalizeUserId(rawId);

    return userCache[rawId] || userCache[cleanId] || userCache[`student_${cleanId}`] || null;
}

// ========== 图片上传通用逻辑 ==========
export function setupImageUpload(btnId, inputId, textareaId, currentUser, onUploadSuccess) {
    const uploadBtn = document.getElementById(btnId);
    const fileInput = document.getElementById(inputId);
    const textarea = textareaId ? document.getElementById(textareaId) : null;
    
    if (!uploadBtn || !fileInput) return;

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileInput.value = '';

        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '上传中...';
        uploadBtn.disabled = true;

        try {
            const formData = new FormData();
            formData.append('file', file);
            
            const headers = {};
            if (currentUser?.appToken) headers['X-LG-Token'] = currentUser.appToken;
            if (currentUser?.token) headers['X-Appwrite-Session'] = currentUser.token;

            const res = await fetch('/api/images/upload', {
                method: 'POST',
                headers,
                body: formData
            });

            let data;
            try { data = await res.json(); } catch(e) { throw new Error('上传接口返回异常'); }
            
            if (!data.success) throw new Error(data.error || '上传失败');

            if (onUploadSuccess) onUploadSuccess(data.url);

            if (textarea) {
                const insertText = `\n\n![图片](${data.url})\n\n`;
                
                if (textarea.selectionStart || textarea.selectionStart === 0) {
                    const startPos = textarea.selectionStart;
                    const endPos = textarea.selectionEnd;
                    textarea.value = textarea.value.substring(0, startPos) + insertText + textarea.value.substring(endPos, textarea.value.length);
                    textarea.selectionStart = startPos + insertText.length;
                    textarea.selectionEnd = startPos + insertText.length;
                } else {
                    textarea.value += insertText;
                }
                
                textarea.dispatchEvent(new Event('input'));
                textarea.focus();
            }
            
        } catch (err) {
            alert(err.message || '图片上传异常');
        } finally {
            uploadBtn.innerHTML = originalText;
            uploadBtn.disabled = false;
        }
    });
}

export function extractImageUrls(text) {
    const regex = /\/api\/images\/([^)"\s]+)/gi;
    const urls = new Set();
    let match;
    while ((match = regex.exec(text || '')) !== null) {
        urls.add('/api/images/' + match[1]);
    }
    return urls;
}

export async function deleteImages(urlsSet, currentUser) {
    if (!urlsSet || urlsSet.size === 0) return;
    const headers = {};
    if (currentUser?.appToken) headers['X-LG-Token'] = currentUser.appToken;
    if (currentUser?.token) headers['X-Appwrite-Session'] = currentUser.token;

    for (const url of urlsSet) {
        try {
            await fetch(url, { method: 'DELETE', headers });
        } catch (e) {
            console.warn('图片删除失败:', url, e);
        }
    }
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
    const initial = (plainName || cleanAuthorId || '?').trim().replace(/^同学.*/, '学').charAt(0) || '?';

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
    const initial = (author.initial || author.plainName || '?').trim().replace(/^同学.*/, '学').charAt(0) || '?';
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

export async function showFollowsList(title, targetUserId, type) {
    let modal = document.getElementById('followsListModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'followsListModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container" style="max-width: 400px; padding: 0; background: var(--surface);">
                <div class="modal-header" style="padding: 15px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h3 id="followsListTitle" style="margin: 0; color: var(--text-primary); font-size: 1.1rem;">列表</h3>
                    <button class="modal-close" id="closeFollowsListBtn" style="background: none; border: none; font-size: 1.5rem; color: var(--text-secondary); cursor: pointer;">&times;</button>
                </div>
                <div class="modal-body" id="followsListBody" style="max-height: 400px; overflow-y: auto; padding: 0;">
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('closeFollowsListBtn').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }

    document.getElementById('followsListTitle').textContent = title;
    const listBody = document.getElementById('followsListBody');
    listBody.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">加载中...</div>';
    modal.style.display = 'flex';

    try {
        const res = await fetch(`/api/list-follows?id=${encodeURIComponent(targetUserId)}&type=${type}`);
        if (!res.ok) throw new Error('网络请求失败');
        const data = await res.json();
        
        if (!data.users || data.users.length === 0) {
            listBody.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">暂无数据</div>';
            return;
        }

        listBody.innerHTML = data.users.map(u => {
            const cleanId = String(u.userId || '').replace(/^student_/, '');
            const rawId = String(u.userId || '');
            const safeName = window.escapeHtml ? escapeHtml(u.name || '未知') : (u.name || '未知');
            const firstChar = safeName.charAt(0);
            
            let avatarHtml = `<div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">${firstChar}</div>`;
            if (u.avatar) {
                avatarHtml = `<img src="${window.escapeHtml ? escapeHtml(u.avatar) : u.avatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0;">`;
            }
            
            return `
                <div style="display: flex; align-items: center; padding: 15px 20px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'" onclick="window.goToUserProfile('${rawId}', event)">
                    ${avatarHtml}
                    <div style="margin-left: 15px;">
                        <div style="font-weight: 500; color: var(--text-primary);">${safeName}</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">ID: ${cleanId}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        listBody.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">加载失败</div>';
    }
}
window.showFollowsList = showFollowsList;
