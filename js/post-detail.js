// js/post-detail.js
// Made by BearThomas 2026/5/30
import { Client, Databases, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';
import { renderMarkdown } from './markdown.js';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_COMMENTS,
    COLLECTION_POSTS,
    COLLECTION_USERS,
    DATABASE_ID,
    decryptText,
    escapeHtml,
    formatBoardName,
    formatTime,
    loadUserDirectory,
    restoreSecureKey
} from './shared.js';

// 初始化
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

// 全局状态
let currentUser = null;
let currentPost = null;
let postId = null;

// 🌟 核心新增：全局实名用户内存高速缓存字典
let userCache = {};
let allUsers = null;

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

// ========== ⚡ 页面加载初始化生命周期调整 ==========
document.addEventListener('DOMContentLoaded', async () => {
    await restoreSecureKey();
    const params = new URLSearchParams(window.location.search);
    postId = params.get('id');
    
    if (!postId) {
        if (postDetailCard) postDetailCard.innerHTML = '<div class="empty-state"><p>帖子 ID 缺失，页面无法加载</p></div>';
        return;
    }

    checkLoginStatus();
    // 🌟 关键注入：必须在加载帖子及评论详情前，将全量活跃用户名片快照安全拉入内存
    await loadAllUsers(); 
    await loadPostDetail(); 
    bindEvents();
});

// ========== 🌟 一键预载全量用户到详情页本地缓存字典 ==========
async function loadAllUsers() {
    try {
        const directory = await loadUserDirectory(databases, Query);
        userCache = directory.userCache;
        allUsers = directory.allUsers;
        console.log(`✅ 详情页身份链：已预载 ${allUsers.length} 个用户名片到高速内存字典`);
    } catch (e) {
        console.warn('⚡ 初始化详情页用户身份快照失败，渲染将被迫降级使用内嵌冗余数据:', e.message);
    }
}
// ========== 登录状态恢复 ==========
function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    
    if (userData) {
        try {
            currentUser = JSON.parse(userData);
            
            if (currentUser.token) {
                client.setJWT(currentUser.token);
            }
            
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

// ========== 异步安全获取用户板块权限组 ==========
async function getUserJoinedBoards() {
    if (!currentUser) return ['main'];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_USERS, [
            Query.equal('userId', currentUser.studentId)
        ]);
        if (response.documents.length > 0) {
            return response.documents[0].joinedBoards || ['main'];
        }
    } catch (e) {
        console.warn('获取用户所属板块权限组失败:', e);
    }
    return ['main'];
}

// ========== 可见性权限拦截判断 ==========
function isPostVisible(post, userBoards) {
    if (post.title === null || post.content === null) {
        return false; 
    }
    const viewPermission = post.viewPermission || 1;
    const isAuthor = currentUser && currentUser.studentId === post.authorId;
    
    if (viewPermission === 1) return true;  
    if (viewPermission === 8) return isAuthor; 
    if (viewPermission === 2) {             
        if (!currentUser) return false;
        return userBoards.includes(post.boardId);
    }
    if (viewPermission === 4) {             
        if (!currentUser) return false;
        const targetGroups = post.targetGroups || [];
        return targetGroups.includes(currentUser.studentId) || targetGroups.some(g => userBoards.includes(g));
    }
    return false;
}

// ========== 加载帖子详情 ==========
async function loadPostDetail() {
    try {
        if (postDetailCard) postDetailCard.innerHTML = '<div class="loading-state">安全审查中...</div>';
        
        currentPost = await databases.getDocument(DATABASE_ID, COLLECTION_POSTS, postId);
        console.log("🔥 成功获取热数据帖子");
    } catch (error) {
        console.warn('云端未发现指定热数据，正在排查数据冷备份...');
        try {
            const url = `./public/data-backups/posts.json`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('冷备份读取失败');
            
            const backupData = await res.json();
            let docs = backupData.documents || backupData || [];
            
            if (backupData.encrypted) {
                docs = await Promise.all(docs.map(async p => {
                    let targetGroups = [];
                    if (p.targetGroups !== '已隐藏') {
                        const decrypted = await decryptText(p.targetGroups);
                        try { targetGroups = JSON.parse(decrypted || '[]'); } catch { targetGroups = []; }
                    }
                    return {
                        ...p,
                        content: await decryptText(p.content),
                        title: await decryptText(p.title),
                        authorName: await decryptText(p.authorName),
                        targetGroups: targetGroups
                    };
                }));
            }
            
            currentPost = docs.find(p => (p.id === postId || p.$id === postId));
            if (!currentPost) throw new Error('帖子实体不存在');
            console.log("❄️ 成功激活冷备份归档帖子");
        } catch (localErr) {
            if (postDetailCard) postDetailCard.innerHTML = '<div class="empty-state"><p>报错：当前查看的帖子已被彻底移除或并不存在</p></div>';
            return;
        }
    }

    const userBoards = await getUserJoinedBoards();
    if (!isPostVisible(currentPost, userBoards)) {
        if (postDetailCard) {
            postDetailCard.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔒</div>
                    <p style="color: #fa5252; font-weight: bold;">访问被拒绝：您没有查看此私密贴或班级专属贴的权限。</p>
                    <a href="posts.html" style="font-size: 14px; margin-top: 10px; color: #228be6; display: inline-block;">返回帖子大厅</a>
                </div>`;
        }
        if (commentInputBox) commentInputBox.style.display = 'none';
        if (loginTip) loginTip.style.display = 'none';
        return; 
    }

    if (boardName) boardName.textContent = formatBoardName(currentPost.boardId);
    document.title = `${currentPost.title || '帖子详情'} | 龙高北小站`;
    renderPostDetail();
    await loadComments(); 
}

// ========== 🌟 智能化改写点 1：不信任主贴数据源渲染 ==========
function renderPostDetail() {
    if (!postDetailCard) return;
    const postStatus = currentPost.status || 0;
    const isPinned = (postStatus & 1) !== 0;
    const isLocked = (postStatus & 2) !== 0;
    
    const isAuthor = currentUser && currentUser.studentId === currentPost.authorId;
    const postCreatedAt = currentPost.$createdAt || currentPost.createdAt;
    const timeStr = formatTime(new Date(postCreatedAt));
    
    let actionsHtml = '';
    if (isAuthor && !currentPost._isCold) { 
        actionsHtml = `
            <button class="post-action-btn" id="editPostBtn">✏️ 编辑</button>
            <button class="post-action-btn danger" id="deletePostBtn">🗑️ 删除</button>
        `;
    }

    // 🛡️ 宁信 ID，不信其名：通过内存缓存快速穿透主贴作者信息
    const rawAuthorId = (currentPost.authorId || '').toString().trim();
    const cachedUser = userCache[rawAuthorId];
    
    let finalName = '未知成员';
    let avatarHtml = '?';

    if (cachedUser) {
        finalName = cachedUser.name;
        const isImgUrl = cachedUser.avatar && (cachedUser.avatar.startsWith('http') || cachedUser.avatar.startsWith('/'));
        if (isImgUrl) {
            avatarHtml = `<img src="${escapeHtml(cachedUser.avatar)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" alt="头像">`;
        } else {
            avatarHtml = `<span style="line-height: 40px;">${escapeHtml(finalName.trim().charAt(0) || '?')}</span>`;
        }
    } else {
        const rawName = currentPost.authorName || '';
        finalName = rawName.includes(':') ? `同学${rawAuthorId.slice(-4)}` : (rawName || '匿名同学');
        avatarHtml = `<span style="line-height: 40px;">${escapeHtml(finalName.trim().charAt(0) || '?')}</span>`;
    }
    
    postDetailCard.innerHTML = `
        <div class="post-detail-header">
            <h1 class="post-detail-title">${escapeHtml(currentPost.title)}</h1>
            <div class="post-detail-meta">
                <div class="post-author-info">
                    <div class="post-detail-avatar" style="width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: #e0e0e0; flex-shrink: 0;">
                        ${avatarHtml}
                    </div>
                    <div class="post-author-detail">
                        <span class="post-author-name">${escapeHtml(finalName)}</span>
                        <span class="post-time">${timeStr} · ${isPinned ? '<span style="color:#e03131;">置顶</span>' : ''} ${isLocked ? '<span style="color:#f59f00;">已锁定</span>' : ''}</span>
                    </div>
                </div>
                <div class="post-actions">
                    ${actionsHtml}
                </div>
            </div>
        </div>
        <div class="post-detail-content markdown-body">${renderMarkdown(currentPost.content)}</div>
        <div class="post-detail-footer">
            <button class="post-stat-btn" id="likeBtn" disabled>
                <span></span>
            </button>
        </div>
    `;
    
    if (isAuthor && !currentPost._isCold) {
        document.getElementById('editPostBtn')?.addEventListener('click', openEditModal);
        document.getElementById('deletePostBtn')?.addEventListener('click', openDeleteModal);
    }
    
    if (isLocked) {
        if (commentInputBox) commentInputBox.style.display = 'none';
        if (loginTip) loginTip.style.display = 'none';
        
        if (!document.getElementById('postLockedBanner')) {
            const lockedTip = document.createElement('div');
            lockedTip.id = 'postLockedBanner';
            lockedTip.className = 'login-tip';
            lockedTip.style.backgroundColor = '#fff9db';
            lockedTip.style.borderColor = '#ffe066';
            lockedTip.innerHTML = '<p style="color: #f59f00; font-weight: bold; margin: 0;">该帖子已被管理员锁定，当前处于只读模式，无法追加新回复。</p>';
            commentsList?.insertAdjacentElement('beforebegin', lockedTip);
        }
    }
}

// ========== 加载并关联融合评论 ==========
async function loadComments() {
    try {
        if (!commentsList) return;

        const [appwriteRes, localRes] = await Promise.all([
            databases.listDocuments(DATABASE_ID, COLLECTION_COMMENTS, [
                Query.equal('postId', postId),
                Query.orderAsc('$createdAt')
            ]).catch(err => {
                console.warn('实时云评论通信故障:', err.message);
                return { documents: [] };
            }),
            (async () => {
                try {
                    const url = `./public/data-backups/comments.json`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        let docs = data.documents || data || [];
                        
                        if (data.encrypted) {
                            docs = await Promise.all(docs.map(async c => ({
                                ...c,
                                content: await decryptText(c.content),
                                authorName: await decryptText(c.authorName)
                            })));
                        }
                        return docs.filter(c => c.postId === postId);
                    }
                } catch (e) {}
                return [];
            })()
        ]);

        const normalizeComment = (c) => ({
            $id: c.$id || c.id,
            $createdAt: c.$createdAt || c.createdAt,
            content: c.content,
            authorId: c.authorId,
            authorName: c.authorName
        });

        const seen = new Set();
        const allComments = [...appwriteRes.documents.map(c=>normalizeComment(c)), ...localRes.map(c=>normalizeComment(c))]
            .filter(c => {
                if(seen.has(c.$id)) return false;
                seen.add(c.$id);
                return true;
            });

        allComments.sort((a, b) => new Date(a.$createdAt) - new Date(b.$createdAt));
        
        if (commentCount) commentCount.textContent = allComments.length;
        renderComments(allComments);
    } catch (error) {
        console.error('装载评论流水线挂裂:', error);
    }
}

// ========== 🌟 智能化改写点 2：动态映射子集回复评论区 ==========
function renderComments(comments) {
    if (!commentsList) return;
    if (!comments.length) {
        commentsList.innerHTML = `
            <div class="empty-comments">
                <div class="empty-icon"></div>
                <p>暂时还没有评论，快来抢占一楼沙发！</p>
            </div>
        `;
        return;
    }
    
    commentsList.innerHTML = comments.map(comment => {
        const isCommentAuthor = currentUser && currentUser.studentId === comment.authorId;
        const timeStr = formatTime(new Date(comment.$createdAt));
        
        let actionsHtml = '';
        if (isCommentAuthor) {
            actionsHtml = `<span class="comment-action danger" data-comment-id="${comment.$id}">删除</span>`;
        }

        // 🛡️ 评论实名制穿透：强制依据 comment.authorId 从字典快照捞数据
        const rawCommentAuthorId = (comment.authorId || '').toString().trim();
        const cachedCommentUser = userCache[rawCommentAuthorId];

        let commentName = '未知成员';
        let commentAvatarHtml = '?';

        if (cachedCommentUser) {
            commentName = cachedCommentUser.name;
            const isCommentImg = cachedCommentUser.avatar && (cachedCommentUser.avatar.startsWith('http') || cachedCommentUser.avatar.startsWith('/'));
            if (isCommentImg) {
                commentAvatarHtml = `<img src="${escapeHtml(cachedCommentUser.avatar)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block;" alt="头像">`;
            } else {
                commentAvatarHtml = `<span style="line-height: 32px;">${escapeHtml(commentName.trim().charAt(0) || '?')}</span>`;
            }
        } else {
            const rawCommentName = comment.authorName || '';
            commentName = rawCommentName.includes(':') ? `同学${rawCommentAuthorId.slice(-4)}` : (rawCommentName || '匿名同学');
            commentAvatarHtml = `<span style="line-height: 32px;">${escapeHtml(commentName.trim().charAt(0) || '?')}</span>`;
        }
        
        return `
            <div class="comment-item" data-comment-id="${comment.$id}">
                <div class="comment-header">
                    <div class="comment-author-avatar" style="width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: #e9ecef; flex-shrink: 0; font-size: 0.85rem;">
                        ${commentAvatarHtml}
                    </div>
                    <div class="comment-author-info">
                        <div class="comment-author-name">${escapeHtml(commentName)}</div>
                        <div class="comment-time">${timeStr}</div>
                    </div>
                </div>
                <div class="comment-content" style="white-space: pre-wrap; word-break: break-all;">${escapeHtml(comment.content)}</div>
                <div class="comment-actions-bar">
                    ${actionsHtml}
                </div>
            </div>
        `;
    }).join('');
    
    document.querySelectorAll('.comment-action.danger').forEach(btn => {
        btn.addEventListener('click', () => deleteComment(btn.dataset.commentId));
    });
}

// ========== 🚀 绝对防刷防重复提交版：发布新单条评论 ==========
async function submitComment() {
    // 🌟 【核心防刷熔断器】：开局立刻盘查。如果按钮已经是禁用状态，说明有上一次发送正在进行，直接无情拦截！
    // 这能百分之百封死：疯狂连击鼠标、或者疯狂敲击 Ctrl+Enter 快捷键带来的网络重发
    if (submitCommentBtn && submitCommentBtn.disabled) {
        console.warn("⚠️ 拦截到重复提交请求，上一次评论仍在同步中...");
        return;
    }

    if (!currentUser) {
        alert('请先登录');
        return;
    }
    
    if (currentPost && (currentPost.status & 2) !== 0) {
        alert('帖子已被管理员锁定，不再接收任何新提交');
        return;
    }
    
    const content = commentContent.value.trim();
    if (!content) {
        alert('请输入评论内容');
        return;
    }
    if (content.length < 2) {
        alert('内容太短，多说两个字吧');
        return;
    }
    
    // 🔒 【加锁】：通过验证后，在发起网络请求的毫秒瞬间，立刻锁死按钮，切断后续所有点击和快捷键
    if (submitCommentBtn) {
        submitCommentBtn.disabled = true;
        submitCommentBtn.textContent = '发布中...';
    }
    
    try {
        // 向 Appwrite 云端投递数据
        await databases.createDocument(DATABASE_ID, COLLECTION_COMMENTS, 'unique()', {
            postId: postId,
            content: content,
            authorId: currentUser.studentId,
            authorName: `同学${currentUser.studentId.slice(-4)}`
        });
        
        // 只有成功发送后，才清空文本框
        commentContent.value = '';
        
        // 重新拉取评论流更新 DOM
        await loadComments();
    } catch (error) {
        console.error('回复投递异常失败:', error);
        alert('回复提交失败，请重试');
    } finally {
        // 🔓 【解锁】：无论云端是成功还是报错（进入 finally），执行完后必须把锁解开，允许下一次正常发言
        if (submitCommentBtn) {
            submitCommentBtn.disabled = false;
            submitCommentBtn.textContent = '发 布';
        }
    }
}

// ========== 回收/删除子集评论 ==========
async function deleteComment(commentId) {
    if (!confirm('确定彻底撤销这条评论吗？')) return;
    try {
        await databases.deleteDocument(DATABASE_ID, COLLECTION_COMMENTS, commentId);
        await loadComments();
    } catch (error) {
        console.error('执行删除回复操作失败:', error);
        alert('删除失败，请稍后重试');
    }
}

// ========== 调出并激活编辑主贴框 ==========
function openEditModal() {
    if (currentPost._isCold) return;
    const editTitleEl = document.getElementById('editTitle');
    const editContentEl = document.getElementById('editContent');
    if (editTitleEl) editTitleEl.value = currentPost.title;
    if (editContentEl) editContentEl.value = currentPost.content;
    if (editModal) editModal.style.display = 'flex';
    updateEditPreview();

    document.getElementById('editTitle')?.addEventListener('input', updateEditPreview);
    document.getElementById('editContent')?.addEventListener('input', updateEditPreview);
}

async function submitEdit() {
    const title = document.getElementById('editTitle').value.trim();
    const content = document.getElementById('editContent').value.trim();
    
    if (!title || !content) {
        alert('标题与核心正文区域不能为空');
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
        console.error('修改帖子失败:', error);
        alert('编辑提交保存失败');
    }
}

// ========== 主贴删除模块弹窗 ==========
function openDeleteModal() {
    if (currentPost._isCold) return;
    if (deleteModal) deleteModal.style.display = 'flex';
}

async function confirmDelete() {
    try {
        const currentPostId = currentPost.$id || currentPost.id;
        await databases.deleteDocument(DATABASE_ID, COLLECTION_POSTS, currentPostId);
        alert('帖子已成功销毁');
        location.href = 'posts.html';
    } catch (error) {
        console.error('销毁帖子执行失败:', error);
        alert('删除失败');
    }
}

// ========== 全量事件底层监听绑定 ==========
function bindEvents() {
    if (submitCommentBtn) submitCommentBtn.addEventListener('click', submitComment);
    
    if (commentContent) {
        commentContent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                submitComment();
            }
        });
    }
    
    document.getElementById('closeEditModalBtn')?.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });
    document.getElementById('cancelEditBtn')?.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });
    document.getElementById('submitEditBtn')?.addEventListener('click', submitEdit);
    
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => { if (deleteModal) deleteModal.style.display = 'none'; });
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);
    
    if (editModal) editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.style.display = 'none'; });
    if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) deleteModal.style.display = 'none'; });
    
    document.getElementById('toggleEditPreviewBtn')?.addEventListener('click', toggleEditPreview);

    document.getElementById('editPreviewPane')?.addEventListener('click', (e) => {
        if (window.matchMedia('(max-width: 768px)').matches) {
            e.currentTarget.classList.remove('mobile-preview-open');
        }
    });
}


function updateEditPreview() {
    const title = document.getElementById('editTitle')?.value || '';
    const content = document.getElementById('editContent')?.value || '';
    const pane = document.getElementById('editPreviewPane');
    if (!pane) return;

    pane.innerHTML = `
        <h1>${escapeHtml(title || '无标题')}</h1>
        ${renderMarkdown(content || '*暂无内容*')}
    `;
}

function toggleEditPreview() {
    const pane = document.getElementById('editPreviewPane');
    const layout = pane?.closest('.editor-layout');
    if (!pane || !layout) return;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    updateEditPreview();

    if (isMobile) {
        pane.classList.add('mobile-preview-open');
    } else {
        pane.classList.toggle('preview-hidden');
        layout.classList.toggle('preview-closed');
    }
}