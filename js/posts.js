// js/posts.js
// Made by BearThomas 2026/5/31
import { markdownToPreview, renderMarkdown } from './markdown.js';
import { Client, Databases, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_POSTS,
    COLLECTION_USERS,
    DATABASE_ID,
    decryptText,
    escapeHtml,
    formatTime,
    getPostAuthorDisplay,
    loadUserDirectory,
    renderAuthorAvatar,
    restoreSecureKey
} from './shared.js';

// 初始化 Appwrite
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

// ========== 全局状态 ==========
let currentUser = null;
let currentBoard = { $id: 'main', name: '主板块' };
let currentTimeFilter = 'all'; // 存储当前选中的时间：all, today, week, month
let currentPage = 1;
let totalPages = 1;
const PAGE_SIZE = 10;

// 🌟 全局实名用户内存高速缓存字典
let userCache = {}; 
let allUsers = null;
let selectedUserIds = new Set(); 

// DOM 元素
const postsList = document.getElementById('postsList');
const pagination = document.getElementById('pagination');
const currentBoardName = document.getElementById('currentBoardName');
const boardMemberCount = document.getElementById('boardMemberCount');
const joinBoardBtn = document.getElementById('joinBoardBtn');
const newPostBtn = document.getElementById('newPostBtn');
const postModal = document.getElementById('postModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelPostBtn = document.getElementById('cancelPostBtn');
const submitPostBtn = document.getElementById('submitPostBtn');
const postTitle = document.getElementById('postTitle');
const postContent = document.getElementById('postContent');
const postBoardSelect = document.getElementById('postBoardSelect');

// ========== ⚡ 初始化生命周期调整 ==========
document.addEventListener('DOMContentLoaded', async () => {

    await restoreSecureKey();
    checkLoginStatus();
    await loadBoards();
    // 让全量用户快照提前注入内存缓存，确保渲染时有据可查
    await loadAllUsers(); 
    await loadPosts(); 
    bindEvents();
    openRequestedPostModal();
});
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
            
        } catch (e) {
            currentUser = null;
        }
    } else {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
    }
}
// ========== 加载板块基础数据 ==========
async function loadBoards() {
    try {
        if (currentBoard.$id === 'main') {
            if (currentBoardName) currentBoardName.textContent = '';
            if (boardMemberCount) boardMemberCount.textContent = '';
        }

        if (currentUser && currentBoard.$id !== 'main') {
            try {
                const userDoc = await databases.getDocument(DATABASE_ID, COLLECTION_USERS, currentUser.studentId);
                const isJoined = userDoc.joinedBoards?.includes(currentBoard.$id);
                if (joinBoardBtn) joinBoardBtn.style.display = isJoined ? 'none' : 'inline-block';
            } catch (e) {
                if (joinBoardBtn) joinBoardBtn.style.display = 'none';
            }
        } else {
            if (joinBoardBtn) joinBoardBtn.style.display = 'none';
        }
        
    } catch (error) {
        console.error('加载板块基础数据失败:', error);
    }
}

// ========== 在列表顶部插入通知提示 ==========
function showCacheNotice(message, type = 'waiting') {
    if (!postsList) return;
    document.getElementById('cacheNoticeBar')?.remove();

    const noticeEl = document.createElement('div');
    noticeEl.id = 'cacheNoticeBar';
    noticeEl.className = `cache-notice-bar ${type}`;
    noticeEl.innerHTML = message;
    
    postsList.insertBefore(noticeEl, postsList.firstChild);

    if (type === 'success') {
        setTimeout(() => {
            noticeEl.style.opacity = '0';
            noticeEl.style.transform = 'translateY(-10px)';
            setTimeout(() => noticeEl.remove(), 400);
        }, 2500);
    }
}

// ========== 1. 全量用户装载（安全合规版） ==========
async function loadAllUsers() {
    try {
        const directory = await loadUserDirectory(databases, Query);
        userCache = directory.userCache;
        allUsers = directory.allUsers;
        console.log("🎯 内存字典当前全量钥匙箱:", userCache);
    } catch (e) {
        console.error('❌ 全局用户身份快照彻底崩塌，原因:', e.message);
    }
}

// ========== 加载帖子（安全增强版） ==========
async function loadPosts() {
    try {
        if (!postsList) return;
        
        const currentUserId = currentUser?.studentId || 'guest';
        const cacheKey = `cache_posts_${currentUserId}_${currentBoard.$id}_${currentTimeFilter}_p${currentPage}`;
        const localCache = localStorage.getItem(cacheKey);

        let hasRenderedCache = false;

        if (localCache) {
            try {
                const parsedCache = JSON.parse(localCache);
                if (parsedCache && Array.isArray(parsedCache.data)) {
                    renderPosts(parsedCache.data);
                    totalPages = parsedCache.totalPages || 1;
                    renderPagination();
                    showCacheNotice('正在展示本地缓存，正在同步云端最新内容...', 'waiting');
                    hasRenderedCache = true;
                }
            } catch (err) {
                console.warn('解析本地缓存异常:', err);
            }
        }

        if (!hasRenderedCache) {
            postsList.innerHTML = '<div class="loading-state">正在从云端安全拉取数据...</div>';
        }

        const queries = [
            Query.equal('boardId', currentBoard.$id),
            Query.limit(100),  
            Query.orderDesc('$createdAt')
        ];
        
        if (currentPage > 1) {
            queries.push(Query.offset((currentPage - 1) * PAGE_SIZE));
        }

        let hotPosts = [];
        try {
            const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, queries);
            hotPosts = response.documents;
        } catch (e) {
            console.warn('热数据加载失败，仅显示冷备份:', e.message);
        }

        let coldPosts = [];
        try {
            const url = `./public/data-backups/posts.json`;
            const backupRes = await fetch(url);
            if (backupRes.ok) {
                const backupData = await backupRes.json();
                let docs = backupData.documents || backupData || [];
                
                if (backupData.encrypted) {
                    docs = await Promise.all(docs.map(async post => {
                        let targetGroups = [];
                        if (post.targetGroups !== '已隐藏') {
                            const decrypted = await decryptText(post.targetGroups);
                            try {
                                targetGroups = JSON.parse(decrypted || '[]');
                            } catch {
                                targetGroups = [];
                            }
                        }
                        return {
                            ...post,
                            content: await decryptText(post.content),
                            title: await decryptText(post.title),
                            authorName: await decryptText(post.authorName),
                            targetGroups: targetGroups
                        };
                    }));
                }
                coldPosts = docs;
            }
        } catch (e) {
            console.log('无冷备份数据', e);
        }

        const normalizePost = (post, isCold) => {
            return {
                $id: post.$id || post.id,
                $createdAt: post.$createdAt || post.createdAt,
                $updatedAt: post.$updatedAt || post.updatedAt,
                title: post.title,
                content: post.content,
                authorId: post.authorId,
                authorName: post.authorName,
                boardId: post.boardId,
                viewPermission: post.viewPermission,
                targetGroups: post.targetGroups || [],
                status: post.status || 0,
                _isCold: isCold
            };
        };

        const normalizedHot = hotPosts.map(p => normalizePost(p, false));
        const normalizedCold = coldPosts.map(p => normalizePost(p, true));

        const seen = new Set();
        const allPosts = [...normalizedHot, ...normalizedCold].filter(post => {
            if (seen.has(post.$id)) return false;
            seen.add(post.$id);
            return true;
        });

        allPosts.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));

        let filteredPosts = allPosts;
        if (currentTimeFilter !== 'all') {
            const now = new Date();
            let startTime = new Date();

            if (currentTimeFilter === 'today') {
                startTime.setHours(0, 0, 0, 0);
            } else if (currentTimeFilter === 'week') {
                startTime.setDate(now.getDate() - 7);
            } else if (currentTimeFilter === 'month') {
                startTime.setDate(now.getDate() - 30);
            }

            filteredPosts = allPosts.filter(post => 
                new Date(post.$createdAt) >= startTime
            );
        }

        const visiblePosts = filteredPosts.filter(post => {
            if (post.title === null || post.content === null) return false;
            const viewPermission = Number(post.viewPermission) || 1;
            const isAuthor = currentUser && currentUser.studentId && post.authorId && (post.authorId === currentUserId);
            
            if (viewPermission === 1) return true;  
            if (viewPermission === 8) return isAuthor; 
            if (viewPermission === 4) {             
                if (!currentUserId || currentUserId === 'guest') return false;
                return (post.targetGroups || []).includes(currentUserId);
            }
            return false;
        });

        const start = (currentPage - 1) * PAGE_SIZE;
        const paged = visiblePosts.slice(start, start + PAGE_SIZE);
        totalPages = Math.ceil(visiblePosts.length / PAGE_SIZE) || 1;

        renderPosts(paged);
        renderPagination();

        localStorage.setItem(cacheKey, JSON.stringify({
            data: paged,
            totalPages: totalPages,
            updateAt: Date.now()
        }));

        if (hasRenderedCache) {
            showCacheNotice('列表已成功同步至云端最新内容', 'success');
        }

    } catch (error) {
        console.error('加载最新数据失败:', error);
        const currentUserId = currentUser?.studentId || 'guest';
        if (!localStorage.getItem(`cache_posts_${currentUserId}_${currentBoard.$id}_${currentTimeFilter}_p${currentPage}`)) {
            postsList.innerHTML = `<div class="empty-state"><p>同步失败，请检查网络</p></div>`;
        }
    }
}

// ========== 🌟 智能化改写：不信任数据源渲染 ==========
function renderPosts(posts) {
    if (!postsList) return;
    if (!posts.length) {
        postsList.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><p>暂无帖子...</p></div>`;
        return;
    }
    
    postsList.innerHTML = posts.map(post => {
        const postId = post.$id || post.id;
        const postCreatedAt = post.$createdAt || post.createdAt;
        
        const isPinned = post.status ? (post.status & 1) !== 0 : false;
        const isLocked = post.status ? (post.status & 2) !== 0 : false;
        const createdAt = new Date(postCreatedAt);
        const timeStr = formatTime(createdAt);

        const author = getPostAuthorDisplay(post, userCache);
        const avatarHtml = renderAuthorAvatar(author, 40);
        
        return `
            <div class="post-card ${isPinned ? 'pinned' : ''}" data-post-id="${postId}">
                <div class="post-header">
                    <div class="post-avatar" style="width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: #e0e0e0; flex-shrink: 0;">
                        ${avatarHtml}
                    </div>
                    <div class="post-author-info">
                        <div class="post-author">${escapeHtml(author.name)}</div>
                        <div class="post-meta">
                            <span>${timeStr}</span>
                            ${isPinned ? '<span class="post-badge pinned-badge">置顶</span>' : ''}
                            ${isLocked ? '<span class="post-badge locked-badge">已锁定</span>' : ''}
                        </div>
                    </div>
                </div>
                <div class="post-title">${escapeHtml(post.title || '无标题')}</div>
                <div class="post-content-preview">${escapeHtml(markdownToPreview(post.content, 150))}</div>
                <div class="post-footer">
                    <span class="post-stat"> 0</span>
                    <span class="post-stat"> 0</span>
                    <span class="post-stat"> 0</span>
                </div>
            </div>
        `;
    }).join('');
    
    document.querySelectorAll('.post-card').forEach(card => {
        card.addEventListener('click', () => openPostDetail(card.dataset.postId));
    });
}

// ========== 分页 ==========
function renderPagination() {
    if (!pagination) return;
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="prev">←</button>`;
    
    for (let i = 1; i <= Math.min(totalPages, 5); i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    if (totalPages > 5) {
        html += `<span class="page-ellipsis">...</span>`;
        html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }
    
    html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="next">→</button>`;
    
    pagination.innerHTML = html;
    
    pagination.querySelectorAll('.page-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const page = e.target.dataset.page;
            if (page === 'prev' && currentPage > 1) {
                currentPage--;
            } else if (page === 'next' && currentPage < totalPages) {
                currentPage++;
            } else if (!isNaN(page)) {
                currentPage = parseInt(page);
            } else {
                return;
            }
            loadPosts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// ========== 🌟 刚性阻塞防御版：发帖 ==========
async function submitPost() {
    // 🔒 入口熔断锁：如果按钮已经处于 disabled 状态，直接拦截后续所有点击操作
    if (submitPostBtn && submitPostBtn.disabled) {
        console.warn("⚠️ 拦截到重复发帖请求，当前发帖操作正在同步云端...");
        return;
    }

    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }
    
    const title = postTitle.value.trim();
    const content = postContent.value.trim();
    const visibilityType = document.getElementById('visibilityType').value;
    
    if (!title) {
        alert('请输入标题');
        return;
    }
    if (!content) {
        alert('请输入内容');
        return;
    }
    
    let viewPermission = 1; 
    let targetUsers = [];
    
    if (visibilityType === 'specific') {
        if (selectedUserIds.size === 0) {
            alert('请至少添加一个可见用户');
            return;
        }
        viewPermission = 4; 
        targetUsers = Array.from(selectedUserIds);
    }
    
    // 🔒 通过同步表单校验后，立即将发布按钮锁死，文字替换为加载状态
    if (submitPostBtn) {
        submitPostBtn.disabled = true;
        submitPostBtn.textContent = '正在同步云端...';
    }

    const user = JSON.parse(localStorage.getItem('campus_user'));
    
    try {
        const response = await fetch('/api/create-post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: `student_${user.studentId}`,
                boardId: currentBoard.$id,
                title,
                content,
                viewPermission,
                targetUsers
            })
        });
        
        if (response.ok) {
            alert('发布成功！');
            const currentUserId = currentUser?.studentId || 'guest';
            localStorage.removeItem(`cache_posts_${currentUserId}_${currentBoard.$id}_${currentTimeFilter}_p1`);
            
            selectedUserIds.clear();
            renderSelectedUsers();
            closeModal();
            currentPage = 1;
            loadPosts();
        } else {
            const result = await response.json();
            alert(result.error || '发布失败');
        }
    } catch (err) {
        console.error(err);
        alert('网络错误，请稍后重试');
    } finally {
        // 🔓 无论云端处理成功，还是捕获到网络故障引发中断，最终都必须释放锁，让按钮恢复可用
        if (submitPostBtn) {
            submitPostBtn.disabled = false;
            submitPostBtn.textContent = '发 布';
        }
    }
}

// ========== 发帖弹窗控制 ==========
function openModal() {
    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }
    
    if (postBoardSelect) {
        postBoardSelect.innerHTML = `<option value="main" selected>主板块</option>`;
    }
    
    if (postModal) postModal.style.display = 'flex';
    if (postTitle) postTitle.value = '';
    if (postContent) postContent.value = '';
    
    selectedUserIds.clear(); 
    renderSelectedUsers();   
    
    const visibilityTypeEl = document.getElementById('visibilityType');
    if (visibilityTypeEl) visibilityTypeEl.value = 'all';
    
    const specificUsersArea = document.getElementById('specificUsersArea');
    if (specificUsersArea) specificUsersArea.style.display = 'none';

    resetPostPreviewState();
}

function closeModal() {
    closePostMobilePreview();
    if (postModal) postModal.style.display = 'none';
}

function openPostDetail(postId) {
    location.href = `post.html?id=${postId}`;
}

// ========== 事件绑定 ==========
function openRequestedPostModal() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1' && params.get('action') !== 'new') return;

    window.history.replaceState(null, '', window.location.pathname);
    openModal();
}

function bindEvents() {
    if (newPostBtn) newPostBtn.addEventListener('click', openModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (cancelPostBtn) cancelPostBtn.addEventListener('click', closeModal);
    if (submitPostBtn) submitPostBtn.addEventListener('click', submitPost);
    
    if (postModal) {
        postModal.addEventListener('click', (e) => {
            if (e.target === postModal) closeModal();
        });
    }
    
    const timeFilter = document.getElementById('timeFilter');
    if (timeFilter) {
        timeFilter.addEventListener('change', (e) => {
            currentTimeFilter = e.target.value; 
            currentPage = 1; 
            loadPosts(); 
        });
    }
    postTitle?.addEventListener('input', updatePostPreview);
    postContent?.addEventListener('input', updatePostPreview);
    document.getElementById('togglePostPreviewBtn')?.addEventListener('click', togglePostPreview);

    document.getElementById('postPreviewPane')?.addEventListener('click', (e) => {
        const backBtn = e.target.closest('[data-preview-back]');
        if (!backBtn) return;
        e.preventDefault();
        closePostMobilePreview();
    });
}

// ========== 可见范围管理时间监听 ==========
const visibilityTypeEl = document.getElementById('visibilityType');
if (visibilityTypeEl) {
    visibilityTypeEl.addEventListener('change', function() {
        const specificArea = document.getElementById('specificUsersArea');
        if (specificArea) {
            specificArea.style.display = this.value === 'specific' ? 'block' : 'none';
        }
    });
}

const searchUserBtn = document.getElementById('searchUserBtn');
if (searchUserBtn) searchUserBtn.addEventListener('click', searchUsers);

const userSearchInput = document.getElementById('userSearchInput');
if (userSearchInput) {
    userSearchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchUsers();
    });
}

async function searchUsers() {
    const searchInput = document.getElementById('userSearchInput');
    const resultsContainer = document.getElementById('searchResults');
    if (!searchInput || !resultsContainer) return;

    const keyword = searchInput.value.trim();
    if (!keyword) {
        resultsContainer.style.display = 'none';
        return;
    }

    if (!allUsers) {
        await loadAllUsers();
    }

    const matched = (allUsers || []).filter(u => u.studentId.includes(keyword));
    
    if (matched.length > 0) {
        resultsContainer.innerHTML = matched.map(user => {
            const isAdded = selectedUserIds.has(user.studentId);
            return `
                <div class="search-result-item">
                    <div class="user-info">
                        <div class="user-avatar-small">${user.studentId.charAt(0)}</div>
                        <span class="user-student-id">${user.studentId}</span>
                    </div>
                    <button class="add-user-btn ${isAdded ? 'added' : ''}" 
                            data-student-id="${user.studentId}"
                            ${isAdded ? 'disabled' : ''}>
                        ${isAdded ? '已添加' : '+ 添加'}
                    </button>
                </div>
            `;
        }).join('');
        
        resultsContainer.querySelectorAll('.add-user-btn:not(.added)').forEach(btn => {
            btn.addEventListener('click', function() {
                addUser(this.dataset.studentId);
            });
        });
    } else {
        resultsContainer.innerHTML = '<div class="search-empty">未找到该学号的用户</div>';
    }
    
    resultsContainer.style.display = 'block';
}

function addUser(studentId) {
    selectedUserIds.add(studentId);
    renderSelectedUsers();
    const resultsContainer = document.getElementById('searchResults');
    const searchInput = document.getElementById('userSearchInput');
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (searchInput) searchInput.value = '';
}

function removeUser(studentId) {
    selectedUserIds.delete(studentId);
    renderSelectedUsers();
}

function renderSelectedUsers() {
    const container = document.getElementById('selectedUsers');
    const countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = selectedUserIds.size;
    if (!container) return;
    
    if (selectedUserIds.size === 0) {
        container.innerHTML = '<div class="no-users-hint">尚未添加用户</div>';
        return;
    }
    
    container.innerHTML = Array.from(selectedUserIds).map(studentId => `
        <span class="user-tag">
            ${studentId}
            <span class="remove-tag" data-student-id="${studentId}">&times;</span>
        </span>
    `).join('');
    
    container.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', function() {
            removeUser(this.dataset.studentId);
        });
    });
}
// for update

function updatePostPreview() {
    const title = postTitle?.value || '';
    const content = postContent?.value || '';
    const pane = document.getElementById('postPreviewPane');
    if (!pane) return;

    pane.innerHTML = `
        <button type="button" class="mobile-preview-back" data-preview-back>返回编辑</button>
        <article class="preview-document">
            <h1>${escapeHtml(title || '无标题')}</h1>
            ${renderMarkdown(content || '*暂无内容*')}
        </article>
    `;
}

function resetPostPreviewState() {
    const pane = document.getElementById('postPreviewPane');
    const layout = pane?.closest('.editor-layout');

    pane?.classList.remove('mobile-preview-open', 'preview-hidden');
    layout?.classList.remove('preview-closed');
    updatePostPreview();
}

function closePostMobilePreview() {
    document.getElementById('postPreviewPane')?.classList.remove('mobile-preview-open');
}

function togglePostPreview() {
    const pane = document.getElementById('postPreviewPane');
    const layout = pane?.closest('.editor-layout');
    if (!pane || !layout) return;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    updatePostPreview();

    if (isMobile) {
        pane.classList.add('mobile-preview-open');
    } else {
        pane.classList.toggle('preview-hidden');
        layout.classList.toggle('preview-closed');
    }
}
