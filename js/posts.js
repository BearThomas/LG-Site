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
    formatFeedContent,
    formatTime,
    getPostAuthorDisplay,
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
let currentSortFilter = 'hot';
let currentTimeFilter = 'all';
let currentSearchKeyword = '';
const searchInput = document.getElementById('searchInput'); // 存储当前选中的时间：all, today, week, month
let currentPage = 1;
let totalPages = 1;
const PAGE_SIZE = 20; // 每次加载20行

// 全局实名用户内存高速缓存字典
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
    fetchAndApplyCacheVersion().catch(() => { });
    await loadBoards();
    // 用户资料和帖子流并行加载，避免用户名片查询阻塞首屏内容。
    await loadPosts();
    bindEvents();
    openRequestedPostModal();
    setupPullToRefresh({
        onRefresh: async () => {
            currentPage = 1;
            await loadPosts({ forceRefresh: true });
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
        await fetchCustomBoards();
        renderBoardsSidebar();
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
            posts: new Set(deletedPosts),
            comments: new Set(deletedComments),
            confessions: new Set(deletedConfessions)
        };
    } catch (e) {
        console.warn('获取缓存版本失败（不影响主流程）:', e.message);
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
let currentPostsPool = [];
let infiniteObserver = null;
let isFetchingChunk = false;
let noMoreData = false;
let currentOffset = 0; // 记录当前的请求偏移量

// 按需清理缓存的查询状态
function resetPostsState() {
    currentPostsPool = [];
    noMoreData = false;
    currentOffset = 0;
}

// ========== 加载帖子 ==========
async function loadPosts({ forceRefresh = false } = {}) {
    try {
        if (!postsList) return;

        if (forceRefresh) {
            postsList.innerHTML = createListSkeleton('post', 5);
            resetPostsState();
        }

        // 直接从网络获取首屏实时数据
        await fetchNextPostsBatch();
        initInfiniteScroll();

    } catch (error) {
        console.error('加载最新数据失败:', error);
        postsList.innerHTML = `<div class="empty-state"><p>同步失败，请检查网络</p></div>`;
    }
}

async function fetchNextPostsBatch() {
    const queries = [];

    queries.push(Query.orderDesc('$createdAt'));
    queries.push(Query.offset(currentOffset));
    queries.push(Query.limit(PAGE_SIZE));

    const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, queries);
    let batch = response.documents || [];

    if (batch.length === 0) {
        noMoreData = true;
        return [];
    }

    currentOffset += batch.length;

    const currentUserId = currentUser?.studentId || 'guest';
    const normalizePost = (p) => ({
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
        commentCount: Number(p.commentCount || p.comment_count || 0)
    });

    const filterFn = (post) => {
        if (tombstonedIds.posts.has(post.$id)) return false;
        const postBoard = post.boardId || 'main';
        if (postBoard !== currentBoard.$id) return false;

        // time filter
        if (currentTimeFilter !== 'all') {
            const now = new Date();
            let startTime = new Date();
            if (currentTimeFilter === 'today') startTime.setHours(0, 0, 0, 0);
            else if (currentTimeFilter === 'week') startTime.setDate(now.getDate() - 7);
            else if (currentTimeFilter === 'month') startTime.setDate(now.getDate() - 30);
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

    let processedBatch = batch.map(p => normalizePost(p)).filter(filterFn);
    processedBatch = applyPendingModifications('posts', processedBatch);

    currentPostsPool.push(...processedBatch);

    // 🌟 已更新：融合新帖曝光分、字数丰富度激励与平滑时间衰减的新算法
    const calculateHotScore = post => {
        const likes = Number(post.likes || 0);
        const comments = Number(post.commentCount || 0);
        const createdAt = new Date(post.$createdAt || post.createdAt || post.created_at).getTime();
        const ageHours = Math.max(0, (Date.now() - createdAt) / 3600000);

        // 计算内容激励系数 (基于正文字数)
        const contentLen = (post.content || '').length;
        let contentBonus = 1.0;
        if (contentLen > 800) {
            contentBonus = 1.2; // 深度长文奖励
        } else if (contentLen > 300) {
            contentBonus = 1.1; // 丰富图文奖励
        }

        // 设基础曝光分 G 为 10，并受内容丰富度调节
        const baseBoost = 10 * contentBonus;

        // 核心公式：[点赞*1 + 评论*3 + 初始曝光分] / (小时数 + 2) 的 1.5 次方衰减
        return (likes * 1 + comments * 3 + baseBoost) / Math.pow(ageHours + 2, 1.5);
    };

    if (currentSortFilter === 'hot') {
        currentPostsPool.sort((a, b) => calculateHotScore(b) - calculateHotScore(a));
    } else {
        currentPostsPool.sort((a, b) => new Date(b.$createdAt || b.created_at) - new Date(a.$createdAt || a.created_at));
    }

    // 🌟 智能化改写：引入 30 分钟缓存断路策略
    userCache = window.userCache || {};
    const now = Date.now();
    const CACHE_TTL = 30 * 60 * 1000; // 30分钟的毫秒数极限值

    const authorIds = processedBatch.map(p => p.authorId || p.author_id).filter(Boolean);

    // 🌟 如果本地没有缓存，或者缓存的生存周期已经打破了 30 分钟生命上限，就划入“必须从云端重新抓取”的阵营
    const missingAuthorIds = [...new Set(authorIds)].filter(id => {
        const cachedItem = userCache[id];
        if (!cachedItem) return true;
        // 判定时间戳差距
        return (now - (cachedItem._cacheTime || 0)) > CACHE_TTL;
    });

    if (missingAuthorIds.length > 0) {
        try {
            const usersResponse = await databases.listDocuments(DATABASE_ID, COLLECTION_USERS, [
                Query.equal('userId', missingAuthorIds)
            ]);

            if (usersResponse.documents) {
                usersResponse.documents.forEach(u => {
                    // 🌟 扩展数据字段：附带写入当前获取的时间戳
                    userCache[u.userId] = {
                        ...u,
                        _cacheTime: now
                    };
                });
                window.userCache = userCache;
            }
        } catch (e) {
            console.warn('按需动态拉取或更新用户信息失败:', e);
        }
    }

    // 处理回传非封装状态提供给 getPostAuthorDisplay 二次加工使用
    const unwrapCache = {};
    Object.keys(userCache).forEach(id => {
        unwrapCache[id] = userCache[id];
    });

    renderPosts(currentPostsPool, unwrapCache);
    return processedBatch;
}

function initInfiniteScroll() {
    const anchor = document.getElementById('infiniteScrollAnchor');
    if (!anchor) return;

    if (infiniteObserver) infiniteObserver.disconnect();

    infiniteObserver = new IntersectionObserver(async (entries) => {
        if (entries[0].isIntersecting && !isFetchingChunk && !noMoreData) {
            await loadNextChunk();
        }
    }, { rootMargin: '400px' });

    infiniteObserver.observe(anchor);
}

async function loadNextChunk() {
    const anchor = document.getElementById('infiniteScrollAnchor');
    isFetchingChunk = true;

    if (anchor) anchor.innerHTML = '<span class="feed-initial-orbit" style="width:16px;height:16px;border-width:2px;"></span><span style="margin-left: 8px;">加载中...</span>';

    try {
        const newPosts = await fetchNextPostsBatch();
        if (newPosts.length === 0 && !noMoreData) {
            isFetchingChunk = false;
            return await loadNextChunk();
        }
    } catch (e) {
        console.warn('获取后续帖子失败', e);
    }

    isFetchingChunk = false;

    if (anchor) {
        if (noMoreData) {
            anchor.innerHTML = '<span style="font-size: 0.9rem; margin-top: 10px;">没有更多帖子了...</span>';
        } else {
            anchor.innerHTML = '';
        }
    }
}

// ========== 渲染列表页面核心 HTML ==========
function renderPosts(posts, runtimeCache) {
    if (!postsList) return;
    if (!posts.length) {
        postsList.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><p>暂无帖子...</p></div>`;
        return;
    }

    const renderCache = runtimeCache || userCache;

    postsList.innerHTML = posts.map(post => {
        const postId = post.$id || post.id;
        const postCreatedAt = post.$createdAt || post.createdAt;

        const isPinned = post.status ? (post.status & 1) !== 0 : false;
        const isLocked = post.status ? (post.status & 2) !== 0 : false;
        const createdAt = new Date(postCreatedAt);
        const timeStr = formatTime(createdAt);

        const author = getPostAuthorDisplay(post, renderCache);
        const avatarHtml = renderAuthorAvatar(author, 40);

        return `
            <div class="post-card ${isPinned ? 'pinned' : ''}" data-post-id="${postId}">
                <div class="post-header">
                    <div class="post-avatar" style="width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: var(--accent, #228be6); color: #ffffff; font-weight: bold; flex-shrink: 0;">
                        ${avatarHtml}
                    </div>
                    <div class="post-author-info">
                        <button type="button" class="post-author post-author-link" data-author-id="${escapeHtml(author.cleanAuthorId || author.id || '')}">${author.name || '未知用户'}</button>
                        <div class="post-meta">
                            <span>${timeStr}</span>
                            ${isPinned ? '<span class="post-badge pinned-badge">置顶</span>' : ''}
                            ${isLocked ? '<span class="post-badge locked-badge">已锁定</span>' : ''}
                        </div>
                    </div>
                </div>
                <div class="post-title">${escapeHtml(post.title || '无标题')}</div>
                <div class="post-content-preview">${formatFeedContent(post.content || '', text => escapeHtml(markdownToPreview(text, 150)))}</div>
                <div class="post-footer" style="display: flex; gap: 16px; color: var(--text-secondary); font-size: 0.85rem;">
                    <span class="post-stat" aria-label="点赞数" style="display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                            <path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/>
                        </svg>
                        ${Number(post.likes || 0)}
                    </span>
                    <span class="post-stat" aria-label="评论数" style="display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M2 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h9.586a2 2 0 0 1 1.414.586l2 2V2a1 1 0 0 0-1-1H2zm12-1a2 2 0 0 1 2 2v12.793a.5.5 0 0 1-.854.353l-2.853-2.853a1 1 0 0 0-.707-.293H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h12z"/>
                        </svg>
                        ${Number(post.commentCount || 0)}
                    </span>
                </div>
            </div>
        `;
    }).join('');

    postsList.querySelectorAll('.post-card').forEach(card => {
        card.addEventListener('click', () => openPostDetail(card.dataset.postId));
    });
    postsList.querySelectorAll('.post-author-link').forEach(link => {
        link.addEventListener('click', event => {
            event.stopPropagation();
            window.goToUserProfile?.(link.dataset.authorId, event);
        });
    });
}

async function submitPost() {
    if (submitPostBtn?.disabled) return;
    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }

    const title = postTitle?.value.trim() || '';
    const content = postContent?.value.trim() || '';
    const visibilityType = document.getElementById('visibilityType')?.value || 'all';
    if (!title) return alert('请输入标题');
    if (!content) return alert('请输入内容');

    let viewPermission = 1;
    let targetUsers = [];
    if (visibilityType === 'specific') {
        if (selectedUserIds.size === 0) return alert('请至少添加一个可见用户');
        viewPermission = 4;
        targetUsers = Array.from(selectedUserIds);
    }

    const selectedBoards = [];
    document.querySelectorAll('input[name="postBoards"]:checked').forEach(cb => {
        selectedBoards.push(cb.value);
    });
    const boardIdsToSubmit = selectedBoards.length > 0 ? selectedBoards : [currentBoard.$id];

    submitPostBtn.disabled = true;
    submitPostBtn.textContent = '正在发布…';
    try {
        const response = await fetch('/api/create-post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(currentUser.appToken ? { 'X-LG-Token': currentUser.appToken } : {}),
                ...(currentUser.token ? { 'X-Appwrite-Session': currentUser.token } : {})
            },
            body: JSON.stringify({
                studentId: currentUser.studentId,
                appToken: currentUser.appToken || '',
                sessionSecret: currentUser.token || '',
                boardIds: boardIdsToSubmit,
                title,
                content,
                viewPermission,
                targetUsers
            })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || '发布失败');

        alert('发布成功');
        closeModal();
        currentPage = 1;
        await loadPosts({ forceRefresh: true });
    } catch (error) {
        console.error('发布帖子失败:', error);
        alert(error.message || '网络错误，请稍后重试');
    } finally {
        submitPostBtn.disabled = false;
        submitPostBtn.textContent = '发布';
    }
}

// 其余配置基础 UI 监听函数维持原样
function openModal() {
    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }
    if (postBoardCheckboxes) renderPostBoardCheckboxes();
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
    location.href = 'post.html?id=' + encodeURIComponent(postId);
}

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
    document.getElementById('createBoardBtn')?.addEventListener('click', openCreateBoardModal);
    document.getElementById('closeBoardModal')?.addEventListener('click', closeCreateBoardModal);
    document.getElementById('cancelBoardBtn')?.addEventListener('click', closeCreateBoardModal);
    document.getElementById('submitBoardBtn')?.addEventListener('click', submitCreateBoard);
    if (joinBoardBtn) joinBoardBtn.addEventListener('click', handleJoinLeaveClick);
    if (postModal) postModal.addEventListener('click', (e) => { if (e.target === postModal) closeModal(); });
    const sortFilter = document.getElementById('sortFilter');
    if (sortFilter) {
        sortFilter.addEventListener('change', event => {
            currentSortFilter = event.target.value;
            currentPage = 1;
            loadPosts({ forceRefresh: true });
        });
    }
    const timeFilter = document.getElementById('timeFilter');
    if (timeFilter) {
        timeFilter.addEventListener('change', (e) => {
            currentTimeFilter = e.target.value;
            currentPage = 1;
            loadPosts({ forceRefresh: true });
        });
    }
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                searchKeyword = e.target.value.trim();
                currentPage = 1;
                loadPosts({ forceRefresh: true });
            }, 300);
        });
    }

    const searchSubmitBtn = document.getElementById('searchSubmitBtn');
    if (searchSubmitBtn && searchInput) {
        searchSubmitBtn.addEventListener('click', () => {
            searchKeyword = searchInput.value.trim();
            currentPage = 1;
            loadPosts({ forceRefresh: true });
        });
    }

    const filterCircleBtn = document.getElementById('filterCircleBtn');
    const filterDropdownMenu = document.getElementById('filterDropdownMenu');
    if (filterCircleBtn && filterDropdownMenu) {
        filterCircleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = filterDropdownMenu.style.display === 'none';
            filterDropdownMenu.style.display = isHidden ? 'flex' : 'none';
            filterCircleBtn.classList.toggle('active', isHidden);
        });
        document.addEventListener('click', (e) => {
            if (!filterDropdownMenu.contains(e.target) && e.target !== filterCircleBtn) {
                filterDropdownMenu.style.display = 'none';
                filterCircleBtn.classList.remove('active');
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

const visibilityTypeEl = document.getElementById('visibilityType');
if (visibilityTypeEl) {
    visibilityTypeEl.addEventListener('change', function () {
        const specificArea = document.getElementById('specificUsersArea');
        if (specificArea) specificArea.style.display = this.value === 'specific' ? 'block' : 'none';
    });
}

const searchUserBtn = document.getElementById('searchUserBtn');
if (searchUserBtn) searchUserBtn.addEventListener('click', searchUsers);

const userSearchInput = document.getElementById('userSearchInput');
if (userSearchInput) {
    userSearchInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') searchUsers(); });
}

async function searchUsers() {
    const searchInput = document.getElementById('userSearchInput');
    const resultsContainer = document.getElementById('searchResults');
    if (!searchInput || !resultsContainer) return;
    const keyword = searchInput.value.trim();
    if (!keyword) { resultsContainer.style.display = 'none'; return; }
    let matched = [];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_USERS, [
            Query.search('studentId', keyword),
            Query.limit(10)
        ]);
        matched = response.documents || [];
    } catch (e) { console.warn('搜索用户失败:', e); }
    if (matched.length > 0) {
        resultsContainer.innerHTML = matched.map(user => {
            const sid = user.studentId || user.id || '';
            const isAdded = selectedUserIds.has(sid);
            return `
                <div class="search-result-item">
                    <div class="user-info">
                        <div class="user-avatar-small">${sid.charAt(0)}</div>
                        <span class="user-student-id">${sid}</span>
                    </div>
                    <button class="add-user-btn ${isAdded ? 'added' : ''}" data-student-id="${sid}" ${isAdded ? 'disabled' : ''}>
                        ${isAdded ? '已添加' : '+ 添加'}
                    </button>
                </div>
            `;
        }).join('');
        resultsContainer.querySelectorAll('.add-user-btn:not(.added)').forEach(btn => {
            btn.addEventListener('click', function () { addUser(this.dataset.studentId); });
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
    if (selectedUserIds.size === 0) { container.innerHTML = '<div class="no-users-hint">尚未添加用户</div>'; return; }
    container.innerHTML = Array.from(selectedUserIds).map(studentId => `
        <span class="user-tag">${studentId}<span class="remove-tag" data-student-id="${studentId}">&times;</span></span>
    `).join('');
    container.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', function () { removeUser(this.dataset.studentId); });
    });
}

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

function closePostMobilePreview() { document.getElementById('postPreviewPane')?.classList.remove('mobile-preview-open'); }

function togglePostPreview() {
    const pane = document.getElementById('postPreviewPane');
    const layout = pane?.closest('.editor-layout');
    if (!pane || !layout) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    updatePostPreview();
    if (isMobile) { pane.classList.add('mobile-preview-open'); }
    else { pane.classList.toggle('preview-hidden'); layout.classList.toggle('preview-closed'); }
}

async function fetchCustomBoards() {
    try {
        const res = await fetch('/api/board');
        if (res.ok) {
            const data = await res.json();
            customBoards = data.boards || [];
            window.customBoardsCache = {};
            for (const b of customBoards) { window.customBoardsCache[b.id] = b; }
        }
    } catch (e) { console.warn('获取自定义板块失败:', e); }
}

function renderBoardsSidebar() {
    const container = document.getElementById('boardsListContainer');
    if (!container) return;
    const joinedSet = new Set(currentUser ? (currentUser.joinedBoards || currentUser.profile?.joinedBoards || []) : ['main']);
    joinedSet.add('main');
    const classBoardId = currentUser?.studentId && /^\d{6,12}$/.test(currentUser.studentId) ? `class_${currentUser.studentId.slice(0, 4)}_${currentUser.studentId.slice(4, 6)}` : null;
    if (classBoardId) joinedSet.add(classBoardId);
    let html = '';
    const mainActive = currentBoard.$id === 'main' ? 'active' : '';
    html += `<div class="board-item ${mainActive}" data-board-id="main"><span class="board-icon">🏠</span><span class="board-name">主板块</span></div>`;
    if (classBoardId) {
        const classActive = currentBoard.$id === classBoardId ? 'active' : '';
        const className = `${currentUser.studentId.slice(0, 4)}级${currentUser.studentId.slice(4, 6)}班`;
        html += `<div class="board-item ${classActive}" data-board-id="${classBoardId}"><span class="board-icon">🎓</span><span class="board-name">${className}</span></div>`;
    }
    for (const b of customBoards) {
        const isJoined = joinedSet.has(b.id);
        const active = currentBoard.$id === b.id ? 'active' : '';
        html += `<div class="board-item ${active}" data-board-id="${b.id}"><span class="board-icon">💬</span><span class="board-name">${escapeHtml(b.name)}</span>${isJoined ? '' : '<span style="font-size:10px; color:#94a3b8; margin-left:4px;">未加入</span>'}</div>`;
    }
    if (currentUser) {
        html += `<div class="board-item create-board-trigger-item" style="border: 1px dashed #3b82f6; background: rgba(59, 130, 246, 0.05); margin-top: 10px;"><span class="board-icon" style="color:#3b82f6;">➕</span><span class="board-name" style="color:#3b82f6; font-weight:600;">新建板块</span></div>`;
    }
    container.innerHTML = html;
    container.querySelectorAll('.board-item:not(.create-board-trigger-item)').forEach(el => {
        el.addEventListener('click', () => { switchBoard(el.getAttribute('data-board-id')); });
    });
    container.querySelector('.create-board-trigger-item')?.addEventListener('click', openCreateBoardModal);
}

async function switchBoard(boardId) {
    if (currentBoard.$id === boardId) return;
    if (boardId === 'main') { currentBoard = { $id: 'main', name: '主板块' }; }
    else if (boardId.startsWith('class_')) {
        const match = boardId.match(/^class_(\d{4})_(\d+)$/);
        currentBoard = { $id: boardId, name: match ? `${match[1]}级${match[2]}班` : boardId };
    } else {
        const b = customBoards.find(x => x.id === boardId);
        currentBoard = { $id: boardId, name: b ? b.name : boardId, _custom: b };
    }
    if (currentBoardName) currentBoardName.textContent = currentBoard.name;
    if (boardMemberCount) boardMemberCount.textContent = currentBoard._custom ? `${currentBoard._custom.memberCount} 成员` : '';
    updateJoinButtonState();
    currentPage = 1;
    renderBoardsSidebar();
    await loadPosts({ forceRefresh: true });
}

function updateJoinButtonState() {
    if (!joinBoardBtn) return;
    if (currentBoard.$id === 'main' || currentBoard.$id.startsWith('class_') || !currentUser) { joinBoardBtn.style.display = 'none'; return; }
    const joinedBoards = currentUser.joinedBoards || currentUser.profile?.joinedBoards || [];
    joinBoardBtn.style.display = 'inline-block';
    joinBoardBtn.textContent = joinedBoards.includes(currentBoard.$id) ? '退出板块' : '加入板块';
}

async function handleJoinLeaveClick() {
    if (!currentUser || !currentBoard._custom) return;
    const joinedBoards = currentUser.joinedBoards || currentUser.profile?.joinedBoards || [];
    const isJoined = joinedBoards.includes(currentBoard.$id);
    const action = isJoined ? 'leave' : 'join';
    try {
        const res = await fetch('/api/board-membership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-LG-Token': currentUser.appToken || '' },
            body: JSON.stringify({ boardId: currentBoard.$id, action })
        });
        if (!res.ok) { alert((await res.json()).error || '操作失败'); return; }
        const data = await res.json();
        if (action === 'join') {
            if (data.pending) { alert(data.message || '申请已提交，等待主理人审核'); return; }
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
        if (boardMemberCount) boardMemberCount.textContent = `${currentBoard._custom.memberCount} 成员`;
    } catch (e) { alert('网络请求失败'); }
}

function openCreateBoardModal() { if (!currentUser) { alert('请登录后创建板块'); return; } const modal = document.getElementById('createBoardModal'); if (modal) modal.style.display = 'flex'; }
function closeCreateBoardModal() {
    const modal = document.getElementById('createBoardModal'); if (modal) modal.style.display = 'none';
    document.getElementById('boardId') && (document.getElementById('boardId').value = '');
    document.getElementById('boardName') && (document.getElementById('boardName').value = '');
    document.getElementById('boardDesc') && (document.getElementById('boardDesc').value = '');
}

async function submitCreateBoard() {
    const id = document.getElementById('boardId')?.value.trim().toLowerCase();
    const name = document.getElementById('boardName')?.value.trim();
    const description = document.getElementById('boardDesc')?.value.trim();
    if (!id || !name) { alert('板块标识和板块名称不能为空'); return; }
    try {
        const joinType = Number(document.getElementById('boardJoinType')?.value || 0);
        const res = await fetch('/api/board', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-LG-Token': currentUser?.appToken || '' },
            body: JSON.stringify({ id, name, description, joinType })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || '创建板块失败'); return; }
        customBoards.push(data.board);
        window.customBoardsCache[data.board.id] = data.board;
        if (currentUser) {
            const owned = currentUser.ownedBoards || currentUser.profile?.ownedBoards || [];
            const joined = currentUser.joinedBoards || currentUser.profile?.joinedBoards || [];
            if (!owned.includes(id)) owned.push(id);
            if (!joined.includes(id)) joined.push(id);
            currentUser.ownedBoards = owned; currentUser.joinedBoards = joined;
            if (currentUser.profile) { currentUser.profile.ownedBoards = owned; currentUser.profile.joinedBoards = joined; }
            localStorage.setItem('campus_user', JSON.stringify(currentUser));
        }
        closeCreateBoardModal(); renderBoardsSidebar(); await switchBoard(id);
    } catch (e) { alert('网络错误，请稍后重试'); }
}

function renderPostBoardCheckboxes() {
    const container = document.getElementById('postBoardCheckboxes'); if (!container) return;
    const joinedSet = new Set(currentUser ? (currentUser.joinedBoards || currentUser.profile?.joinedBoards || []) : ['main']); joinedSet.add('main');
    const classBoardId = currentUser?.studentId && /^\d{6,12}$/.test(currentUser.studentId) ? `class_${currentUser.studentId.slice(0, 4)}_${currentUser.studentId.slice(4, 6)}` : null;
    if (classBoardId) joinedSet.add(classBoardId);
    let html = '';
    const isDefaultChecked = (bId) => bId === currentBoard.$id;
    html += `<label style="display:flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.9rem; cursor:pointer;"><input type="checkbox" name="postBoards" value="main" ${isDefaultChecked('main') ? 'checked' : ''}><span>主板块</span></label>`;
    if (classBoardId) {
        const className = `${currentUser.studentId.slice(0, 4)}级${currentUser.studentId.slice(4, 6)}班`;
        html += `<label style="display:flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.9rem; cursor:pointer;"><input type="checkbox" name="postBoards" value="${classBoardId}" ${isDefaultChecked(classBoardId) ? 'checked' : ''}><span>${className}</span></label>`;
    }
    for (const b of customBoards) {
        if (joinedSet.has(b.id)) { html += `<label style="display:flex; align-items:center; gap:6px; background:var(--surface); padding:6px 12px; border-radius:8px; border:1px solid var(--border); font-size:0.9rem; cursor:pointer;"><input type="checkbox" name="postBoards" value="${b.id}" ${isDefaultChecked(b.id) ? 'checked' : ''}><span>${escapeHtml(b.name)}</span></label>`; }
    }
    container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
    const fabBtn = document.getElementById('fabNewPostBtn');
    if (fabBtn) {
        fabBtn.addEventListener('click', () => {
            const user = JSON.parse(localStorage.getItem('campus_user') || 'null');
            if (!user) {
                alert('请先登录后再发帖');
                location.href = 'login.html';
                return;
            }
            openModal();
        });
    }
});