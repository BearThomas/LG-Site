// js/post-detail.js
import { Client, Databases, Query, Permission, Role } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

// ========== Appwrite 配置 ==========
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = 'lg';
const DATABASE_ID = 'lg';
const COLLECTION_POSTS = 'posts';
const COLLECTION_COMMENTS = 'comments';
const COLLECTION_USERS = 'users';

// 初始化
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

// 全局状态
let currentUser = null;
let currentPost = null;
let postId = null;

// DOM 元素
const postDetailCard = document.getElementById('postDetailCard');
const boardName = document.getElementById('boardName');
const commentCount = document.getElementById('commentCount');
const commentsList = document.getElementById('commentsList');
const commentInputBox = document.getElementById('commentInputBox');
const loginTip = document.getElementById('loginTip');
const commentContent = document.getElementById('commentContent');
const submitCommentBtn = document.getElementById('submitCommentBtn');
const commentAvatar = document.getElementById('commentAvatar');

// 弹窗
const editModal = document.getElementById('editModal');
const deleteModal = document.getElementById('deleteModal');

// ========== 【核心重构】页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    // 获取 URL 参数
    const params = new URLSearchParams(window.location.search);
    postId = params.get('id');
    
    if (!postId) {
        if (postDetailCard) postDetailCard.innerHTML = '<div class="empty-state"><p>帖子不存在</p></div>';
        return;
    }

    // console.log("⏳ 帖子详情页加载，正在等待长效会话守护就绪...");
    
    // // 1. 🔥 强行按住页面请求，等保活模块在后台换取最新 Token
    // if (window.initAutoAuth) {
    //     try {
    //         await window.initAutoAuth(); 
    //         console.log("✓ 会话守护已就绪，开始安全加载帖子与评论数据。");
    //     } catch (e) {
    //         console.error("认证保活模块初始化异常:", e);
    //     }
    // }

    // // 2. 钥匙同步：给当前的 Appwrite 客户端喂下最新续期的 JWT
    // const latestJwt = localStorage.getItem('persistent_jwt');
    // if (latestJwt) {
    //     client.setJWT(latestJwt);
    //     console.log("🔑 全局 Appwrite 客户端已成功同步最新的 JWT 凭证");
    // }
    
    // 3. 此时全身都是最新长效钥匙，开始并行加载冷热时空数据
    checkLoginStatus();
    await loadPostDetail();
    await loadComments();
    bindEvents();
});

// ========== 登录状态 ==========
// ========== 登录状态 ==========
function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    
    if (userData) {
        try {
            currentUser = JSON.parse(userData);
            if (userNotLogin) userNotLogin.style.display = 'none';
            if (userLoggedIn) userLoggedIn.style.display = 'flex';
            
            const userNameEl = document.getElementById('userName');
            const userAvatarEl = document.getElementById('userAvatar');
            if (userNameEl) userNameEl.textContent = `学号尾号 ${currentUser.studentId.slice(-4)}`;
            if (userAvatarEl) userAvatarEl.textContent = currentUser.studentId.charAt(0);
            if (commentAvatar) commentAvatar.textContent = currentUser.studentId.charAt(0);
            
            if (commentInputBox) commentInputBox.style.display = 'flex';
            if (loginTip) loginTip.style.display = 'none';
        } catch (e) {
            currentUser = null;
        }
    } else {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
        if (commentInputBox) commentInputBox.style.display = 'none';
        if (loginTip) loginTip.style.display = 'block';
    }
}
// ========== 【时空融合】加载帖子详情 ==========
async function loadPostDetail() {
    try {
        currentPost = await databases.getDocument(DATABASE_ID, COLLECTION_POSTS, postId);
        console.log("🔥 从 Appwrite 云端获取帖子");
    } catch (error) {
        console.warn('热数据未找到，检索冷备份...');
        try {
            const url = `https://cdn.jsdelivr.net/gh/BearThomas/LG-Site-Backup@main/backups/last/posts.json`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('加载失败');
            
            const backupData = await res.json();
            let docs = backupData.documents || backupData || [];
            
            // ⭐ 解密
            if (backupData.encrypted) {
                docs = await Promise.all(docs.map(async p => ({
                    ...p,
                    content: await decryptColdData(p.content),
                    title: await decryptColdData(p.title),
                    authorName: await decryptColdData(p.authorName),
                    targetGroups: JSON.parse(await decryptColdData(p.targetGroups) || '[]')
                })));
            }
            
            currentPost = docs.find(p => (p.id === postId || p.$id === postId));
            if (!currentPost) throw new Error('未找到');
            console.log("❄️ 从冷备份获取帖子");
        } catch (localErr) {
            if (postDetailCard) postDetailCard.innerHTML = '<div class="empty-state"><p>帖子不存在</p></div>';
            return;
        }
    }
    if (boardName) boardName.textContent = formatBoardName(currentPost.boardId);
    renderPostDetail();
}

function renderPostDetail() {
    if (!postDetailCard) return;
    const postStatus = currentPost.status || 0;
    const isPinned = (postStatus & 1) !== 0;
    const isLocked = (postStatus & 2) !== 0;
    
    // 兼容全量字段命名 ($id 或 id，authorId)
    const currentPostId = currentPost.$id || currentPost.id;
    const isAuthor = currentUser && currentUser.studentId === currentPost.authorId;
    const postCreatedAt = currentPost.$createdAt || currentPost.createdAt;
    
    const createdAt = new Date(postCreatedAt);
    const timeStr = formatTime(createdAt);
    
    let actionsHtml = '';
    if (isAuthor) {
        actionsHtml = `
            <button class="post-action-btn" id="editPostBtn">✏️ 编辑</button>
            <button class="post-action-btn danger" id="deletePostBtn">🗑️ 删除</button>
        `;
    }
    
    postDetailCard.innerHTML = `
        <div class="post-detail-header">
            <h1 class="post-detail-title">${escapeHtml(currentPost.title)}</h1>
            <div class="post-detail-meta">
                <div class="post-author-info">
                    <div class="post-detail-avatar">${currentPost.authorName?.charAt(0) || '?'}</div>
                    <div class="post-author-detail">
                        <span class="post-author-name">${escapeHtml(currentPost.authorName || '匿名')}</span>
                        <span class="post-time">${timeStr} · ${isPinned ? '📌 置顶' : ''} ${isLocked ? '🔒 已锁定' : ''}</span>
                    </div>
                </div>
                <div class="post-actions">
                    ${actionsHtml}
                </div>
            </div>
        </div>
        <div class="post-detail-content">${escapeHtml(currentPost.content)}</div>
        <div class="post-detail-footer">
            <button class="post-stat-btn" id="likeBtn">
                <span>👍</span>
                <span id="likeCount">0</span>
            </button>
        </div>
    `;
    
    // 绑定编辑/删除事件
    if (isAuthor) {
        document.getElementById('editPostBtn')?.addEventListener('click', openEditModal);
        document.getElementById('deletePostBtn')?.addEventListener('click', openDeleteModal);
    }
    
    // 如果帖子被锁定，禁用评论
    if (isLocked) {
        if (commentInputBox) commentInputBox.style.display = 'none';
        if (loginTip) loginTip.style.display = 'none';
        const lockedTip = document.createElement('div');
        lockedTip.className = 'login-tip';
        lockedTip.innerHTML = '<p>🔒 帖子已锁定，无法评论</p>';
        if (commentsList) commentsList.insertAdjacentElement('beforebegin', lockedTip);
    }
}

// ========== 【时空融合】加载评论列表 ==========
async function loadComments() {
    try {
        if (!commentsList) return;

        const [appwriteRes, localRes] = await Promise.all([
            databases.listDocuments(DATABASE_ID, COLLECTION_COMMENTS, [
                Query.equal('postId', postId),
                Query.orderAsc('$createdAt')
            ]).catch(err => {
                console.warn('热评论加载失败:', err.message);
                return { documents: [] };
            }),
            (async () => {
                try {
                    const url = `https://cdn.jsdelivr.net/gh/BearThomas/LG-Site-Backup@main/backups/last/comments.json`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        let docs = data.documents || data || [];
                        
                        // ⭐ 解密
                        if (data.encrypted) {
                            docs = await Promise.all(docs.map(async c => ({
                                ...c,
                                content: await decryptColdData(c.content),
                                authorName: await decryptColdData(c.authorName)
                            })));
                        }
                        
                        return docs.filter(c => c.postId === postId);
                    }
                } catch (e) {}
                return [];
            })()
        ]);

        const allComments = [...appwriteRes.documents, ...localRes];
        allComments.sort((a, b) => {
            const timeA = new Date(a.$createdAt || a.createdAt);
            const timeB = new Date(b.$createdAt || b.createdAt);
            return timeA - timeB;
        });
        
        if (commentCount) commentCount.textContent = allComments.length;
        renderComments(allComments);
    } catch (error) {
        console.error('加载评论失败:', error);
    }
}

function renderComments(comments) {
    if (!commentsList) return;
    if (!comments.length) {
        commentsList.innerHTML = `
            <div class="empty-comments">
                <div class="empty-icon">💬</div>
                <p>还没有评论，快来抢沙发！</p>
            </div>
        `;
        return;
    }
    
    commentsList.innerHTML = comments.map(comment => {
        const commentId = comment.$id || comment.id;
        const commentCreatedAt = comment.$createdAt || comment.createdAt;
        
        const createdAt = new Date(commentCreatedAt);
        const timeStr = formatTime(createdAt);
        const isAuthor = currentUser && currentUser.studentId === comment.authorId;
        
        let actionsHtml = '';
        if (isAuthor) {
            actionsHtml = `<span class="comment-action danger" data-comment-id="${commentId}">删除</span>`;
        }
        
        return `
            <div class="comment-item" data-comment-id="${commentId}">
                <div class="comment-header">
                    <div class="comment-author-avatar">${comment.authorName?.charAt(0) || '?'}</div>
                    <div class="comment-author-info">
                        <div class="comment-author-name">${escapeHtml(comment.authorName || '匿名')}</div>
                        <div class="comment-time">${timeStr}</div>
                    </div>
                </div>
                <div class="comment-content">${escapeHtml(comment.content)}</div>
                <div class="comment-actions-bar">
                    ${actionsHtml}
                </div>
            </div>
        `;
    }).join('');
    
    // 绑定删除事件
    document.querySelectorAll('.comment-action.danger').forEach(btn => {
        btn.addEventListener('click', () => deleteComment(btn.dataset.commentId));
    });
}

// ========== 发表评论 ==========
// ========== 发表评论 ==========
async function submitComment() {
    if (!currentUser) {
        alert('请先登录');
        return;
    }
    
    const content = commentContent.value.trim();
    if (!content) {
        alert('请输入评论内容');
        return;
    }
    if (content.length < 2) {
        alert('评论至少2个字');
        return;
    }
    
    submitCommentBtn.disabled = true;
    submitCommentBtn.textContent = '发布中...';
    
    try {
        await databases.createDocument(DATABASE_ID, COLLECTION_COMMENTS, 'unique()', {
            postId: postId,
            content: content,
            authorId: currentUser.studentId,
            authorName: `同学${currentUser.studentId.slice(-4)}`
        });
        
        commentContent.value = '';
        await loadComments();
    } catch (error) {
        console.error('评论失败:', error);
        alert('评论失败，请重试');
    } finally {
        if (submitCommentBtn) {
            submitCommentBtn.disabled = false;
            submitCommentBtn.textContent = '发 布';
        }
    }
}

// ========== 删除评论 ==========
async function deleteComment(commentId) {
    if (!confirm('确定删除这条评论吗？')) return;
    
    try {
        await databases.deleteDocument(DATABASE_ID, COLLECTION_COMMENTS, commentId);
        await loadComments();
    } catch (error) {
        console.error('删除评论失败:', error);
        alert('删除失败');
    }
}

// ========== 编辑帖子 ==========
function openEditModal() {
    const editTitleEl = document.getElementById('editTitle');
    const editContentEl = document.getElementById('editContent');
    if (editTitleEl) editTitleEl.value = currentPost.title;
    if (editContentEl) editContentEl.value = currentPost.content;
    if (editModal) editModal.style.display = 'flex';
}

async function submitEdit() {
    const title = document.getElementById('editTitle').value.trim();
    const content = document.getElementById('editContent').value.trim();
    
    if (!title || !content) {
        alert('标题和内容不能为空');
        return;
    }
    
    try {
        const currentPostId = currentPost.$id || currentPost.id;
        await databases.updateDocument(DATABASE_ID, COLLECTION_POSTS, currentPostId, {
            title,
            content,
            editedAt: new Date().toISOString()
        });
        
        if (editModal) editModal.style.display = 'none';
        await loadPostDetail();
    } catch (error) {
        console.error('编辑失败:', error);
        alert('编辑失败');
    }
}

// ========== 删除帖子 ==========
function openDeleteModal() {
    if (deleteModal) deleteModal.style.display = 'flex';
}

async function confirmDelete() {
    try {
        const currentPostId = currentPost.$id || currentPost.id;
        await databases.deleteDocument(DATABASE_ID, COLLECTION_POSTS, currentPostId);
        alert('删除成功');
        location.href = 'posts.html';
    } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败');
    }
}

// ========== 事件绑定 ==========
function bindEvents() {
    if (submitCommentBtn) submitCommentBtn.addEventListener('click', submitComment);
    
    if (commentContent) {
        commentContent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                submitComment();
            }
        });
    }
    
    // 弹窗关闭
    document.getElementById('closeEditModalBtn')?.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });
    document.getElementById('cancelEditBtn')?.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });
    document.getElementById('submitEditBtn')?.addEventListener('click', submitEdit);
    
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => { if (deleteModal) deleteModal.style.display = 'none'; });
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);
    
    if (editModal) editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.style.display = 'none'; });
    if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) deleteModal.style.display = 'none'; });
    
    // 退出登录
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('campus_user');
        localStorage.removeItem('persistent_jwt');
        location.reload();
    });
    
    document.getElementById('userAvatar')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = document.getElementById('dropdownMenu');
        if (menu) menu.classList.toggle('show');
    });
}

// ========== 工具函数 ==========
function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatBoardName(boardId) {
    if (!boardId) return '未知板块';
    if (boardId === 'main') return '主板块';
    const classMatch = boardId.match(/^class_(\d{4})_(\d+)$/);
    if (classMatch) return `${classMatch[1]}届${classMatch[2]}班`;
    return boardId;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

async function decryptColdData(encryptedText) {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
    const [ivHex, cipherHex] = encryptedText.split(':');
    const encoder = new TextEncoder();
    const keyBuffer = encoder.encode(ENCRYPT_KEY.padEnd(32, '0').slice(0, 32));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-CBC' }, false, ['decrypt']);
    const iv = new Uint8Array(ivHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const ciphertext = new Uint8Array(cipherHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, ciphertext);
    return new TextDecoder().decode(decrypted);
}