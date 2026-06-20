import { Client, Databases, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_CONFESSIONS,
    DATABASE_ID,
    decryptText,
    escapeHtml,
    formatTime,
    restoreSecureKey
} from './shared.js';

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

// ========== 页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    await restoreSecureKey();
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
                    
                    showCacheNotice(' 正在展示本地缓存，正在唤醒最新的心动记忆...', 'waiting');
                    hasRenderedCache = true;
                }
            } catch (err) {
                console.warn('解析表白墙本地缓存异常:', err);
            }
        }

        // 若无任何缓存，则退回传统骨架加载提示
        if (!hasRenderedCache) {
            confessionList.innerHTML = '<div class="loading-state"> 正在装载心动记忆...</div>';
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
            showCacheNotice(' 表白墙已成功同步至最新内容', 'success');
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
                <p>还没有表白，快来写下第一封吧！</p>
            </div>
        `;
        return;
    }
    
    confessionList.innerHTML = confessions.map(c => {
        const confessionId = c.$id || c.id;
        const confessionCreatedAt = c.$createdAt || c.createdAt;
        
        const createdAt = new Date(confessionCreatedAt);
        const timeStr = formatTime(createdAt);
        
        // 🌟 核心清理：移除了 confession-actions 动作栏，不再渲染点赞和举报按钮
        return `
            <div class="confession-card" data-id="${confessionId}">
                <div class="confession-content">${escapeHtml(c.content)}</div>
                <div class="confession-footer">
                    <div class="confession-meta">
                        <span class="confession-time">${timeStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
        const response = await fetch('/api/create-confession', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content,
                userId: currentUser.studentId
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || '发表失败');
        }
        
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
}