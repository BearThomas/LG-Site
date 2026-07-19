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
    loadUserDirectory,
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

// ========== 初始化入口（彻底洗白：移除 account.get 401 及 501 报错） ==========
(async function init() {
    

    // 【步骤 1】：清理旧版本遗留的浏览器端备份密钥
    secureKeyReady = restoreSecureKey();

    // 【步骤 2】：完全脱离原厂 SDK 鉴权，直接就地盘查本地中转凭证黑盒
    const userData = localStorage.getItem('campus_user');
    if (userData) {
        try {
            const saved = JSON.parse(userData);
            if (saved && saved.authVersion === 2 && saved.studentId) {
                currentUser = {
                    studentId: saved.studentId,
                    userId: saved.userId || `student_${saved.studentId}`,
                    token: saved.token,
                    name: saved.name || '同学'
                };
                
            } else {
                localStorage.removeItem('campus_user');
            }
        } catch (e) {
            console.warn('解析本地用户凭证失败:', e);
        }
    } else {
        
    }

    // 【步骤 3】：只初始化只读数据库客户端，完全不执行会导致 401/501 的 account 握手
    databases = new Databases(client);
    
    // 渲染用户状态 UI
    checkLoginStatus();
    bindHomeActions();
    await Promise.all([loadHomeUsers(), loadHomePosts(), loadHomeConfessions()]);
    setupPullToRefresh({
        onRefresh: async () => {
            await Promise.all([
                loadHomeUsers(),
                loadHomePosts({ forceRefresh: true }),
                loadHomeConfessions({ forceRefresh: true })
            ]);
        }
    });
})();

// ========== 检查并同步登录状态 UI ==========
function checkLoginStatus() {
    // 顶栏登录状态与昵称/头像已全部由全局 js/nav-bar.js 集中异步托管，此处置空以防冲突覆盖
}

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

async function loadHomeUsers() {
    try {
        const directory = await loadUserDirectory(databases, Query);
        userCache = directory.userCache;
    } catch (error) {
        console.warn('首页用户快照加载失败，帖子作者信息将降级显示:', error.message);
    }
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
    // 🛡️ 边界断路器：只要帖子核心字段解密出 null，说明密钥错误，直接人间蒸发
    if (post.title === null || post.content === null) return false;

    const viewPermission = Number(post.viewPermission) || 1;
    // 🛡️ 堵死原代码明文下的 undefined === undefined 访客越权伪装作者漏洞
    const isAuthor = currentUser && currentUser.studentId && post.authorId &&
        normalizeUserId(post.authorId) === normalizeUserId(currentUser.studentId);
    
    if (viewPermission === 1) return true; // 所有人可见
    if (viewPermission === 8) return isAuthor; // 仅作者可见
    if (viewPermission === 2) { // 板块成员可见
        if (!currentUser) return false;
        return userBoards.includes(post.boardId);
    }
    if (viewPermission === 4) { // 指定群组/用户可见
        if (!currentUser) return false;
        const targetGroups = post.targetGroups || [];
        return targetGroups.includes(currentUser.studentId) || targetGroups.some(group => userBoards.includes(group));
    }
    return false;
}

// ========== 缓存状态同步提示条控制 ==========
function showHomeCacheNotice(containerEl, noticeId, message, type = 'waiting') {
    if (!containerEl) return;
    document.getElementById(noticeId)?.remove(); // 规避重复渲染

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

// ========== [高级缓存重构]加载首页帖子（最新或5条） ==========
async function loadHomePosts({ forceRefresh = false } = {}) {
    const postList = document.getElementById('postList');
    if (!postList) return;

    // Fetch tombstones + version (fire and forget, best-effort)
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
    } catch { /* non-critical */ }

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_home_posts_${currentUserId}`;
    const localCache = forceRefresh ? null : localStorage.getItem(cacheKey);
    let hasRenderedCache = false;

    // 【步骤 1】秒开快速捞取本地缓存快照
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

    // [步骤 2]后台并行洗流热、冷数据
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
        if (!hasRenderedCache && hotPosts.length) {
            const quickPosts = hotPosts
                .filter(p => p.title != null && p.content != null && (Number(p.viewPermission) || 1) === 1)
                .filter(p => !tombstones.posts.has(p.$id || p.id))
                .slice(0, 5);
            if (quickPosts.length) {
                renderHomePosts(quickPosts);
                showHomeCacheNotice(postList, 'postCacheNotice', '最新内容已显示，正在后台整理历史数据...', 'waiting');
                hasRenderedCache = true;
            }
        }
    } else {
        console.warn('云端热帖子加载失败，仅检索备份:', hotResult.reason?.message);
    }
    if (coldResult.status === 'fulfilled') {
        coldPosts = coldResult.value || [];
    }

    // [步骤 3]数据格式归一化映射
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

    // 【步骤 4】全局去重合并、依照绝对时序重排列
    const seen = new Set();
    const allPosts = [...normalizedHot, ...normalizedCold].filter(p => {
        if (seen.has(p.$id)) return false;
        seen.add(p.$id);
        return true;
    });

    allPosts.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));

    // 【步骤 5】通过严格的前端鉴权锁，截取最新前5条
    const userBoards = currentUser ? await getUserJoinedBoards() : ['main'];
    const visiblePosts = allPosts.filter(post => isPostVisible(post, userBoards));
    const finalHomePosts = visiblePosts.slice(0, 5);

    // 【步骤 6】复写 DOM 并刷新高速缓存
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
            <div class="post-card" onclick="location.href='post.html?id=${post.$id}'">
                <div class="post-header">
                    <div class="post-avatar" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer;">${avatarHtml}</div>
                    <div>
                        <div class="post-author" onclick="window.goToUserProfile('${author.cleanAuthorId || author.id}', event)" style="cursor: pointer;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${author.name}</div>
                        <div class="post-time">${timeStr} · ${formatBoardName(post.boardId)}</div>
                    </div>
                </div>
                <div class="post-title">${isPinned ? ' ' : ''}${escapeHtml(post.title || '无标题')}</div>
                <div class="post-content">${escapeHtml(markdownToPreview(post.content, 100))}</div>
                <div class="post-footer">
                    <span class="post-action"> ${post.commentCount || 0} 评论</span>
                </div>
            </div>
        `;
    }).join('');
}

// ========== 【高级缓存重构】加载首页表白墙（最新10条） ==========
async function loadHomeConfessions({ forceRefresh = false } = {}) {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_home_confessions_${currentUserId}`;
    const localCache = forceRefresh ? null : localStorage.getItem(cacheKey);
    let hasRenderedCache = false;

    // 【步骤 1】捞取本地缓存快照
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

    // 【步骤 2】并行加载清洗热数据与冷备份
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
        if (!hasRenderedCache) {
            const quickConfessions = hotConfessions.filter(item =>
                item.content != null && Number(item.status || 0) === 0
            ).slice(0, 10);
            if (quickConfessions.length) {
                renderHomeConfessions(quickConfessions);
                showHomeCacheNotice(confessionList, 'confessionCacheNotice', '最新内容已显示，正在后台整理历史数据...', 'waiting');
                hasRenderedCache = true;
            }
        }
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
        } catch (e) {
            
        }
    }

    // 【步骤 3】清洗格式、全局去重并硬性隔离错密脏数据
    const normalizeConfession = (c) => ({
        $id: c.$id || c.id,
        $createdAt: c.$createdAt || c.createdAt,
        content: c.content,
        
        authorName: (() => {
            let n = escapeHtml(c.authorName || '匿名');
            let sid = (c.authorId || c.studentId || '').toString().replace(/^student_/, '').trim();
            if (sid.length >= 4) n = `${n}<span class="year-badge">${sid.substring(0, 4)}届</span>`;
            return n;
        })(),

        status: c.status !== undefined ? c.status : 0
    });

    const seenIds = new Set();
    const allConfessions = [
        ...hotConfessions.map(c => normalizeConfession(c)),
        ...coldConfessions.map(c => normalizeConfession(c))
    ].filter(c => {
        // 🛡️ 错密脏数据防御：只要正文为 null 证明解密完全失败，或者是已标记下架状态，直接滤除
        if (c.content === null || c.status !== 0) return false;
        if (seenIds.has(c.$id)) return false;
        seenIds.add(c.$id);
        return true;
    });

    // 【步骤 4】严格时序重排，切片取前 10 条
    allConfessions.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));
    const finalConfessions = allConfessions.slice(0, 10);

    // 【步骤 5】洗版展现并刷新缓存
    renderHomeConfessions(finalConfessions);
    scheduleAfterPaint(() => {
        localStorage.setItem(cacheKey, JSON.stringify({ data: finalConfessions, ts: Date.now() }));
    });

    if (hasRenderedCache) {
        showHomeCacheNotice(confessionList, 'confessionCacheNotice', '表白手札已完成同步更新', 'success');
    }
}

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
    confessionList.innerHTML = confessions.map(c => `
        <div class="confession-card">
            <div class="confession-text">${escapeHtml(c.content)}</div>
            <div class="confession-footer">
                <span>${formatTime(new Date(c.$createdAt))}</span>
            </div>
        </div>
    `).join('');
}
