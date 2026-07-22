// js/home.js
// Enhanced with Hotness Factor Algorithm 2026/05/31
import { Client, Databases, Query } from './d1-appwrite-compat.js';
import { markdownToPreview } from './markdown.js';
import { createListSkeleton, scheduleAfterPaint, setupPullToRefresh } from './feed-experience.js';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_CONFESSIONS,
    COLLECTION_POSTS,
    COLLECTION_USERS,
    DATABASE_ID,
    decryptText,
    escapeHtml,
    formatBoardName,
    formatTime,
    getPostAuthorDisplay,
    normalizeUserId,
    renderAuthorAvatar,
    restoreSecureKey
} from './shared.js';

// 初始化兼容客户端：业务数据实际通过同源 D1 API 获取
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

let databases;
let currentUser = null;
let userCache = {};
let secureKeyReady = Promise.resolve(null);

// ========== ⚡ 热度核心算法机制 ==========
function calculateHotScore(item) {
    const likes = Number(item.likes || 0);
    const comments = Number(item.commentCount || 0);
    const createdAt = new Date(item.$createdAt || item.createdAt).getTime();
    
    // 时间差（换算为小时）
    const ageHours = Math.max(0, (Date.now() - createdAt) / 3600000);
    
    // 基础新帖曝光分
    let baseBoost = 10;
    
    // 内容激励系数：根据字数微调初始起跑线
    const contentLength = (item.content || '').length;
    if (contentLength > 500) {
        baseBoost *= 1.2; // 超过500字长文激励
    } else if (contentLength > 100) {
        baseBoost *= 1.1;
    }

    // 热度核心公式：(点赞*1 + 评论*3 + 初始曝光分) / (小时数 + 2)^1.5
    return (likes * 1 + comments * 3 + baseBoost) / Math.pow(ageHours + 2, 1.5);
}

// ========== 离线缓存支持 ==========
async function fetchWithHashCache(collection, urls) {
    const serverHash = window.serverHashes ? window.serverHashes[collection] : undefined;
    const cacheKeyData = `cache_data_${collection}`;
    const cacheKeyHash = `cache_hash_${collection}`;
    
    if (serverHash) {
        const localHash = localStorage.getItem(cacheKeyHash);
        if (localHash === serverHash) {
            const cachedData = localStorage.getItem(cacheKeyData);
            if (cachedData) {
                try { return JSON.parse(cachedData); } catch (e) {}
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

function applyPendingModifications(collection, documents) {
    if (!documents || !Array.isArray(documents)) return documents;
    let modified = [...documents];
    if (!window.pendingModifications) return modified;

    for (const log of window.pendingModifications) {
        if (log.collection !== collection) continue;
        const idx = modified.findIndex(d => (d.$id === log.item_id || d.id === log.item_id));
        if (idx !== -1) {
            if (log.action === 'delete') {
                modified.splice(idx, 1);
            } else if (log.action === 'edit' && log.payload) {
                try {
                    const updates = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
                    modified[idx] = { ...modified[idx], ...updates };
                } catch(e) {}
            }
        }
    }
    return modified;
}

// ========== ⚡ 推荐页无板块分割全能混合长流引擎 ==========
let currentMixedItems = [];
let mixedFeedOffset = 0;
const MIXED_PAGE_SIZE = 15;
let isPreloadingNextBatch = false;

function calculateMixedHotScore(item) {
    const createdAt = new Date(item.$createdAt || item.createdAt || item.date || Date.now()).getTime();
    const ageHours = Math.max(0, (Date.now() - createdAt) / 3600000);
    const ageDays = ageHours / 24;

    if (ageDays > 7) {
        return 0;
    }

    let numerator = 10;
    if (item.type === 'event') {
        numerator = 150;
    } else if (item.type === 'confession') {
        const likes = Number(item.likes || 0);
        numerator = 25 + likes * 2;
    } else {
        const likes = Number(item.likes || 0);
        const comments = Number(item.commentCount || 0);
        const contentLength = (item.content || '').length;
        let baseBoost = 10;
        if (contentLength > 500) baseBoost *= 1.2;
        else if (contentLength > 100) baseBoost *= 1.1;
        numerator = likes * 1 + comments * 3 + baseBoost;
    }

    return numerator / Math.pow(ageHours + 2, 1.5);
}

async function loadHomeContent({ forceRefresh = false } = {}) {
    const feedContainer = document.getElementById('recommendFeedContainer');
    if (!feedContainer) return;

    if (!forceRefresh) {
        feedContainer.innerHTML = createListSkeleton('post', 4);
    }

    let posts = [];
    let confessions = [];
    let events = [];

    await Promise.allSettled([
        databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, [
            Query.orderDesc('$createdAt'),
            Query.limit(40)
        ]).then(r => { posts = r.documents.map(p => ({ ...p, type: 'post' })); }).catch(() => {}),

        databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, [
            Query.equal('status', 0),
            Query.orderDesc('$createdAt'),
            Query.limit(30)
        ]).then(r => { confessions = r.documents.map(c => ({ ...c, type: 'confession' })); }).catch(() => {}),

        fetch('./data/events.json').then(r => r.json()).then(data => {
            events = (data || []).map(e => ({ ...e, type: 'event', $createdAt: e.date }));
        }).catch(() => {})
    ]);

    const seenIds = new Set();
    const allItems = [...events, ...posts, ...confessions].filter(item => {
        const id = item.$id || item.id || item.title;
        if (seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
    });

    allItems.sort((a, b) => {
        const aPinned = a.status ? (a.status & 1) !== 0 : false;
        const bPinned = b.status ? (b.status & 1) !== 0 : false;
        if (aPinned !== bPinned) return bPinned ? 1 : -1;

        const scoreA = calculateMixedHotScore(a);
        const scoreB = calculateMixedHotScore(b);

        if (scoreA > 0 && scoreB > 0) {
            return scoreB - scoreA;
        }
        if (scoreA > 0) return -1;
        if (scoreB > 0) return 1;

        const timeA = new Date(a.$createdAt || a.createdAt || a.date || 0).getTime();
        const timeB = new Date(b.$createdAt || b.createdAt || b.date || 0).getTime();
        return timeB - timeA;
    });

    currentMixedItems = allItems;
    mixedFeedOffset = 0;

    renderMixedBatch(true);
    setupPreloadScrollListener();
}

function renderMixedBatch(isInitial = false) {
    const feedContainer = document.getElementById('recommendFeedContainer');
    if (!feedContainer) return;

    const nextBatch = currentMixedItems.slice(mixedFeedOffset, mixedFeedOffset + MIXED_PAGE_SIZE);
    if (!nextBatch.length && isInitial) {
        feedContainer.innerHTML = `<div class="empty-state"><p>暂无最新内容，去发布一条吧</p></div>`;
        return;
    }

    const html = nextBatch.map(item => renderMixedFeedItem(item)).join('');

    if (isInitial) {
        feedContainer.innerHTML = html;
    } else {
        feedContainer.insertAdjacentHTML('beforeend', html);
    }

    mixedFeedOffset += nextBatch.length;
}

function renderMixedFeedItem(item) {
    if (item.type === 'event') {
        return `
            <div class="event-card feed-card-event">
                <span class="event-tag">${escapeHtml(item.tag || '大事记')}</span>
                <div class="event-title">${escapeHtml(item.title)}</div>
                <div class="event-desc">${escapeHtml(item.desc || '')}</div>
                <div class="event-date">⭐ 本周大事记 · ${formatTime(new Date(item.date || item.$createdAt))}</div>
            </div>
        `;
    }

    if (item.type === 'confession') {
        const fullContent = escapeHtml(item.content || '');
        const isLong = fullContent.length > 80;
        const shortContent = isLong ? fullContent.slice(0, 80) + '...' : fullContent;

        return `
            <div class="confession-card feed-card-confession">
                <div class="confession-text" data-full-text="${fullContent.replace(/"/g, '&quot;')}" data-short-text="${shortContent.replace(/"/g, '&quot;')}">
                    <span class="content-body">${shortContent}</span>
                    ${isLong ? '<span class="expand-confession-btn" onclick="window.toggleConfessionExpand(this)">展开全文</span>' : ''}
                </div>
                <div class="confession-footer" style="display: flex; justify-content: space-between; align-items: center; color: var(--text-secondary); font-size: 0.82rem; margin-top: 6px;">
                    <span>💌 表白墙 · ${formatTime(new Date(item.$createdAt || item.createdAt))}</span>
                </div>
            </div>
        `;
    }

    const timeStr = formatTime(new Date(item.$createdAt || item.createdAt));
    const isPinned = item.status ? (item.status & 1) !== 0 : false;
    const author = getPostAuthorDisplay(item, userCache);
    const avatarHtml = renderAuthorAvatar(author, 44);

    return `
        <div class="post-card feed-card-post" onclick="location.href='post.html?id=${item.$id || item.id}'">
            <div class="post-header">
                <div class="post-avatar" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: var(--accent, #228be6); color: #ffffff; font-weight: bold; flex-shrink: 0;">${avatarHtml}</div>
                <div>
                    <div class="post-author" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer;">${author.name}</div>
                    <div class="post-time">📄 帖子 · ${timeStr}</div>
                </div>
            </div>
            <div class="post-title">${isPinned ? '<span class="post-badge pinned-badge" style="margin-right:6px;">置顶</span>' : ''}${escapeHtml(item.title || '无标题')}</div>
            <div class="post-content">${escapeHtml(markdownToPreview(item.content || '', 100))}</div>
            <div class="post-footer" style="display: flex; gap: 16px; color: var(--text-secondary); font-size: 0.85rem; margin-top: 8px;">
                <span class="post-stat" style="display: flex; align-items: center; gap: 4px;">❤️ ${Number(item.likes || 0)}</span>
                <span class="post-stat" style="display: flex; align-items: center; gap: 4px;">💬 ${Number(item.commentCount || 0)}</span>
            </div>
        </div>
    `;
}

function setupPreloadScrollListener() {
    window.removeEventListener('scroll', handleScrollPreload);
    window.addEventListener('scroll', handleScrollPreload);
}

function handleScrollPreload() {
    if (isPreloadingNextBatch) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    if (documentHeight > 0 && (scrollTop + windowHeight) >= (documentHeight * 0.67)) {
        if (mixedFeedOffset < currentMixedItems.length) {
            isPreloadingNextBatch = true;
            renderMixedBatch(false);
            setTimeout(() => { isPreloadingNextBatch = false; }, 400);
        }
    }
}

window.toggleConfessionExpand = function(btn) {
    const parent = btn.parentElement;
    const body = parent.querySelector('.content-body');
    const fullText = parent.dataset.fullText;
    const shortText = parent.dataset.shortText;
    const isExpanded = btn.textContent === '收起';

    if (isExpanded) {
        body.textContent = shortText;
        btn.textContent = '展开全文';
    } else {
        body.textContent = fullText;
        btn.textContent = '收起';
    }
};

// ========== 初始化入口 ==========
(async function init() {
    secureKeyReady = restoreSecureKey();

    const userData = localStorage.getItem('campus_user');
    if (userData) {
        try {
            const saved = JSON.parse(userData);
            if (saved && saved.authVersion === 2 && saved.studentId) {
                currentUser = saved;
            }
        } catch (e) {
            console.warn('解析本地用户凭证失败:', e);
        }
    }

    databases = new Databases(client);
    
    checkLoginStatus();
    bindHomeActions();
    await Promise.all([
        loadHomePosts({ forceRefresh: true }),
        loadHomeConfessions({ forceRefresh: true })
    ]);

    window.addEventListener('userLoginSuccess', async () => {
        if (currentUser) {
            await Promise.all([
                loadHomePosts({ forceRefresh: true }),
                loadHomeConfessions({ forceRefresh: true })
            ]);
        }
    });
    setupPullToRefresh({
        onRefresh: async () => {
            await Promise.all([
                loadHomePosts({ forceRefresh: true }),
                loadHomeConfessions({ forceRefresh: true })
            ]);
        }
    });
})();

// ========== 检查并同步登录状态 UI ==========
function checkLoginStatus() {}

function bindHomeActions() {
    const newPostBtn = document.getElementById('newPostBtn');
    if (!newPostBtn) return;

    newPostBtn.addEventListener('click', () => {
        if (!localStorage.getItem('campus_user')) {
            location.href = 'login.html';
            return;
        }
        location.href = 'posts.html?new=1';
    });
}

// ========== 异步优雅获取用户板块权限组 ==========
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
        console.warn('获取用户板块失败，降级回主板块:', e);
    }
    return ['main'];
}

// ========== 严格视图可见性权限过滤器 ==========
function isPostVisible(post, userBoards) {
    if (post.title === null || post.content === null) return false;

    const viewPermission = Number(post.viewPermission) || 1;
    const isAuthor = currentUser && currentUser.studentId && post.authorId &&
        normalizeUserId(post.authorId) === normalizeUserId(currentUser.studentId);
    
    if (viewPermission === 1) return true; 
    if (viewPermission === 8) return isAuthor; 
    if (viewPermission === 2) { 
        if (!currentUser) return false;
        return userBoards.includes(post.boardId);
    }
    if (viewPermission === 4) { 
        if (!currentUser) return false;
        const targetGroups = post.targetGroups || [];
        return targetGroups.includes(currentUser.studentId) || targetGroups.some(group => userBoards.includes(group));
    }
    return false;
}

// ========== 缓存状态同步提示条控制 ==========
function showHomeCacheNotice(containerEl, noticeId, message, type = 'waiting') {
    if (!containerEl) return;
    document.getElementById(noticeId)?.remove(); 

    const noticeEl = document.createElement('div');
    noticeEl.id = noticeId;
    noticeEl.className = `cache-notice-bar ${type}`;
    noticeEl.style.fontSize = '12px';
    noticeEl.style.padding = '6px 12px';
    noticeEl.style.marginBottom = '10px';
    noticeEl.innerHTML = message;
    
    containerEl.insertBefore(noticeEl, containerEl.firstChild);

    if (type === 'success') {
        setTimeout(() => {
            noticeEl.style.opacity = '0';
            setTimeout(() => noticeEl.remove(), 400);
        }, 2000);
    }
}

// ========== 加载首页帖子 ==========
async function loadHomePosts({ forceRefresh = false } = {}) {
    const postList = document.getElementById('postList');
    if (!postList) return;

    let tombstones = { posts: new Set() };
    try {
        const vRes = await fetch('/api/mod-log');
        if (vRes.ok) {
            const vData = await vRes.json();
            window.serverHashes = vData.hashes || {};
            window.pendingModifications = vData.pendingModifications || [];
            
            const deletedPosts = window.pendingModifications.filter(m => m.collection === 'posts' && m.action === 'delete').map(m => m.item_id);
            tombstones.posts = new Set(deletedPosts);
        }
    } catch {}

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_home_posts_${currentUserId}`;
    const localCache = forceRefresh ? null : localStorage.getItem(cacheKey);
    let hasRenderedCache = false;

    if (localCache) {
        try {
            const parsed = JSON.parse(localCache);
            if (parsed && Array.isArray(parsed.data)) {
                renderHomePosts(parsed.data);
                showHomeCacheNotice(postList, 'postCacheNotice', '已载入本地动态快照，正在校验云端...', 'waiting');
                hasRenderedCache = true;
            }
        } catch (e) {
            console.warn('读取首页帖子缓存失败:', e);
        }
    }

    if (!hasRenderedCache && !forceRefresh) {
        postList.innerHTML = createListSkeleton('post', 3);
    }

    let hotPosts = [];
    let coldPosts = [];

    const [hotResult, coldResult] = await Promise.allSettled([
        databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, [
            Query.orderDesc('$createdAt'),
            Query.limit(25)
        ]).then(r => r.documents),
        (async () => {
            try {
                let docs = [];
                let index = await fetchWithHashCache('posts', ['./public/data-backups/posts/index.json']);
                if (index && index.chunks && index.chunks.length > 0) {
                    let firstChunk = index.chunks[0];
                    let chunkData = await fetchWithHashCache(`posts_chunk_1`, [`./public/data-backups/posts/${firstChunk.file}`]);
                    docs = applyPendingModifications('posts', chunkData);
                }
                return docs;
            } catch (e) {
                console.warn('获取备用Posts源失败', e);
                return [];
            }
        })()
    ]);

    if (hotResult.status === 'fulfilled') {
        hotPosts = hotResult.value || [];
    }
    if (coldResult.status === 'fulfilled') {
        coldPosts = coldResult.value || [];
    }

    const normalizePost = (post, isCold) => ({
        $id: post.$id || post.id,
        $createdAt: post.$createdAt || post.createdAt,
        title: post.title,
        content: post.content,
        authorId: post.authorId,
        authorName: post.authorName,
        boardId: post.boardId,
        viewPermission: post.viewPermission,
        targetGroups: post.targetGroups || [],
        status: post.status || 0,
        likes: Number(post.likes || 0),
        liked: isCold ? false : Boolean(post.liked),
        commentCount: Number(post.commentCount || post.comment_count || 0),
        _isCold: isCold
    });

    const normalizedHot = hotPosts.map(p => normalizePost(p, false)).filter(p => !tombstones.posts.has(p.$id));
    const normalizedCold = coldPosts.map(p => normalizePost(p, true)).filter(p => !tombstones.posts.has(p.$id));

    const seen = new Set();
    const allPosts = [...normalizedHot, ...normalizedCold].filter(p => {
        if (seen.has(p.$id)) return false;
        seen.add(p.$id);
        return true;
    });

    // 🌟 核心算法变更：从旧的纯时间排序改为“置顶权衡 + 热度因子”混合降序排序
    allPosts.sort((a, b) => {
        const aPinned = a.status ? (a.status & 1) !== 0 : false;
        const bPinned = b.status ? (b.status & 1) !== 0 : false;
        if (aPinned !== bPinned) return bPinned ? 1 : -1; // 置顶贴绝对前置
        return calculateHotScore(b) - calculateHotScore(a); // 其余帖子跑热度分排序
    });

    const userBoards = currentUser ? await getUserJoinedBoards() : ['main'];
    const visiblePosts = allPosts.filter(post => isPostVisible(post, userBoards));
    const finalHomePosts = visiblePosts.slice(0, 5);

    const authorIds = finalHomePosts.map(p => p.authorId || p.author_id).filter(Boolean);
    try {
        const { getUsersInfo } = await import('./shared.js');
        await getUsersInfo(databases, Query, authorIds);
        userCache = window.userCache || {};
    } catch(e) {}

    renderHomePosts(finalHomePosts);
    scheduleAfterPaint(() => {
        localStorage.setItem(cacheKey, JSON.stringify({ data: finalHomePosts, ts: Date.now() }));
    });

    if (hasRenderedCache) {
        showHomeCacheNotice(postList, 'postCacheNotice', '动态流已实时同步至最新', 'success');
    }
}

// ========== 渲染首页帖子 HTML ==========
function renderHomePosts(posts) {
    const postList = document.getElementById('postList');
    if (!postList) return;
    
    if (!posts.length) {
        postList.innerHTML = `
            <div class="empty-state">
                <p>暂无最新帖子，<a href="posts.html">点击去发帖</a></p>
            </div>
        `;
        return;
    }
    
    postList.innerHTML = posts.map(post => {
        const timeStr = formatTime(new Date(post.$createdAt));
        const isPinned = post.status ? (post.status & 1) !== 0 : false;
        const author = getPostAuthorDisplay(post, userCache);
        const avatarHtml = renderAuthorAvatar(author, 44);
        
        return `
            <div class="post-card feed-card-post" onclick="location.href='post.html?id=${post.$id}'">
                <div class="post-header">
                    <div class="post-avatar" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; overflow: hidden; background-color: var(--accent, #228be6); color: #ffffff; font-weight: bold; flex-shrink: 0;">${avatarHtml}</div>
                    <div>
                        <div class="post-author" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${author.name}</div>
                        <div class="post-time">${timeStr} · ${formatBoardName(post.boardId)}</div>
                    </div>
                </div>
                <div class="post-title">${isPinned ? '<span class="post-badge pinned-badge" style="margin-right:6px;">置顶</span>' : ''}${escapeHtml(post.title || '无标题')}</div>
                <div class="post-content">${escapeHtml(markdownToPreview(post.content, 100))}</div>
                <div class="post-footer" style="display: flex; gap: 16px; color: var(--text-secondary); font-size: 0.85rem; margin-top: 8px;">
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
}

// ========== 加载首页表白墙 ==========
async function loadHomeConfessions({ forceRefresh = false } = {}) {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_home_confessions_${currentUserId}`;
    const localCache = forceRefresh ? null : localStorage.getItem(cacheKey);
    let hasRenderedCache = false;

    if (localCache) {
        try {
            const parsed = JSON.parse(localCache);
            if (parsed && Array.isArray(parsed.data)) {
                renderHomeConfessions(parsed.data);
                showHomeCacheNotice(confessionList, 'confessionCacheNotice', '已载入历史手札，正在同步最新心动...', 'waiting');
                hasRenderedCache = true;
            }
        } catch (e) {
            console.warn('读取首页表白缓存失败:', e);
        }
    }

    if (!hasRenderedCache && !forceRefresh) {
        confessionList.innerHTML = createListSkeleton('confession', 3);
    }

    let hotConfessions = [];
    let hotConfessionsLoaded = false;
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, [
            Query.equal('status', 0),
            Query.orderDesc('$createdAt'),
            Query.limit(20)
        ]);
        hotConfessions = response.documents;
        hotConfessionsLoaded = true;
    } catch (e) {
        console.warn('云端实时表白拉取失败:', e.message);
    }

    let coldConfessions = [];
    if (!hotConfessionsLoaded) {
        try {
            let index = await fetchWithHashCache('confessions', ['./public/data-backups/confessions/index.json']);
            if (index && index.chunks && index.chunks.length > 0) {
                let firstChunk = index.chunks[0];
                let chunkData = await fetchWithHashCache(`confessions_chunk_1`, [`./public/data-backups/confessions/${firstChunk.file}`]);
                coldConfessions = applyPendingModifications('confessions', chunkData);
            }
        } catch (e) {}
    }

    const normalizeConfession = (c) => ({
        $id: c.$id || c.id,
        $createdAt: c.$createdAt || c.createdAt,
        content: c.content,
        likes: Number(c.likes || 0),
        commentCount: Number(c.commentCount || c.comment_count || 0),
        authorName: (() => {
            let n = escapeHtml(c.authorName || '匿名');
            let sid = (c.authorId || c.studentId || '').toString().replace(/^student_/, '').trim();
            if (sid.length >= 4) n = `${n}<span class="year-badge">${sid.substring(0, 4)}级</span>`;
            return n;
        })(),
        status: c.status !== undefined ? c.status : 0
    });

    const seenIds = new Set();
    const allConfessions = [
        ...hotConfessions.map(c => normalizeConfession(c)),
        ...coldConfessions.map(c => normalizeConfession(c))
    ].filter(c => {
        if (c.content === null || c.status !== 0) return false;
        if (seenIds.has(c.$id)) return false;
        seenIds.add(c.$id);
        return true;
    });

    // 🌟 核心算法变更：表白墙首页也改用热度因子降序排序，筛选出真正的优质热门互动表白
    allConfessions.sort((a, b) => calculateHotScore(b) - calculateHotScore(a));
    const finalConfessions = allConfessions.slice(0, 10);

    renderHomeConfessions(finalConfessions);
    scheduleAfterPaint(() => {
        localStorage.setItem(cacheKey, JSON.stringify({ data: finalConfessions, ts: Date.now() }));
    });

    if (hasRenderedCache) {
        showHomeCacheNotice(confessionList, 'confessionCacheNotice', '表白手札已完成同步更新', 'success');
    }
}

// ========== 渲染首页表白墙 HTML ==========
function renderHomeConfessions(confessions) {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;
    
    if (!confessions.length) {
        confessionList.innerHTML = `
            <div class="empty-state">
                <p>暂无表白，<a href="confession.html">去写一张</a></p>
            </div>
        `;
        return;
    }
    
    confessionList.innerHTML = confessions.map(c => {
        const fullContent = escapeHtml(c.content || '');
        const isLong = fullContent.length > 80;
        const shortContent = isLong ? fullContent.slice(0, 80) + '...' : fullContent;

        return `
            <div class="confession-card feed-card-confession">
                <div class="confession-text" data-full-text="${fullContent.replace(/"/g, '&quot;')}" data-short-text="${shortContent.replace(/"/g, '&quot;')}">
                    <span class="content-body">${shortContent}</span>
                    ${isLong ? '<span class="expand-confession-btn" onclick="window.toggleConfessionExpand(this)">展开全文</span>' : ''}
                </div>
                <div class="confession-footer" style="display: flex; justify-content: space-between; align-items: center; color: var(--text-secondary); font-size: 0.82rem; margin-top: 6px;">
                    <span>💌 表白墙 · ${formatTime(new Date(c.$createdAt))}</span>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleConfessionExpand = function(btn) {
    const parent = btn.parentElement;
    const body = parent.querySelector('.content-body');
    const fullText = parent.dataset.fullText;
    const shortText = parent.dataset.shortText;
    const isExpanded = btn.textContent === '收起';

    if (isExpanded) {
        body.textContent = shortText;
        btn.textContent = '展开全文';
    } else {
        body.textContent = fullText;
        btn.textContent = '收起';
    }
};

function initHomeTabs() {
    const tabsBar = document.getElementById('homeTabsBar');
    const fabBtn = document.getElementById('fabNewPostBtn');
    
    if (fabBtn) {
        fabBtn.addEventListener('click', () => {
            if (!localStorage.getItem('campus_user')) {
                location.href = 'login.html';
                return;
            }
            location.href = 'posts.html?new=1';
        });
    }

    if (!tabsBar) return;

    const eventBoard = document.querySelector('.event-board');
    const postSection = document.querySelector('.post-section');
    const confessionSection = document.querySelector('.confession-section');

    tabsBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.home-tab-btn');
        if (!btn) return;
        const tab = btn.dataset.tab;

        tabsBar.querySelectorAll('.home-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (window.innerWidth <= 900) {
            if (tab === 'recommend') {
                if (eventBoard) eventBoard.style.display = 'block';
                if (postSection) postSection.style.display = 'block';
                if (confessionSection) confessionSection.style.display = 'block';
            } else if (tab === 'posts') {
                if (eventBoard) eventBoard.style.display = 'none';
                if (postSection) postSection.style.display = 'block';
                if (confessionSection) confessionSection.style.display = 'none';
            } else if (tab === 'events') {
                if (eventBoard) eventBoard.style.display = 'block';
                if (postSection) postSection.style.display = 'none';
                if (confessionSection) confessionSection.style.display = 'none';
            } else if (tab === 'confessions') {
                if (eventBoard) eventBoard.style.display = 'none';
                if (postSection) postSection.style.display = 'none';
                if (confessionSection) confessionSection.style.display = 'block';
            }
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHomeTabs);
} else {
    initHomeTabs();
}