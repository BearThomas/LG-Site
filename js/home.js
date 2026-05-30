// index.html 中的 <script> 部分
// 放在 home-interactions.js 或直接内联

import { Client, Databases, Query,  Account } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

// ========== Appwrite 配置 ==========
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = 'lg';
const DATABASE_ID = 'lg';
const COLLECTION_POSTS = 'posts';
const COLLECTION_CONFESSIONS = 'confessions';
const COLLECTION_USERS = 'users';

// import { Client, Databases, Query, Account } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

let databases;
let currentUser = null;

(async function init() {
    const account = new Account(client);

    try {
        // 尝试获取当前用户（登录过的设备会自动恢复）
        const user = await account.get();
        console.log('✅ 已登录:', user.$id);
        // 从 localStorage 补充学号信息
        const saved = JSON.parse(localStorage.getItem('campus_user') || '{}');
        currentUser = {
            studentId: saved.studentId || user.$id.replace('student_', ''),
            userId: user.$id
        };
    } catch {
        // 未登录，创建匿名会话
        try {
            await account.createAnonymousSession();
            console.log('👻 匿名游客');
        } catch (e) {
            console.warn('匿名会话创建失败');
        }
    }

    databases = new Databases(client);
    checkLoginStatus();
    loadHomePosts();
    loadHomeConfessions();
})();


// 初始化
// const client = new Client()
//     .setEndpoint(APPWRITE_ENDPOINT)
//     .setProject(APPWRITE_PROJECT_ID);

// // const databases = new Databases(client);
// let databases;
// // 全局状态
// let currentUser = null;

// ========== 初始化 ==========
// document.addEventListener('DOMContentLoaded', async () => {
//     // 1. 核心安全修改：绝对不要上来就抢跑发请求！
//     console.log("⏳ 首页加载，正在等待长效会话守护就绪...");
    
//     // 2. 检查全局保活模块是否初始化完成
//     // 我们可以给它加一个双保险：确保 initAutoAuth 执行完毕后再发请求
//     // if (window.initAutoAuth) {
//     //     try {
//     //         // 等待 auto-auth.js 内部逻辑走完（不管是读取本地还是从后端换取到了最新 Token）
//     //         await window.initAutoAuth(); 
//     //         console.log("✓ 会话守护已就绪，Thomas，开始安全加载首页内容。");
//     //     } catch (e) {
//     //         console.error("会话初始化异常，降级以访客身份加载:", e);
//     //     }
//     // }

//     // // 3. 此时 Token 已经是最新最热乎的了，再安全地去拿数据
//     // checkLoginStatus();
//     // await getUserJoinedBoards();
//     // await loadHomePosts();
//     // await loadHomeConfessions();
//     // // bindEvents();
//     const userData = localStorage.getItem('campus_user');
//     if (userData) {
//         const user = JSON.parse(userData);
//         client.setJWT(user.token);
//     }
//     if (userData) {
//         const user = JSON.parse(userData);
//         client.setJWT(user.token);
//         console.log('🔑 已设置 JWT:', user.token?.slice(0, 30) + '...');
//     }
//     databases = new Databases(client);

//     checkLoginStatus();
//     loadHomePosts();
//     loadHomeConfessions();
// });
// document.addEventListener('DOMContentLoaded', async () => {
//     // ⭐ 用 session secret 恢复会话
//     const savedUser = localStorage.getItem('campus_user');
//         if (savedUser) {
//             const user = JSON.parse(savedUser);
//             client.setJWT(user.token);  // token 就是 session.secret
//             console.log('✅ 设置 token:', user.token.slice(0, 30));
//         }
//         databases = new Databases(client);
//         checkLoginStatus();
//         loadHomePosts();
//         loadHomeConfessions();
// });
// const client = new Client()
//     .setEndpoint(APPWRITE_ENDPOINT)
//     .setProject(APPWRITE_PROJECT_ID);

// let databases;
// let currentUser = null;

// 页面加载时自动执行
// (async function init() {
//     const savedUser = localStorage.getItem('campus_user');
//     if (!savedUser) {
//         console.log('未找到登录信息，以访客身份浏览。');
//         databases = new Databases(client);
//         return;
//     }

//     const user = JSON.parse(savedUser);
    
//     // 1. 先用短期JWT初始化客户端，以证明身份
//     client.setJWT(user.token);
//     console.log('✅ 短期JWT已设置，准备升级为长期会话...');

//     try {
//         const account = new Account(client);
        
//         // 2. 在创建新会话前，先尝试删除可能存在的旧会话
//         try {
//             await account.deleteSession('current');
//             console.log('🧹 已清理旧的当前会话。');
//         } catch (deleteError) {
//             // 如果删除失败（例如没有旧会话），我们忽略此错误并继续
//             console.log('ℹ️ 没有需要清理的旧会话，或清理失败。');
//         }

//         // 3. 现在，安全地用短期JWT创建一个新的、长期有效的会话
//         await account.createSession(user.studentId, user.token);
//         console.log('✅ 长期会话创建成功，无需担心过期！');
        
//     } catch (error) {
//         console.warn('创建长期会话失败，将使用短期JWT:', error);
//         // 如果失败，仍然可以尝试用JWT继续
//     }

//     databases = new Databases(client);
//     checkLoginStatus();
//     loadHomePosts();
//     loadHomeConfessions();
// })();

// (async function init() {
//     const savedUser = localStorage.getItem('campus_user');

//     if (savedUser) {
//         // 已登录用户：用 JWT 恢复会话
//         const user = JSON.parse(savedUser);
//         client.setJWT(user.token);
//         console.log('✅ 已登录用户');
//     }
//     // } else {
//     //     // ⭐ 游客：创建匿名会话
//     //     const account = new Account(client);
//     //     try {
//     //         await account.createAnonymousSession();
//     //         console.log('👻 匿名会话已创建，游客可浏览公开内容');
//     //     } catch (e) {
//     //         console.warn('匿名会话创建失败，可能无法加载数据');
//     //     }
//     // }

//     databases = new Databases(client);
//     checkLoginStatus();
//     loadHomePosts();
//     loadHomeConfessions();
// })();

function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');

    if (userData) {
        currentUser = JSON.parse(userData);
        
        // ⭐ 直接设置
        if (currentUser.token) {
            client.setJWT(currentUser.token);
        }

        userNotLogin.style.display = 'none';
        userLoggedIn.style.display = 'flex';
        document.getElementById('userName').textContent = `学号尾号 ${currentUser.studentId.slice(-4)}`;
        document.getElementById('userAvatar').textContent = currentUser.studentId.charAt(0);
    } else {
        userNotLogin.style.display = 'flex';
        userLoggedIn.style.display = 'none';
    }
}

// ========== 获取用户已加入的板块 ==========
async function getUserJoinedBoards() {
    if (!currentUser) return ['main'];
    // const latestJwt = localStorage.getItem('persistent_jwt');
    //     if (latestJwt && typeof client !== 'undefined') {
    //         client.setJWT(latestJwt); 
    //     }
    
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_USERS, [
            Query.equal('userId', currentUser.studentId)
        ]);
        
        if (response.documents.length > 0) {
            return response.documents[0].joinedBoards || ['main'];
        }
    } catch (e) {
        console.warn('获取用户板块失败:', e);
    }
    
    return ['main'];
}

// ========== 检查帖子是否对当前用户可见 ==========
function isPostVisible(post, userBoards) {
    // const latestJwt = localStorage.getItem('persistent_jwt');
    //     if (latestJwt && typeof client !== 'undefined') {
    //         client.setJWT(latestJwt); 
    //     }
    const viewPermission = post.viewPermission || 1;
    const isAuthor = currentUser && currentUser.studentId === post.authorId;
    
    // 1 = 所有人可见
    if (viewPermission === 1) return true;
    
    // 8 = 仅作者可见
    if (viewPermission === 8) return isAuthor;
    
    // 2 = 板块成员可见
    if (viewPermission === 2) {
        if (!currentUser) return false;
        return userBoards.includes(post.boardId);
    }
    
    // 4 = 指定群组可见（需要 targetGroups）
    if (viewPermission === 4) {
        if (!currentUser) return false;
        const targetGroups = post.targetGroups || [];
        return targetGroups.some(group => userBoards.includes(group));
    }
    
    return false;
}

// ========== 加载首页帖子（最新5条） ==========
async function loadHomePosts() {
    const postList = document.getElementById('postList');
    if (!postList) return;
    postList.innerHTML = '<div class="loading-state">加载中...</div>';

    const currentUserId = currentUser?.studentId;

    // ========== 1. 先加载热数据 ==========
    let hotPosts = [];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, [
            Query.orderDesc('$createdAt'),
            Query.limit(20)
        ]);
        hotPosts = response.documents;
    } catch (e) {
        console.warn('热数据加载失败，等待冷备份...');
        postList.innerHTML = '<div class="loading-state">正在从备份加载...</div>';
    }

    // 过滤 + 渲染热数据
    const userBoards = currentUser ? await getUserJoinedBoards() : ['main'];
    const visibleHot = hotPosts.filter(post => isPostVisible(post, userBoards)).slice(0, 5);
    renderHomePosts(visibleHot);

    // ========== 2. 后台加载冷备份 ==========
    loadColdPostsForHome(currentUserId, visibleHot, userBoards);
}

async function loadColdPostsForHome(currentUserId, existingPosts, userBoards) {
    try {
        const url = 'https://cdn.jsdelivr.net/gh/BearThomas/LG-Site-Backup@main/backups/last/posts.json';
        const res = await fetch(url);
        if (!res.ok) return;

        const backupData = await res.json();
        let coldPosts = backupData.documents || backupData || [];
        console.log(`从冷备份获取到 ${coldPosts.length} 条帖子`);
        // 解密
        if (backupData.encrypted) {
            coldPosts = await Promise.all(coldPosts.map(async post => ({
                ...post,
                content: await decryptColdData(post.content),
                title: await decryptColdData(post.title),
                authorName: await decryptColdData(post.authorName),
                targetGroups: JSON.parse(await decryptColdData(post.targetGroups) || '[]')
            })));
        }

        // 去重
        const existingIds = new Set(existingPosts.map(p => p.$id || p.id));
        const newPosts = coldPosts
            .map(p => ({ ...p, $id: p.$id || p.id, $createdAt: p.$createdAt || p.createdAt }))
            .filter(p => !existingIds.has(p.$id) && isPostVisible(p, userBoards))
            .slice(0, 5 - existingPosts.length);

        if (newPosts.length > 0) {
            appendHomePosts(newPosts);
        }
    } catch (e) {
        console.log('无冷备份数据');
    }
}

function appendHomePosts(posts) {
    const postList = document.getElementById('postList');
    if (!postList || !posts.length) return;

    const html = posts.map(post => {
        const timeStr = formatTime(new Date(post.$createdAt));
        return `
            <div class="post-card" onclick="location.href='post.html?id=${post.$id}'">
                <div class="post-header">
                    <div class="post-avatar">${(post.authorName || '?').charAt(0)}</div>
                    <div>
                        <div class="post-author">${escapeHtml(post.authorName || '匿名')}</div>
                        <div class="post-time">${timeStr}</div>
                    </div>
                </div>
                <div class="post-title">${escapeHtml(post.title || '')}</div>
                <div class="post-content">${escapeHtml((post.content || '').slice(0, 100))}</div>
            </div>
        `;
    }).join('');

    postList.insertAdjacentHTML('beforeend', html);
}

function renderHomePosts(posts) {
    // const latestJwt = localStorage.getItem('persistent_jwt');
    //     if (latestJwt && typeof client !== 'undefined') {
    //         client.setJWT(latestJwt); 
    //     }
    const postList = document.getElementById('postList');
    
    if (!posts.length) {
        postList.innerHTML = `
            <div class="empty-state">
                <p>暂无帖子，<a href="posts.html">去发帖</a></p>
            </div>
        `;
        return;
    }
    
    postList.innerHTML = posts.map(post => {
        const createdAt = new Date(post.$createdAt);
        const timeStr = formatTime(createdAt);
        const isPinned = (post.status & 1) !== 0;
        
        return `
            <div class="post-card" onclick="location.href='post.html?id=${post.$id}'">
                <div class="post-header">
                    <div class="post-avatar">${post.authorName?.charAt(0) || '?'}</div>
                    <div>
                        <div class="post-author">${escapeHtml(post.authorName || '匿名')}</div>
                        <div class="post-time">${timeStr} · ${formatBoardName(post.boardId)}</div>
                    </div>
                </div>
                <div class="post-title">${isPinned ? '📌 ' : ''}${escapeHtml(post.title)}</div>
                <div class="post-content">${escapeHtml(post.content.slice(0, 100))}${post.content.length > 100 ? '...' : ''}</div>
                <div class="post-footer">
                    <span class="post-action">👍 ${post.likes || 0}</span>
                    <span class="post-action">💬 ${post.commentCount || 0} 评论</span>
                </div>
            </div>
        `;
    }).join('');
}

async function loadHomeConfessions() {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;

    // ========== 1. 先加载热数据 ==========
    let hotConfessions = [];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, [
            Query.equal('status', 0),
            Query.orderDesc('$createdAt'),
            Query.limit(10)
        ]);
        hotConfessions = response.documents;
    } catch (e) {
        console.warn('热表白数据加载失败');
    }

    renderHomeConfessions(hotConfessions);

    // ========== 2. 后台加载冷备份 ==========
    loadColdConfessionsForHome(hotConfessions);
}

async function loadColdConfessionsForHome(existingConfessions) {
    try {
        const url = 'https://cdn.jsdelivr.net/gh/BearThomas/LG-Site-Backup@main/backups/last/confessions.json';
        const res = await fetch(url);
        if (!res.ok) return;

        const backupData = await res.json();
        let coldConfessions = backupData.documents || backupData || [];

        if (backupData.encrypted) {
            coldConfessions = await Promise.all(coldConfessions.map(async c => ({
                ...c,
                content: await decryptColdData(c.content),
                authorName: await decryptColdData(c.authorName)
            })));
        }

        const existingIds = new Set(existingConfessions.map(c => c.$id || c.id));
        const newConfessions = coldConfessions
            .map(c => ({ ...c, $id: c.$id || c.id, $createdAt: c.$createdAt || c.createdAt }))
            .filter(c => !existingIds.has(c.$id) && (c.status === 0 || c.status === undefined))
            .slice(0, 10 - existingConfessions.length);

        if (newConfessions.length > 0) {
            appendHomeConfessions(newConfessions);
        }
    } catch (e) {}
}

function appendHomeConfessions(confessions) {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList || !confessions.length) return;

    const html = confessions.map(c => `
        <div class="confession-card">
            <div class="confession-text">${escapeHtml(c.content)}</div>
            <div class="confession-footer">
                <span>😶 匿名</span>
                <span>${formatTime(new Date(c.$createdAt))}</span>
            </div>
        </div>
    `).join('');

    confessionList.insertAdjacentHTML('beforeend', html);
}

function renderHomeConfessions(confessions) {
    // const latestJwt = localStorage.getItem('persistent_jwt');
    //     if (latestJwt && typeof client !== 'undefined') {
    //         client.setJWT(latestJwt); 
    //     }
    const confessionList = document.getElementById('confessionList');
    
    if (!confessions.length) {
        confessionList.innerHTML = `
            <div class="empty-state">
                <p>暂无表白，<a href="confession.html">去表白</a></p>
            </div>
        `;
        return;
    }
    
    confessionList.innerHTML = confessions.map(c => {
        const createdAt = new Date(c.$createdAt);
        const timeStr = formatTime(createdAt);
        
        return `
            <div class="confession-card">
                <div class="confession-text">${escapeHtml(c.content)}</div>
                <div class="confession-footer">
                    <span>😶 匿名</span>
                    <span>${timeStr}</span>
                </div>
            </div>
        `;
    }).join('');
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
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatBoardName(boardId) {
    if (boardId === 'main') return '主板块';
    const match = boardId.match(/^class_(\d{4})_(\d+)$/);
    if (match) return `${match[1]}届${match[2]}班`;
    return boardId;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}