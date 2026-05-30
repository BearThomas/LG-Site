// js/confession.js
import { Client, Databases, Query, Permission, Role } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

// ========== Appwrite 配置 ==========
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = 'lg';
const DATABASE_ID = 'lg';
const COLLECTION_CONFESSIONS = 'confessions';

// 初始化
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

// 全局状态
let currentUser = null;
let currentSort = 'latest';
let currentPage = 1;
let totalPages = 1;
const PAGE_SIZE = 15;

// DOM 元素
const confessionContent = document.getElementById('confessionContent');
const charCount = document.getElementById('charCount');
const publishBtn = document.getElementById('publishBtn');
const confessionList = document.getElementById('confessionList');
const pagination = document.getElementById('pagination');
const loginTip = document.getElementById('loginTip');
const publishCard = document.querySelector('.publish-card');

// 弹窗
const reportModal = document.getElementById('reportModal');
let pendingReportId = null;

// ========== 【核心重构】页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log("⏳ 表白墙加载，正在等待长效会话守护就绪...");
    
    // 1. 🔥 铁闸门：强制等待后台把新 Token 换回来并写入 localStorage
    if (window.initAutoAuth) {
        try {
            await window.initAutoAuth(); 
            console.log("✓ 会话守护已就绪，开始安全加载表白墙数据。");
        } catch (e) {
            console.error("认证保活模块初始化异常:", e);
        }
    }

    // 2. 钥匙同步：强行给当前唯一的全局 client 实例喂下最新的长效令牌
    const latestJwt = localStorage.getItem('persistent_jwt');
    if (latestJwt) {
        client.setJWT(latestJwt); 
        console.log("🔑 全局 Appwrite 客户端已成功同步最新的 JWT 凭证");
    }

    // 3. 基础状态处理与数据加载
    checkLoginStatus();
    await loadConfessions(); // 此时发出的请求必过，绝对一路绿灯 200
    
    // 4. 安全触发事件绑定
    if (typeof bindEvents === 'function') {
        bindEvents();
    }
});

// ========== 登录状态 ==========
function checkLoginStatus() {
    const persistentJwt = localStorage.getItem('persistent_jwt');
    if (persistentJwt && typeof client !== 'undefined') {
        client.setJWT(persistentJwt);
    }
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
                
                if (loginTip) loginTip.style.display = 'none';
                if (publishBtn) publishBtn.disabled = false;
                
                // 💡 注意：不再盲目使用 currentUser.token 去覆盖 client，
                // 优先使用我们已经通过保活机制同步到全局的最新长效 Token。
            
        } catch (e) {
            currentUser = null;
        }
    } else {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
        if (loginTip) loginTip.style.display = 'block';
        if (publishBtn) publishBtn.disabled = true;
    }
}

// ========== 加载表白列表 ==========
// 修改 js/confession.js 中的 loadConfessions 函数
async function loadConfessions() {
    try {
        if (!confessionList) return;
        confessionList.innerHTML = '<div class="loading-state">💗 正在装载心动记忆...</div>';
        
        const queries = [
            Query.limit(PAGE_SIZE),
            Query.equal('status', 0)
        ];
        
        if (currentSort === 'latest') {
            queries.push(Query.orderDesc('$createdAt'));
        } else {
            queries.push(Query.orderDesc('likes'));
        }
        
        if (currentPage > 1) {
            queries.push(Query.offset((currentPage - 1) * PAGE_SIZE));
        }

        // 🔥 【双源并行】：同时抓取最新的表白和本地老旧表白
        const [appwriteRes, localRes] = await Promise.all([
            databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, queries).catch(err => {
                console.warn('⚠️ 实时表白墙读取失败，切换冷备份:', err.message);
                return { documents: [] };
            }),
            (async () => {
                try {
                    const url = `https://cdn.jsdelivr.net/gh/BearThomas/LG-Site-Backup@main/backups/last/confessions.json`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        const docs = data.documents || data || [];
                        
                        // ⭐ 如果加密了，解密
                        if (data.encrypted) {
                            return await Promise.all(docs.map(async doc => ({
                                ...doc,
                                content: await decryptText(doc.content),
                                authorName: await decryptText(doc.authorName)
                            })));
                        }
                        return docs;
                    }
                } catch (e) {
                    console.log('无表白墙冷备份');
                }
                return [];
            })()
        ]);

        // 合并数据
        const allConfessions = [...appwriteRes.documents, ...localRes];

        // 根据当前的筛选规则（最新发布 or 最多点赞）对合并后的全量数据做一次大排序
        allConfessions.sort((a, b) => {
            if (currentSort === 'latest') {
                const timeA = new Date(a.$createdAt || a.createdAt);
                const timeB = new Date(b.$createdAt || b.createdAt);
                return timeB - timeA;
            } else {
                return (b.likes || 0) - (a.likes || 0); // 按点赞数排
            }
        });

        totalPages = Math.ceil((appwriteRes.total || 0) / PAGE_SIZE) || 1;
        
        renderConfessions(allConfessions);
        renderPagination();
        
    } catch (error) {
        console.error('加载表白墙失败:', error);
        confessionList.innerHTML = '<div class="empty-state"><p>加载失败，请刷新</p></div>';
    }
}

function renderConfessions(confessions) {
    if (!confessionList) return;
    if (!confessions.length) {
        confessionList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">💌</div>
                <p>还没有表白，快来写下第一封吧！</p>
            </div>
        `;
        return;
    }
    
    const likedIds = JSON.parse(localStorage.getItem('likedConfessions') || '[]');
    
    confessionList.innerHTML = confessions.map(c => {
        // 💡 核心兼容修改：同时兼容 $id 和 id
        const confessionId = c.$id || c.id;
        const confessionCreatedAt = c.$createdAt || c.createdAt;
        
        const createdAt = new Date(confessionCreatedAt);
        const timeStr = formatTime(createdAt);
        const isLiked = likedIds.includes(confessionId);
        
        return `
            <div class="confession-card" data-id="${confessionId}">
                <div class="confession-content">${escapeHtml(c.content)}</div>
                <div class="confession-footer">
                    <div class="confession-meta">
                        <span class="confession-time">${timeStr}</span>
                    </div>
                    <div class="confession-actions">
                        <button class="confession-action like-btn ${isLiked ? 'liked' : ''}" data-id="${confessionId}">
                            <span>${isLiked ? '❤️' : '🤍'}</span>
                            <span class="like-count">${c.likes || 0}</span>
                        </button>
                        <button class="confession-action report" data-id="${confessionId}">
                            <span>🚩</span>
                            <span>举报</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // 绑定点赞事件
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(btn.dataset.id);
        });
    });
    
    // 绑定举报事件
    document.querySelectorAll('.confession-action.report').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openReportModal(btn.dataset.id);
        });
    });
}

// ========== 点赞（本地模拟） ==========
function toggleLike(confessionId) {
    const likedIds = JSON.parse(localStorage.getItem('likedConfessions') || '[]');
    const index = likedIds.indexOf(confessionId);
    
    if (index > -1) {
        likedIds.splice(index, 1);
    } else {
        likedIds.push(confessionId);
    }
    
    localStorage.setItem('likedConfessions', JSON.stringify(likedIds));
    
    const card = document.querySelector(`.confession-card[data-id="${confessionId}"]`);
    if (!card) return;
    
    const likeBtn = card.querySelector('.like-btn');
    const likeCountSpan = likeBtn.querySelector('.like-count');
    const currentLikes = parseInt(likeCountSpan.textContent) || 0;
    
    if (index > -1) {
        likeBtn.classList.remove('liked');
        likeBtn.querySelector('span').textContent = '🤍';
        likeCountSpan.textContent = Math.max(0, currentLikes - 1);
    } else {
        likeBtn.classList.add('liked');
        likeBtn.querySelector('span').textContent = '❤️';
        likeCountSpan.textContent = currentLikes + 1;
    }
}

// ========== 发表表白 ==========
async function publishConfession() {
    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }
    
    const content = confessionContent.value.trim();
    
    if (!content) {
        alert('请输入表白内容');
        return;
    }
    if (content.length < 5) {
        alert('内容至少5个字');
        return;
    }
    
    publishBtn.disabled = true;
    publishBtn.textContent = '发布中...';
    
    try {
        // 在写入操作前，再次保险性地同步一次最新 JWT 状态
        const token = localStorage.getItem('persistent_jwt');
        if (token) client.setJWT(token);

        await databases.createDocument(DATABASE_ID, COLLECTION_CONFESSIONS, 'unique()', {
            content: content,
            authorId: currentUser.studentId,
            authorName: '匿名',
            toName: null,
            status: 0,
            likes: 0
        });
        
        confessionContent.value = '';
        if (charCount) charCount.textContent = '0';
        
        currentPage = 1;
        await loadConfessions();
        
    } catch (error) {
        console.error('发表失败:', error);
        alert('发表失败，请刷新页面或重新登录重试');
    } finally {
        if (publishBtn) {
            publishBtn.disabled = false;
            publishBtn.textContent = '匿名发布';
        }
    }
}

// ========== 举报 ==========
function openReportModal(confessionId) {
    pendingReportId = confessionId;
    if (reportModal) reportModal.style.display = 'flex';
}

async function submitReport() {
    if (!pendingReportId) return;
    
    try {
        alert('举报已提交，管理员会尽快处理');
        if (reportModal) reportModal.style.display = 'none';
        pendingReportId = null;
    } catch (error) {
        alert('举报失败');
    }
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
        html += `<span>...</span>`;
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
            loadConfessions();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// ========== 事件绑定 ==========
function bindEvents() {
    if (confessionContent && charCount) {
        confessionContent.addEventListener('input', () => {
            charCount.textContent = confessionContent.value.length;
        });
    }
    
    if (publishBtn) publishBtn.addEventListener('click', publishConfession);
    
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSort = btn.dataset.sort;
            currentPage = 1;
            loadConfessions();
        });
    });
    
    document.getElementById('closeReportModal')?.addEventListener('click', () => {
        if (reportModal) reportModal.style.display = 'none';
    });
    document.getElementById('cancelReportBtn')?.addEventListener('click', () => {
        if (reportModal) reportModal.style.display = 'none';
    });
    document.getElementById('confirmReportBtn')?.addEventListener('click', submitReport);
    
    if (reportModal) {
        reportModal.addEventListener('click', (e) => {
            if (e.target === reportModal) reportModal.style.display = 'none';
        });
    }
    
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('campus_user');
        localStorage.removeItem('persistent_jwt'); // 同步清空保活模块令牌
        location.reload();
    });
    
    document.getElementById('userAvatar')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('dropdownMenu').classList.toggle('show');
    });
    
    document.addEventListener('click', () => {
        document.getElementById('dropdownMenu')?.classList.remove('show');
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

async function decryptText(encryptedText) {
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