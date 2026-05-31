import { Client, Databases, Query, Account } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

// ========== Appwrite 配置 ==========
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = 'lg';
const DATABASE_ID = 'lg';
const COLLECTION_POSTS = 'posts';
const COLLECTION_CONFESSIONS = 'confessions';
const COLLECTION_USERS = 'users';

// ========== 安全密钥 配置 (与 posts.js 保持一致) ==========
const ENCRYPT_KEY = '176ec04db0ffc0e689e2e36b40e6c68a528b4179339fbaad8bdd12bf63597eec';

// 初始化 Appwrite
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

let databases;
let currentUser = null;

// ========== 核心：解密函数（失败返回 null，不返回脏数据） ==========
async function decryptText(encryptedText) {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
    
    // 🌟 直接读取存放在内存黑盒或 IndexedDB 里的不透明钥匙对象
    const cryptoKey = window.secureKeyBlackBox; 
    if (!cryptoKey) {
        console.warn("未发现安全密钥，拒绝解密");
        return null;
    }
    
    const parts = encryptedText.split(':');
    const ivHex = parts[0];
    const cipherHex = parts.slice(1).join(':');
    
    const iv = new Uint8Array(ivHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    const ciphertext = new Uint8Array(cipherHex.match(/.{2}/g).map(b => parseInt(b, 16)));
    
    try {
        // 🚀 浏览器在黑盒内部完成解密，密钥字节从未暴露给 JS 上下文
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv }, 
            cryptoKey, // 👈 传入这个不可导出的对象即可
            ciphertext
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.warn('解密失败。');
        return null;
    }
}

// ========== 初始化入口 ==========
(async function init() {
    try {
        // 🌟 核心一步：从数据库里无感请出那把“不可导出”的黑盒钥匙对象
        const cryptoKey = await localforage.getItem('secure_gate_key');
        
        if (cryptoKey) {
            // 挂载到全局变量，供底层的 decryptText() 函数直接闭包消费
            window.secureKeyBlackBox = cryptoKey;
            console.log("🏔️ 硬件级安全密钥已成功从本地 IndexedDB 唤醒并挂载！");
        } else {
            console.warn("⚠️ 本地未发现安全密钥，私密内容可能无法解密，建议重新登录。");
        }
    } catch (dbError) {
        console.error("读取本地安全数据库失败:", dbError);
    }
    const account = new Account(client);

    try {
        // 尝试自动恢复长效会话
        const user = await account.get();
        console.log('✅ 已登录:', user.$id);
        const saved = JSON.parse(localStorage.getItem('campus_user') || '{}');
        currentUser = {
            studentId: saved.studentId || user.$id.replace('student_', ''),
            userId: user.$id,
            token: saved.token
        };
    } catch {
        // 未登录，自动创建匿名会话以便读取公开内容
        try {
            await account.createAnonymousSession();
            console.log('👻 匿名游客访问');
        } catch (e) {
            console.warn('匿名会话创建失败');
        }
    }

    databases = new Databases(client);
    checkLoginStatus();
    
    // ⚡ 独立并行启动两路缓存加持的加载流水线
    loadHomePosts();        
    loadHomeConfessions();  
})();

// ========== 检查并同步登录状态 UI ==========
function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');

    if (userData && currentUser) {
        if (userNotLogin) userNotLogin.style.display = 'none';
        if (userLoggedIn) userLoggedIn.style.display = 'flex';
        
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = `学号尾号 ${currentUser.studentId.slice(-4)}`;
        if (userAvatarEl) userAvatarEl.textContent = currentUser.studentId.charAt(0);
    } else {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
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
    const isAuthor = currentUser && currentUser.studentId && post.authorId && (post.authorId === currentUser.studentId);
    
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

// ========== 【高级缓存重构】加载首页帖子（最新5条） ==========
async function loadHomePosts() {
    const postList = document.getElementById('postList');
    if (!postList) return;

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_home_posts_${currentUserId}`;
    const localCache = localStorage.getItem(cacheKey);
    let hasRenderedCache = false;

    // 【步骤 1】秒开快速捞取本地缓存快照
    if (localCache) {
        try {
            const parsed = JSON.parse(localCache);
            if (parsed && Array.isArray(parsed.data)) {
                renderHomePosts(parsed.data);
                showHomeCacheNotice(postList, 'postCacheNotice', '⚡ 已载入本地动态快照，正在校验云端...', 'waiting');
                hasRenderedCache = true;
            }
        } catch (e) {
            console.warn('读取首页帖子缓存失败:', e);
        }
    }

    if (!hasRenderedCache) {
        postList.innerHTML = '<div class="loading-state">加载中...</div>';
    }

    // 【步骤 2】后台并行洗流热、冷数据
    let hotPosts = [];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, [
            Query.orderDesc('$createdAt'),
            Query.limit(25) // 取25条确保过滤后足够填满前5条
        ]);
        hotPosts = response.documents;
    } catch (e) {
        console.warn('云端热帖子加载失败，仅检索备份:', e.message);
    }

    let coldPosts = [];
    try {
        const url = './public/data-backups/posts.json';
        const res = await fetch(url);
        if (res.ok) {
            const backupData = await res.json();
            let docs = backupData.documents || backupData || [];
            
            if (backupData.encrypted) {
                docs = await Promise.all(docs.map(async post => {
                    let targetGroups = [];
                    if (post.targetGroups !== '已隐藏') {
                        const decrypted = await decryptText(post.targetGroups);
                        try { targetGroups = JSON.parse(decrypted || '[]'); } catch { targetGroups = []; }
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
        console.log('无冷备份帖子数据', e);
    }

    // 【步骤 3】数据格式归一化映射
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
        likes: post.likes || 0,
        commentCount: post.commentCount || 0,
        _isCold: isCold
    });

    const normalizedHot = hotPosts.map(p => normalizePost(p, false));
    const normalizedCold = coldPosts.map(p => normalizePost(p, true));

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
    localStorage.setItem(cacheKey, JSON.stringify({ data: finalHomePosts, ts: Date.now() }));

    if (hasRenderedCache) {
        showHomeCacheNotice(postList, 'postCacheNotice', '✨ 动态流已实时同步至最新', 'success');
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
        
        return `
            <div class="post-card" onclick="location.href='post.html?id=${post.$id}'">
                <div class="post-header">
                    <div class="post-avatar">${post.authorName?.charAt(0) || '?'}</div>
                    <div>
                        <div class="post-author">${escapeHtml(post.authorName || '匿名')}</div>
                        <div class="post-time">${timeStr} · ${formatBoardName(post.boardId)}</div>
                    </div>
                </div>
                <div class="post-title">${isPinned ? '📌 ' : ''}${escapeHtml(post.title || '无标题')}</div>
                <div class="post-content">${escapeHtml((post.content || '').slice(0, 100))}${post.content?.length > 100 ? '...' : ''}</div>
                <div class="post-footer">
                    <span class="post-action">👍 ${post.likes || 0}</span>
                    <span class="post-action">💬 ${post.commentCount || 0} 评论</span>
                </div>
            </div>
        `;
    }).join('');
}

// ========== 【高级缓存重构】加载首页表白墙（最新10条） ==========
async function loadHomeConfessions() {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_home_confessions_${currentUserId}`;
    const localCache = localStorage.getItem(cacheKey);
    let hasRenderedCache = false;

    // 【步骤 1】捞取本地缓存快照
    if (localCache) {
        try {
            const parsed = JSON.parse(localCache);
            if (parsed && Array.isArray(parsed.data)) {
                renderHomeConfessions(parsed.data);
                showHomeCacheNotice(confessionList, 'confessionCacheNotice', '⚡ 已载入历史手札，正在同步最新心动...', 'waiting');
                hasRenderedCache = true;
            }
        } catch (e) {
            console.warn('读取首页表白缓存失败:', e);
        }
    }

    if (!hasRenderedCache) {
        confessionList.innerHTML = '<div class="loading-state">装载中...</div>';
    }

    // 【步骤 2】并行加载清洗热数据与冷备份
    let hotConfessions = [];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, [
            Query.equal('status', 0),
            Query.orderDesc('$createdAt'),
            Query.limit(20)
        ]);
        hotConfessions = response.documents;
    } catch (e) {
        console.warn('云端实时表白拉取失败:', e.message);
    }

    let coldConfessions = [];
    try {
        const url = './public/data-backups/confessions.json';
        const res = await fetch(url);
        if (res.ok) {
            const backupData = await res.json();
            let docs = backupData.documents || backupData || [];

            if (backupData.encrypted) {
                docs = await Promise.all(docs.map(async c => ({
                    ...c,
                    content: await decryptText(c.content), 
                    authorName: await decryptText(c.authorName)
                })));
            }
            coldConfessions = docs;
        }
    } catch (e) {
        console.log('未发现表白冷备份数据', e);
    }

    // 【步骤 3】清洗格式、全局去重并硬性隔离错密脏数据
    const normalizeConfession = (c) => ({
        $id: c.$id || c.id,
        $createdAt: c.$createdAt || c.createdAt,
        content: c.content,
        authorName: c.authorName || '匿名',
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
    localStorage.setItem(cacheKey, JSON.stringify({ data: finalConfessions, ts: Date.now() }));

    if (hasRenderedCache) {
        showHomeCacheNotice(confessionList, 'confessionCacheNotice', '✨ 表白手札已完成同步更新', 'success');
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
                <span>😶 匿名</span>
                <span>${formatTime(new Date(c.$createdAt))}</span>
            </div>
        </div>
    `).join('');
}

// ========== 公用工具函数 ==========
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
    if (boardId === 'main') return '主板块';
    const match = boardId.match(/^class_(\d{4})_(\d+)$/);
    if (match) return `${match[1]}届${match[2]}班`;
    return boardId;
}

// 防止 XSS 注入
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}