// js/posts.js
// Made by BearThomas 2026/5/31
import { markdownToPreview, renderMarkdown } from './markdown.js';
import { createListSkeleton, scheduleAfterPaint, setupPullToRefresh } from './feed-experience.js';
import { Client, Databases, Query } from './d1-appwrite-compat.js';
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
    normalizeUserId,
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
let secureKeyReady = Promise.resolve(null);
let currentBoard = { $id: 'main', name: '主板块' };
let currentTimeFilter = 'all';
let currentSearchKeyword = '';
const searchInput = document.getElementById('searchInput'); // 存储当前选中的时间：all, today, week, month
let currentPage = 1;
let totalPages = 1;
const PAGE_SIZE = 10;

// 🌟 全局实名用户内存高速缓存字典
let userCache = {}; 
let allUsers = null;
let selectedUserIds = new Set(); 
let postsSnapshot = [];


// Custom Boards cache
let customBoards = [];
window.customBoardsCache = {};

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
const postBoardCheckboxes = document.getElementById('postBoardCheckboxes');

// ========== ⚡ 初始化生命周期调整 ==========
document.addEventListener('DOMContentLoaded', async () => {

    secureKeyReady = restoreSecureKey();
    checkLoginStatus();
    fetchAndApplyCacheVersion().catch(() => {});
    await loadBoards();
    // 用户资料和帖子流并行加载，避免用户名片查询阻塞首屏内容。
    await Promise.all([loadAllUsers(), loadPosts()]);
    if (postsSnapshot.length) renderPostsSnapshotPage();
    bindEvents();
    openRequestedPostModal();
    setupPullToRefresh({
        onRefresh: async () => {
            currentPage = 1;
            await Promise.all([loadAllUsers(), loadPosts({ forceRefresh: true })]);
            if (postsSnapshot.length) renderPostsSnapshotPage();
        }
    });
});
// ========== 登录状态 ==========
function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    if (userData) {
        try {
            currentUser = JSON.parse(userData);
            if (currentUser.authVersion !== 2) {
                localStorage.removeItem('campus_user');
                currentUser = null;
            }
        } catch (e) {
            currentUser = null;
        }
    }
}
// ========== 加载板块基础数据 ==========
async function loadBoards() {
    try {
        updateJoinButtonState();
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
        
    } catch (e) {
        console.error('❌ 全局用户身份快照彻底崩塌，原因:', e.message);
    }
}

async function listAllPostDocuments(baseQueries, onFirstBatch) {
    const documents = [];
    let offset = 0;
    const batchSize = 100;

    while (true) {
        const pageQueries = [...baseQueries, Query.limit(batchSize)];
        if (offset > 0) pageQueries.push(Query.offset(offset));

        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, pageQueries);
        const batch = response.documents || [];
        documents.push(...batch);
        if (offset === 0 && onFirstBatch) onFirstBatch(batch);

        if (batch.length < batchSize || documents.length >= Number(response.total || 0)) break;
        offset += batch.length;
    }

    return documents;
}

// Fetch cold backup hashes + pending mods from D1
let serverHashes = { posts: null, comments: null, confessions: null };
let pendingModifications = [];
let tombstonedIds = { posts: new Set(), comments: new Set(), confessions: new Set() };

async function fetchAndApplyCacheVersion() {
    try {
        const res = await fetch('/api/mod-log');
        if (!res.ok) return;
        const data = await res.json();
        serverHashes = data.hashes || {};
        pendingModifications = data.pendingModifications || [];
        
        const deletedPosts = pendingModifications.filter(m => m.collection === 'posts' && m.action === 'delete').map(m => m.item_id);
        const deletedComments = pendingModifications.filter(m => m.collection === 'comments' && m.action === 'delete').map(m => m.item_id);
        const deletedConfessions = pendingModifications.filter(m => m.collection === 'confessions' && m.action === 'delete').map(m => m.item_id);
        
        tombstonedIds = {
            posts:       new Set(deletedPosts),
            comments:    new Set(deletedComments),
            confessions: new Set(deletedConfessions)
        };
    } catch (e) {
        console.warn('获取缓存版本失败（不影响主流程）:', e.message);
    }
}

async function fetchWithHashCache(collection, urls) {
    const serverHash = serverHashes[collection];
    const cacheKeyData = `cache_data_${collection}`;
    const cacheKeyHash = `cache_hash_${collection}`;
    
    if (serverHash) {
        const localHash = localStorage.getItem(cacheKeyHash);
        if (localHash === serverHash) {
            const cachedData = localStorage.getItem(cacheKeyData);
            if (cachedData) {
                try {
                    return JSON.parse(cachedData);
                } catch (e) {}
            }
        }
    }
    
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            
            if (serverHash) {
                try {
                    localStorage.setItem(cacheKeyData, JSON.stringify(data));
                    localStorage.setItem(cacheKeyHash, serverHash);
                } catch (e) { }
            }
            return data;
        } catch (e) { continue; }
    }
    throw new Error(`无法获取 ${collection} 数据`);
}

async function fetchChunkWithCache(collection, filename, chunkHash) {
    const cacheKeyData = `cache_data_${collection}_${filename}`;
    const cacheKeyHash = `cache_hash_${collection}_${filename}`;
    
    if (chunkHash) {
        if (localStorage.getItem(cacheKeyHash) === chunkHash) {
            try { return JSON.parse(localStorage.getItem(cacheKeyData)); } catch(e) {}
        }
    }
    
    try {
        const res = await fetch(`./public/data-backups/${collection}/${filename}`);
        if (!res.ok) return [];
        const data = await res.json();
        
        if (chunkHash) {
            try {
                localStorage.setItem(cacheKeyData, JSON.stringify(data));
                localStorage.setItem(cacheKeyHash, chunkHash);
            } catch(e) {}
        }
        return data;
    } catch(e) {
        return [];
    }
}

async function loadChunkedCollection(collection) {
    try {
        const index = await fetchWithHashCache(collection, [`./public/data-backups/${collection}/index.json`]);
        if (!index || !index.chunks) throw new Error('No index');
        
        const promises = index.chunks.map(chunk => {
            return fetchChunkWithCache(collection, chunk.file, chunk.hash);
        });
        
        const arrays = await Promise.all(promises);
        let docs = arrays.flat();
        return applyPendingModifications(collection, docs);
    } catch(e) {
        try {
            const old = await fetchWithHashCache(collection, [`./public/data-backups/${collection}.json`, `./public/data-fallback/${collection}.json`]);
            return applyPendingModifications(collection, old.documents || old || []);
        } catch(e2) {
            return [];
        }
    }
}

function applyPendingModifications(collection, documents) {
    if (!documents || !Array.isArray(documents)) return documents;
    let modified = [...documents];
    const mods = pendingModifications.filter(m => m.collection === collection);
    
    for (const mod of mods) {
        const idx = modified.findIndex(doc => (doc.id === mod.item_id || doc.$id === mod.item_id));
        if (idx !== -1) {
            if (mod.action === 'delete') {
                modified.splice(idx, 1);
            } else if (mod.action === 'edit' && mod.payload) {
                modified[idx] = { ...modified[idx], ...mod.payload };
            }
        }
    }
    return modified;
}


// ========== 瀑布流懒加载与按需加载支持 ==========
let pendingChunks = [];
let loadedColdPostsMap = new Map();
let currentPostsPool = [];
let allHotPosts = [];
let coldIndex = null;
let searchIndex = null;
let infiniteObserver = null;
let isFetchingChunk = false;
let noMoreData = false;

// 按需清理缓存的查询状态
function resetPostsState() {
    pendingChunks = [];
    loadedColdPostsMap.clear();
    currentPostsPool = [];
    allHotPosts = [];
    noMoreData = false;
}

// ========== 加载帖子（安全增强版） ==========
async function loadPosts({ forceRefresh = false } = {}) {
    try {
        if (!postsList) return;
        
        if (forceRefresh) {
            postsList.innerHTML = createListSkeleton('post', 5);
            resetPostsState();
        }

        // 初始化元数据
        if (!coldIndex) {
            try { coldIndex = await fetchWithHashCache('posts', ['./public/data-backups/posts/index.json']); } catch(e){}
        }
        if (!searchIndex) {
            try { searchIndex = await fetchWithHashCache('posts_search', ['./public/data-backups/posts/search-index.json']); } catch(e){}
        }

        // 1. 并发获取最新热数据
        const queries = [ Query.orderDesc('$createdAt') ];
        allHotPosts = await listAllPostDocuments(queries, firstBatch => {});

        // 2. 准备懒加载队列（如果冷备存在）
        if (coldIndex && coldIndex.chunks) {
            pendingChunks = coldIndex.chunks.map(c => c.file);
        }

        recomputePostsPool();
        initInfiniteScroll();

    } catch (error) {
        console.error('加载最新数据失败:', error);
        postsList.innerHTML = `<div class="empty-state"><p>同步失败，请检查网络</p></div>`;
    }
}

function recomputePostsPool() {
    const currentUserId = currentUser?.studentId || 'guest';
    
    const normalizePost = (p, isCold) => ({
        ...p,
        $id: p.$id || p.id,
        $createdAt: p.$createdAt || p.created_at || p.createdAt,
        title: p.title,
        content: p.content,
        boardId: p.boardId || p.board_id,
        authorId: p.authorId || p.author_id,
        authorName: p.authorName || p.author_name,
        targetGroups: typeof p.targetGroups === 'string' ? JSON.parse(p.targetGroups) : (p.targetGroups || []),
        status: p.status || 0,
        viewPermission: p.viewPermission,
        _isCold: isCold
    });

    const filterFn = (post) => {
        if (tombstonedIds.posts.has(post.$id)) return false;
        const postBoard = post.boardId || 'main';
        if (postBoard !== currentBoard.$id) return false;
        
        // time filter
        if (currentTimeFilter !== 'all') {
            const now = new Date();
            let startTime = new Date();
            if (currentTimeFilter === 'today') startTime.setHours(0,0,0,0);
            else if (currentTimeFilter === 'week') startTime.setDate(now.getDate()-7);
            else if (currentTimeFilter === 'month') startTime.setDate(now.getDate()-30);
            if (new Date(post.$createdAt) < startTime) return false;
        }

        // search filter
        if (currentSearchKeyword) {
            const kw = currentSearchKeyword.toLowerCase();
            const titleMatch = post.title && post.title.toLowerCase().includes(kw);
            const authorMatch = post.authorName && post.authorName.toLowerCase().includes(kw);
            const contentMatch = post.content && post.content.toLowerCase().includes(kw);
            if (!titleMatch && !authorMatch && !contentMatch) return false;
        }

        // permission filter
        const viewPermission = Number(post.viewPermission) || 1;
        if (viewPermission === 8) {
            const isAuthor = currentUser && normalizeUserId(post.authorId) === normalizeUserId(currentUserId);
            if (!isAuthor) return false;
        }
        if (viewPermission === 4) {
            if (currentUserId === 'guest') return false;
            if (!(post.targetGroups || []).includes(currentUserId)) return false;
        }
        
        return true;
    };
    
    let pool = [];
    pool.push(...allHotPosts.map(p => normalizePost(p, false)).filter(filterFn));
    
    // 动态调整 lazy load 的 chunks：如果正在搜索，且有 searchIndex，则只捞取命中的 chunks
    if (currentSearchKeyword && searchIndex && coldIndex && coldIndex.chunks) {
        const kw = currentSearchKeyword.toLowerCase();
        const hitChunks = new Set();
        for (const meta of searchIndex) {
            if (meta.title && meta.title.toLowerCase().includes(kw) || 
                meta.authorName && meta.authorName.toLowerCase().includes(kw)) {
                hitChunks.add('chunk-' + meta.c + '.json');
            }
        }
        // 更新尚未加载的 chunks（剔除没命中的）
        pendingChunks = pendingChunks.filter(file => hitChunks.has(file));
    }
    
    for (const chunk of loadedColdPostsMap.values()) {
        pool.push(...chunk.map(p => normalizePost(p, true)).filter(filterFn));
    }
    
    pool = applyPendingModifications('posts', pool);
    pool.sort((a,b) => new Date(b.$createdAt) - new Date(a.$createdAt));
    
    currentPostsPool = pool;
    renderPosts(currentPostsPool);
}

function initInfiniteScroll() {
    const anchor = document.getElementById('infiniteScrollAnchor');
    if (!anchor) return;
    
    if (infiniteObserver) infiniteObserver.disconnect();
    
    infiniteObserver = new IntersectionObserver(async (entries) => {
        if (entries[0].isIntersecting && !isFetchingChunk && !noMoreData) {
            await loadNextChunk();
        }
    }, { rootMargin: '400px' }); // 提前 400px 触发
    
    infiniteObserver.observe(anchor);
}

async function loadNextChunk() {
    const anchor = document.getElementById('infiniteScrollAnchor');
    
    if (pendingChunks.length === 0) {
        noMoreData = true;
        if (anchor) anchor.innerHTML = '<span style="font-size: 0.9rem; margin-top: 10px;">没有更多帖子了...</span>';
        return;
    }
    
    isFetchingChunk = true;
    if (anchor) anchor.innerHTML = '<span class="feed-initial-orbit" style="width:16px;height:16px;border-width:2px;"></span><span style="margin-left: 8px;">加载历史档案...</span>';
    
    const chunkFile = pendingChunks.shift();
    try {
        const chunkObj = coldIndex && coldIndex.chunks ? coldIndex.chunks.find(c => c.file === chunkFile) : null;
        let chunkData = await fetchChunkWithCache('posts', chunkFile, chunkObj ? chunkObj.hash : null);
        loadedColdPostsMap.set(chunkFile, chunkData);
        recomputePostsPool();
    } catch(e) {
        console.warn('获取区块失败', chunkFile, e);
    }
    
    isFetchingChunk = false;
    if (anchor && !noMoreData) anchor.innerHTML = ''; 
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
                        <div class="post-author" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${author.name}</div>
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
                    <span class="post-stat" style="display:flex; align-items:center; gap:4px; color: var(--text-secondary);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-heart-fill" viewBox="0 0 16 16" style="color: #ef4444;">
                          <path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/>
                        </svg>
                        ${post.likes || 0}
                    </span>
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
            if (postsSnapshot.length) {
                renderPostsSnapshotPage();
            } else {
                loadPosts();
            }
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
    
    const boardIds = ['main'];
    
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
                sessionSecret: user.token || '',
                appToken: user.appToken || '',
                boardIds, // Multi-board posting array
                title,
                content,
                viewPermission,
                targetUsers
            })
        });
        
        if (response.ok) {
            alert('发布成功！');
            const currentUserId = currentUser?.studentId || 'guest';
            localStorage.removeItem(`cache_posts_v2_${currentUserId}_${currentBoard.$id}_${currentTimeFilter}_p1`);
            
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
    
    if (postBoardCheckboxes) {
        renderPostBoardCheckboxes();
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
    
    // Custom Board Events
    document.getElementById('createBoardBtn')?.addEventListener('click', openCreateBoardModal);
    document.getElementById('closeBoardModal')?.addEventListener('click', closeCreateBoardModal);
    document.getElementById('cancelBoardBtn')?.addEventListener('click', closeCreateBoardModal);
    document.getElementById('submitBoardBtn')?.addEventListener('click', submitCreateBoard);
    if (joinBoardBtn) joinBoardBtn.addEventListener('click', handleJoinLeaveClick);
    
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
    
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                currentSearchKeyword = searchInput.value.trim();
                currentPage = 1;
                loadPosts();
            }
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

// ========== Custom Boards Management Logic ==========
async function fetchCustomBoards() {
    try {
        const res = await fetch('/api/board');
        if (res.ok) {
            const data = await res.json();
            customBoards = data.boards || [];
            window.customBoardsCache = {};
            for (const b of customBoards) {
                window.customBoardsCache[b.id] = b;
            }
        }
    } catch (e) {
        console.warn('获取自定义板块失败:', e);
    }
}

function renderBoardsSidebar() {
    const container = document.getElementById('boardsListContainer');
    if (!container) return;

    const joinedSet = new Set(currentUser ? (currentUser.joinedBoards || currentUser.profile?.joinedBoards || []) : ['main']);
    joinedSet.add('main');

    const classBoardId = currentUser?.studentId && /^\d{6,12}$/.test(currentUser.studentId)
        ? `class_${currentUser.studentId.slice(0, 4)}_${currentUser.studentId.slice(4, 6)}`
        : null;
    if (classBoardId) joinedSet.add(classBoardId);

    let html = '';
    
    // 1. Main Board
    const mainActive = currentBoard.$id === 'main' ? 'active' : '';
    html += `
        <div class="board-item ${mainActive}" data-board-id="main">
            <span class="board-icon">🏠</span>
            <span class="board-name">主板块</span>
        </div>
    `;

    // 2. Class Board (if any)
    if (classBoardId) {
        const classActive = currentBoard.$id === classBoardId ? 'active' : '';
        const className = `${currentUser.studentId.slice(0, 4)}届${currentUser.studentId.slice(4, 6)}班`;
        html += `
            <div class="board-item ${classActive}" data-board-id="${classBoardId}">
                <span class="board-icon">🎓</span>
                <span class="board-name">${className}</span>
            </div>
        `;
    }

    // 3. Custom Boards
    for (const b of customBoards) {
        const isJoined = joinedSet.has(b.id);
        const active = currentBoard.$id === b.id ? 'active' : '';
        html += `
            <div class="board-item ${active}" data-board-id="${b.id}">
                <span class="board-icon">💬</span>
                <span class="board-name">${escapeHtml(b.name)}</span>
                ${isJoined ? '' : '<span style="font-size:10px; color:#94a3b8; margin-left:4px;">未加入</span>'}
            </div>
        `;
    }

    // 4. Mobile Create Board entry at the bottom of the list
    if (currentUser) {
        html += `
            <div class="board-item create-board-trigger-item" style="border: 1px dashed #3b82f6; background: rgba(59, 130, 246, 0.05); margin-top: 10px;">
                <span class="board-icon" style="color:#3b82f6;">➕</span>
                <span class="board-name" style="color:#3b82f6; font-weight:600;">新建板块</span>
            </div>
        `;
    }

    container.innerHTML = html;

    container.querySelectorAll('.board-item:not(.create-board-trigger-item)').forEach(el => {
        el.addEventListener('click', () => {
            const boardId = el.getAttribute('data-board-id');
            switchBoard(boardId);
        });
    });

    container.querySelector('.create-board-trigger-item')?.addEventListener('click', openCreateBoardModal);
}

async function switchBoard(boardId) {
    if (currentBoard.$id === boardId) return;

    if (boardId === 'main') {
        currentBoard = { $id: 'main', name: '主板块' };
    } else if (boardId.startsWith('class_')) {
        const match = boardId.match(/^class_(\d{4})_(\d+)$/);
        const name = match ? `${match[1]}届${match[2]}班` : boardId;
        currentBoard = { $id: boardId, name };
    } else {
        const b = customBoards.find(x => x.id === boardId);
        currentBoard = { $id: boardId, name: b ? b.name : boardId, _custom: b };
    }

    if (currentBoardName) {
        currentBoardName.textContent = currentBoard.name;
    }
    if (boardMemberCount) {
        if (currentBoard.$id === 'main') {
            boardMemberCount.textContent = '';
        } else if (currentBoard._custom) {
            boardMemberCount.textContent = `${currentBoard._custom.memberCount} 成员`;
        } else {
            boardMemberCount.textContent = '';
        }
    }

    updateJoinButtonState();
    currentPage = 1;
    renderBoardsSidebar();
    await loadPosts({ forceRefresh: true });
}

function updateJoinButtonState() {
    if (!joinBoardBtn) return;
    
    if (currentBoard.$id === 'main' || currentBoard.$id.startsWith('class_') || !currentUser) {
        joinBoardBtn.style.display = 'none';
        return;
    }

    const joinedBoards = currentUser.joinedBoards || currentUser.profile?.joinedBoards || [];
    const isJoined = joinedBoards.includes(currentBoard.$id);

    joinBoardBtn.style.display = 'inline-block';
    if (isJoined) {
        joinBoardBtn.textContent = '退出板块';
    } else {
        joinBoardBtn.textContent = '加入板块';
    }
}

async function handleJoinLeaveClick() {
    if (!currentUser || !currentBoard._custom) return;
    const joinedBoards = currentUser.joinedBoards || currentUser.profile?.joinedBoards || [];
    const isJoined = joinedBoards.includes(currentBoard.$id);
    const action = isJoined ? 'leave' : 'join';

    try {
        const res = await fetch('/api/board-membership', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ boardId: currentBoard.$id, action })
        });

        if (!res.ok) {
            const errData = await res.json();
            alert(errData.error || '操作失败');
            return;
        }

        const data = await res.json();
        if (action === 'join') {
            if (data.pending) {
                alert(data.message || '申请已提交，等待主理人审核');
                return;
            }
            joinedBoards.push(currentBoard.$id);
            currentBoard._custom.memberCount++;
        } else {
            const idx = joinedBoards.indexOf(currentBoard.$id);
            if (idx > -1) joinedBoards.splice(idx, 1);
            currentBoard._custom.memberCount = Math.max(0, currentBoard._custom.memberCount - 1);
        }

        currentUser.joinedBoards = joinedBoards;
        if (currentUser.profile) currentUser.profile.joinedBoards = joinedBoards;
        localStorage.setItem('campus_user', JSON.stringify(currentUser));

        updateJoinButtonState();
        renderBoardsSidebar();
        
        if (boardMemberCount) {
            boardMemberCount.textContent = `${currentBoard._custom.memberCount} 成员`;
        }
    } catch (e) {
        alert('网络请求失败');
    }
}

function openCreateBoardModal() {
    if (!currentUser) {
        alert('请登录后创建板块');
        return;
    }
    const modal = document.getElementById('createBoardModal');
    if (modal) modal.style.display = 'flex';
}

function closeCreateBoardModal() {
    const modal = document.getElementById('createBoardModal');
    if (modal) modal.style.display = 'none';
    const bid = document.getElementById('boardId');
    if (bid) bid.value = '';
    const bname = document.getElementById('boardName');
    if (bname) bname.value = '';
    const bdesc = document.getElementById('boardDesc');
    if (bdesc) bdesc.value = '';
}

async function submitCreateBoard() {
    const id = document.getElementById('boardId')?.value.trim().toLowerCase();
    const name = document.getElementById('boardName')?.value.trim();
    const description = document.getElementById('boardDesc')?.value.trim();

    if (!id || !name) {
        alert('板块标识和板块名称不能为空');
        return;
    }

    try {
        const joinType = Number(document.getElementById('boardJoinType')?.value || 0);

        const res = await fetch('/api/board', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser?.appToken || ''
            },
            body: JSON.stringify({ id, name, description, joinType })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '创建板块失败');
            return;
        }

        customBoards.push(data.board);
        window.customBoardsCache[data.board.id] = data.board;

        if (currentUser) {
            const owned = currentUser.ownedBoards || currentUser.profile?.ownedBoards || [];
            const joined = currentUser.joinedBoards || currentUser.profile?.joinedBoards || [];
            if (!owned.includes(id)) owned.push(id);
            if (!joined.includes(id)) joined.push(id);
            currentUser.ownedBoards = owned;
            currentUser.joinedBoards = joined;
            if (currentUser.profile) {
                currentUser.profile.ownedBoards = owned;
                currentUser.profile.joinedBoards = joined;
            }
            localStorage.setItem('campus_user', JSON.stringify(currentUser));
        }

        closeCreateBoardModal();
        renderBoardsSidebar();
        await switchBoard(id);
    } catch (e) {
        alert('网络错误，请稍后重试');
    }
}

function renderPostBoardCheckboxes() {
    const container = document.getElementById('postBoardCheckboxes');
    if (!container) return;

    const joinedSet = new Set(currentUser ? (currentUser.joinedBoards || currentUser.profile?.joinedBoards || []) : ['main']);
    joinedSet.add('main');

    const classBoardId = currentUser?.studentId && /^\d{6,12}$/.test(currentUser.studentId)
        ? `class_${currentUser.studentId.slice(0, 4)}_${currentUser.studentId.slice(4, 6)}`
        : null;
    if (classBoardId) joinedSet.add(classBoardId);

    let html = '';
    
    const isDefaultChecked = (bId) => bId === currentBoard.$id;

    // 1. Main board checkbox
    html += `
        <label style="display:flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.9rem; cursor:pointer;">
            <input type="checkbox" name="postBoards" value="main" ${isDefaultChecked('main') ? 'checked' : ''}>
            <span>主板块</span>
        </label>
    `;

    // 2. Class board checkbox
    if (classBoardId) {
        const className = `${currentUser.studentId.slice(0, 4)}届${currentUser.studentId.slice(4, 6)}班`;
        html += `
            <label style="display:flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.9rem; cursor:pointer;">
                <input type="checkbox" name="postBoards" value="${classBoardId}" ${isDefaultChecked(classBoardId) ? 'checked' : ''}>
                <span>${className}</span>
            </label>
        `;
    }

    // 3. Custom board checkboxes
    for (const b of customBoards) {
        if (joinedSet.has(b.id)) {
            html += `
                <label style="display:flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.9rem; cursor:pointer;">
                    <input type="checkbox" name="postBoards" value="${b.id}" ${isDefaultChecked(b.id) ? 'checked' : ''}>
                    <span>${escapeHtml(b.name)}</span>
                </label>
            `;
        }
    }

    container.innerHTML = html;
}
