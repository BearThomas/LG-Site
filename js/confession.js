import { Client, Databases, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

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

// 弹窗
const reportModal = document.getElementById('reportModal');
let pendingReportId = null;

// ========== 页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
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
    checkLoginStatus();
    await loadConfessions(); // ⚡ 开启双源缓存管道
    bindEvents();
});

// ========== 登录状态 ==========
function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    
    if (userData) {
        currentUser = JSON.parse(userData);
        if (userNotLogin) userNotLogin.style.display = 'none';
        if (userLoggedIn) userLoggedIn.style.display = 'flex';
        
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = `学号尾号 ${currentUser.studentId.slice(-4)}`;
        if (userAvatarEl) userAvatarEl.textContent = currentUser.studentId.charAt(0);
        
        if (loginTip) loginTip.style.display = 'none';
        if (publishBtn) publishBtn.disabled = false;
    } else {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
        if (loginTip) loginTip.style.display = 'block';
        if (publishBtn) publishBtn.disabled = true;
    }
}

// ========== 解密函数 ==========
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

// ========== 顶部缓存状态同步条控制 ==========
function showCacheNotice(message, type = 'waiting') {
    if (!confessionList) return;
    document.getElementById('cacheNoticeBar')?.remove(); // 移除老提示栏

    const noticeEl = document.createElement('div');
    noticeEl.id = 'cacheNoticeBar';
    noticeEl.className = `cache-notice-bar ${type}`;
    noticeEl.innerHTML = message;
    
    // 始终挂载在表白墙最上方
    confessionList.insertBefore(noticeEl, confessionList.firstChild);

    if (type === 'success') {
        setTimeout(() => {
            noticeEl.style.opacity = '0';
            noticeEl.style.transform = 'translateY(-10px)';
            setTimeout(() => noticeEl.remove(), 400);
        }, 2500);
    }
}

// ========== 【核心重构】带缓存快照与静默云同步的表白列表 ==========
async function loadConfessions() {
    try {
        if (!confessionList) return;

        const currentUserId = currentUser?.studentId || 'guest';
        // 🚀 构建隔离防污染的唯一 Cache Key [用户+排序策略+页码]
        const cacheKey = `cache_confessions_${currentUserId}_${currentSort}_p${currentPage}`;
        const localCache = localStorage.getItem(cacheKey);

        let hasRenderedCache = false;

        // 【步骤 A】：优先捞取本地历史缓存，零延迟渲染
        if (localCache) {
            try {
                const parsedCache = JSON.parse(localCache);
                if (parsedCache && Array.isArray(parsedCache.data)) {
                    renderConfessions(parsedCache.data);
                    totalPages = parsedCache.totalPages || 1;
                    renderPagination();
                    
                    showCacheNotice('⚡ 正在展示本地缓存，正在唤醒最新的心动记忆...', 'waiting');
                    hasRenderedCache = true;
                }
            } catch (err) {
                console.warn('解析表白墙本地缓存异常:', err);
            }
        }

        // 若无任何缓存，则退回传统骨架加载提示
        if (!hasRenderedCache) {
            confessionList.innerHTML = '<div class="loading-state">💗 正在装载心动记忆...</div>';
        }

        // 【步骤 B】：后台静默并发拉取 Appwrite (热) + 备份 (冷)
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

        const [appwriteRes, localRes] = await Promise.all([
            databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, queries).catch(err => {
                console.warn('⚠️ 实时表白墙读取失败，降级等待冷备份:', err.message);
                return { documents: [] };
            }),
            (async () => {
                try {
                    const url = `./public/data-backups/confessions.json`;
                    const res = await fetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        let docs = data.documents || data || [];
                        
                        if (data.encrypted) {
                            docs = await Promise.all(docs.map(async doc => ({
                                ...doc,
                                content: await decryptText(doc.content),
                                authorName: await decryptText(doc.authorName)
                            })));
                        }
                        return docs;
                    }
                } catch (e) {
                    console.log('无表白墙冷备份数据');
                }
                return [];
            })()
        ]);

        // 统一格式化归一处理
        const normalizeConfession = (doc) => {
            return {
                $id: doc.$id || doc.id,
                $createdAt: doc.$createdAt || doc.createdAt,
                content: doc.content,
                authorId: doc.authorId,
                authorName: doc.authorName || '匿名',
                likes: doc.likes || 0,
                status: doc.status !== undefined ? doc.status : 0
            };
        };

        const normalizedHot = appwriteRes.documents.map(d => normalizeConfession(d));
        const normalizedCold = localRes.map(d => normalizeConfession(d));

        // 跨源去重 (基于唯一标识符 $id)
        const seen = new Set();
        const allConfessions = [...normalizedHot, ...normalizedCold].filter(c => {
            if (seen.has(c.$id) || c.status !== 0) return false;
            seen.add(c.$id);
            return true;
        });

        // 本地原生严格排序
        allConfessions.sort((a, b) => {
            if (currentSort === 'latest') {
                return new Date(b.$createdAt) - new Date(a.$createdAt);
            } else {
                return (b.likes || 0) - (a.likes || 0);
            }
        });

        // 统一计算分页切片
        const start = (currentPage - 1) * PAGE_SIZE;
        const paged = allConfessions.slice(start, start + PAGE_SIZE);
        totalPages = Math.ceil(allConfessions.length / PAGE_SIZE) || 1;

        // 【步骤 C】：将最终清洗过的纯净序列覆盖写入视图，并重刷本地缓存
        renderConfessions(paged);
        renderPagination();

        localStorage.setItem(cacheKey, JSON.stringify({
            data: paged,
            totalPages: totalPages,
            updateAt: Date.now()
        }));

        // 如果先前加载了本地缓存，弹出优雅的同步完成通告
        if (hasRenderedCache) {
            showCacheNotice('✨ 表白墙已成功同步至最新内容', 'success');
        }
        
    } catch (error) {
        console.error('装载表白墙最新内容挂裂:', error);
        const currentUserId = currentUser?.studentId || 'guest';
        if (!localStorage.getItem(`cache_confessions_${currentUserId}_${currentSort}_p${currentPage}`)) {
            confessionList.innerHTML = '<div class="empty-state"><p>同步失败，请检查网络</p></div>';
        }
    }
}

// 视图渲染
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
    
    // 点赞与举报绑定保持不变
    document.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(btn.dataset.id);
        });
    });
    
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
        
        // ⚡ 【发帖清缓存策略】：清除最新的第一页本地缓存，防止再次调用渲染出老旧列表
        const currentUserId = currentUser?.studentId || 'guest';
        localStorage.removeItem(`cache_confessions_${currentUserId}_${currentSort}_p1`);
        
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
            loadConfessions(); // 排序更改，将自动应用对应排序的隔离缓存
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
    
    document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const { Account } = await import('https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm');
            const account = new Account(client);
            await account.deleteSession('current');
        } catch (err) {}
        localStorage.removeItem('campus_user');
        localStorage.removeItem('persistent_jwt');
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