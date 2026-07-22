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

const databases = new Databases(client);
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
        ]).then(r => {
            if (r && Array.isArray(r.documents)) {
                posts = r.documents.map(p => ({ ...p, type: 'post' }));
            }
        }).catch(err => console.warn('D1 帖子拉取失败:', err.message)),

        databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, [
            Query.equal('status', 0),
            Query.orderDesc('$createdAt'),
            Query.limit(30)
        ]).then(r => {
            if (r && Array.isArray(r.documents)) {
                confessions = r.documents.map(c => ({ ...c, type: 'confession' }));
            }
        }).catch(err => console.warn('D1 表白墙拉取失败:', err.message)),

        fetch('/api/events').then(r => r.ok ? r.json() : []).then(data => {
            if (Array.isArray(data)) {
                events = data.map(e => ({ ...e, type: 'event', $createdAt: e.date }));
            }
        }).catch(() => {})
    ]);

    if (!posts.length) {
        try {
            const res = await fetch('/data-fallback/posts.json');
            if (res.ok) {
                const fallbackPosts = await res.json();
                posts = (fallbackPosts || []).map(p => ({ ...p, type: 'post' }));
            }
        } catch (e) {
            console.warn('Posts 兜底数据读取失败:', e);
        }
    }

    if (!confessions.length) {
        try {
            const res = await fetch('/data-fallback/confessions.json');
            if (res.ok) {
                const fallbackConf = await res.json();
                confessions = (fallbackConf || []).map(c => ({ ...c, type: 'confession' }));
            }
        } catch (e) {
            console.warn('Confessions 兜底数据读取失败:', e);
        }
    }

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
                <span class="post-stat" aria-label="点赞数" style="display: flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/>
                    </svg>
                    ${Number(item.likes || 0)}
                </span>
                <span class="post-stat" aria-label="评论数" style="display: flex; align-items: center; gap: 4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M2 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h9.586a2 2 0 0 1 1.414.586l2 2V2a1 1 0 0 0-1-1H2zm12-1a2 2 0 0 1 2 2v12.793a.5.5 0 0 1-.854.353l-2.853-2.853a1 1 0 0 0-.707-.293H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h12z"/>
                    </svg>
                    ${Number(item.commentCount || 0)}
                </span>
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
    
    await loadHomeContent({ forceRefresh: true });

    // 首页多功能 FAB + 悬浮菜单与弹窗逻辑
    const multiFabBtn = document.getElementById('fabHomeMultiBtn');
    const choiceMenu = document.getElementById('fabChoiceMenu');
    const btnOpenPost = document.getElementById('btnOpenHomePost');
    const btnOpenConfession = document.getElementById('btnOpenHomeConfession');
    const btnOpenEvent = document.getElementById('btnOpenHomeEvent');

    const postModal = document.getElementById('homePostModal');
    const closePostModalBtn = document.getElementById('closeHomePostModal');
    const submitPostBtn = document.getElementById('submitHomePostBtn');

    const confessionModal = document.getElementById('homeConfessionModal');
    const closeConfessionModalBtn = document.getElementById('closeHomeConfessionModal');
    const submitConfessionBtn = document.getElementById('submitHomeConfessionBtn');

    const eventModal = document.getElementById('homeEventModal');
    const closeEventModalBtn = document.getElementById('closeHomeEventModal');
    const submitEventBtn = document.getElementById('submitHomeEventBtn');

    if (multiFabBtn && choiceMenu) {
        multiFabBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!localStorage.getItem('campus_user')) {
                location.href = 'login.html';
                return;
            }
            const isHidden = choiceMenu.style.display === 'none' || getComputedStyle(choiceMenu).display === 'none';
            choiceMenu.style.display = isHidden ? 'flex' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!choiceMenu.contains(e.target) && !multiFabBtn.contains(e.target)) {
                choiceMenu.style.display = 'none';
            }
        });
    }

    if (btnOpenPost && postModal) {
        btnOpenPost.addEventListener('click', () => {
            if (choiceMenu) choiceMenu.style.display = 'none';
            postModal.style.display = 'flex';
        });
    }
    if (closePostModalBtn && postModal) {
        closePostModalBtn.addEventListener('click', () => postModal.style.display = 'none');
    }
    if (submitPostBtn) {
        submitPostBtn.addEventListener('click', async () => {
            const title = document.getElementById('homePostTitle')?.value.trim();
            const content = document.getElementById('homePostContent')?.value.trim();
            if (!title || !content) {
                alert('请填写完整的标题和内容');
                return;
            }
            submitPostBtn.disabled = true;
            submitPostBtn.textContent = '正在发布...';
            try {
                const res = await fetch('/api/create-post', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-LG-Token': currentUser?.appToken || '',
                        'X-Appwrite-Session': currentUser?.token || ''
                    },
                    body: JSON.stringify({ title, content, boardIds: ['main'] })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    alert('帖子发布成功！');
                    postModal.style.display = 'none';
                    await loadHomeContent({ forceRefresh: true });
                } else {
                    alert(data.error || '发布失败');
                }
            } catch (err) {
                alert('网络连接失败');
            } finally {
                submitPostBtn.disabled = false;
                submitPostBtn.textContent = '发布帖子';
            }
        });
    }

    if (btnOpenConfession && confessionModal) {
        btnOpenConfession.addEventListener('click', () => {
            if (choiceMenu) choiceMenu.style.display = 'none';
            confessionModal.style.display = 'flex';
        });
    }
    if (closeConfessionModalBtn && confessionModal) {
        closeConfessionModalBtn.addEventListener('click', () => confessionModal.style.display = 'none');
    }

    const homeConfessionContent = document.getElementById('homeConfessionContent');
    const homeConfessionCharCount = document.getElementById('homeConfessionCharCount');
    if (homeConfessionContent && homeConfessionCharCount) {
        homeConfessionContent.addEventListener('input', () => {
            homeConfessionCharCount.textContent = homeConfessionContent.value.length;
        });
    }

    if (submitConfessionBtn && homeConfessionContent) {
        submitConfessionBtn.addEventListener('click', async () => {
            const content = homeConfessionContent.value.trim();
            if (content.length < 2) {
                alert('内容太少了');
                return;
            }
            submitConfessionBtn.disabled = true;
            submitConfessionBtn.textContent = '正在提交...';
            try {
                const res = await fetch('/api/create-confession', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    alert('匿名表白发布成功！');
                    confessionModal.style.display = 'none';
                    await loadHomeContent({ forceRefresh: true });
                } else {
                    alert(data.error || '表白发布失败');
                }
            } catch (err) {
                alert('网络连接失败');
            } finally {
                submitConfessionBtn.disabled = false;
                submitConfessionBtn.textContent = '匿名发布';
            }
        });
    }

    if (btnOpenEvent && eventModal) {
        btnOpenEvent.addEventListener('click', () => {
            if (choiceMenu) choiceMenu.style.display = 'none';
            eventModal.style.display = 'flex';
        });
    }
    if (closeEventModalBtn && eventModal) {
        closeEventModalBtn.addEventListener('click', () => eventModal.style.display = 'none');
    }
    if (submitEventBtn) {
        submitEventBtn.addEventListener('click', async () => {
            const content = document.getElementById('homeEventContent')?.value.trim();
            if (!content || content.length < 5) {
                alert('描述内容至少需要 5 个字');
                return;
            }
            submitEventBtn.disabled = true;
            submitEventBtn.textContent = 'AI 审核中...';
            try {
                const res = await fetch('/api/events-submit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-LG-Token': currentUser?.appToken || '',
                        'X-Appwrite-Session': currentUser?.token || ''
                    },
                    body: JSON.stringify({
                        studentId: currentUser?.studentId,
                        content
                    })
                });
                const data = await res.json();
                if (res.ok) {
                    alert('大事记投稿成功！提交初审完成');
                    eventModal.style.display = 'none';
                    await loadHomeContent({ forceRefresh: true });
                } else {
                    alert(data.error || '投稿失败');
                }
            } catch (err) {
                alert('网络错误，请稍后再试');
            } finally {
                submitEventBtn.disabled = false;
                submitEventBtn.textContent = '提交大事记';
            }
        });
    }

    window.addEventListener('userLoginSuccess', async () => {
        if (currentUser) {
            await loadHomeContent({ forceRefresh: true });
        }
    });

    setupPullToRefresh({
        onRefresh: async () => {
            await loadHomeContent({ forceRefresh: true });
        }
    });
})();