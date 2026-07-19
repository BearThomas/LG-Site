import { Client, Databases, Query } from './d1-appwrite-compat.js';
import { createListSkeleton, scheduleAfterPaint, setupPullToRefresh } from './feed-experience.js';
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
let secureKeyReady = Promise.resolve(null);
let currentSort = 'latest';
let currentPage = 1;
let totalPages = 1;
const PAGE_SIZE = 15;
let confessionsSnapshot = [];

// Fetch cold backup hashes + pending mods from D1
let serverHashes = { posts: null, comments: null, confessions: null };
let pendingModifications = [];
let tombstonedIds = { confessions: new Set() };

async function loadTombstones() {
    try {
        const res = await fetch('/api/mod-log');
        if (res.ok) {
            const data = await res.json();
            serverHashes = data.hashes || {};
            pendingModifications = data.pendingModifications || [];
            
            const deletedConfessions = pendingModifications.filter(m => m.collection === 'confessions' && m.action === 'delete').map(m => m.item_id);
            tombstonedIds.confessions = new Set(deletedConfessions);
        }
    } catch (e) {
        console.warn('获取 mod-log 失败', e);
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

// DOM 元素
const confessionContent = document.getElementById('confessionContent');
const charCount = document.getElementById('charCount');
const publishBtn = document.getElementById('publishBtn');
const confessionList = document.getElementById('confessionList');
const pagination = document.getElementById('pagination');
const loginTip = document.getElementById('loginTip');

// ========== 页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    secureKeyReady = restoreSecureKey();
    checkLoginStatus();
    await loadConfessions(); // ⚡ 开启双源缓存管道
    bindEvents();
    setupPullToRefresh({
        onRefresh: async () => {
            currentPage = 1;
            await loadConfessions({ forceRefresh: true });
        }
    });
});

// ========== 登录状态 ==========
function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    const loginTip = document.getElementById('loginTip');
    const publishBtn = document.getElementById('publishBtn');

    if (userData) {
        try {
            currentUser = JSON.parse(userData);
            if (currentUser.authVersion !== 2) {
                localStorage.removeItem('campus_user');
                currentUser = null;
                if (loginTip) loginTip.style.display = 'block';
                if (publishBtn) publishBtn.disabled = true;
                return;
            }
            if (loginTip) loginTip.style.display = 'none';
            if (publishBtn) publishBtn.disabled = false;
        } catch (e) {
            currentUser = null;
            if (loginTip) loginTip.style.display = 'block';
            if (publishBtn) publishBtn.disabled = true;
        }
    } else {
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

async function listAllConfessionDocuments(baseQueries, onFirstBatch) {
    let allConfessions = [];
    let maxCreatedAt = null;

    try {
        const idb = await import('./idb-cache.js');
        allConfessions = await idb.getAllFromCache('confessions', 100000, 'desc');
        if (allConfessions.length > 0) {
            const firstDateStr = allConfessions[0].$createdAt || allConfessions[0].created_at;
            if (firstDateStr) maxCreatedAt = firstDateStr;
            if (onFirstBatch) onFirstBatch(allConfessions.slice(0, 50));
        }
    } catch (e) {}

    const documents = [];
    let offset = 0;
    const batchSize = 100;

    while (true) {
        const pageQueries = [...baseQueries];
        if (maxCreatedAt) {
            pageQueries.push(Query.greaterThan('created_at', maxCreatedAt));
        }
        pageQueries.push(Query.limit(batchSize));
        if (offset > 0) pageQueries.push(Query.offset(offset));

        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, pageQueries);
        const batch = response.documents || [];
        documents.push(...batch);
        
        if (!maxCreatedAt && offset === 0 && onFirstBatch) onFirstBatch(batch);

        if (batch.length < batchSize || documents.length >= Number(response.total || 0)) break;
        offset += batch.length;
    }

    if (documents.length > 0) {
        try {
            const idb = await import('./idb-cache.js');
            await idb.putToCache('confessions', documents);
        } catch (e) {}
        allConfessions.push(...documents);
    }

    const uniqueMap = new Map();
    allConfessions.forEach(c => uniqueMap.set(c.$id || c.id, c));

    return Array.from(uniqueMap.values()).sort((a, b) => {
        const ta = new Date(a.$createdAt || a.created_at || 0).getTime();
        const tb = new Date(b.$createdAt || b.created_at || 0).getTime();
        return tb - ta;
    });
}

// ========== 【核心重构】带缓存快照与静默云同步的表白列表 ==========
async function loadConfessions({ forceRefresh = false } = {}) {
    try {
        if (!confessionList) return;

        const currentUserId = currentUser?.studentId || 'guest';
        // 🚀 构建隔离防污染的唯一 Cache Key [用户+排序策略+页码]
        const cacheKey = `cache_confessions_v2_${currentUserId}_${currentSort}_p${currentPage}`;
        const localCache = forceRefresh ? null : localStorage.getItem(cacheKey);

        let hasRenderedCache = false;

        // 【步骤 A】：优先捞取本地历史缓存，零延迟渲染
        if (localCache) {
            try {
                const parsedCache = JSON.parse(localCache);
                if (parsedCache && Array.isArray(parsedCache.data)) {
                    await loadTombstones();
                    const filtered = parsedCache.data.filter(c => !tombstonedIds.confessions.has(c.$id || c.id));
                    renderConfessions(filtered);
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
        if (!hasRenderedCache && !forceRefresh) {
            confessionList.innerHTML = createListSkeleton('confession', 5);
        }

        // 【步骤 B】：后台静默并发拉取 D1 API（实时）+ 脱敏快照（降级）
        const queries = [
            Query.equal('status', 0)
        ];
        
        if (currentSort === 'latest') {
            queries.push(Query.orderDesc('$createdAt'));
        } else {
            queries.push(Query.orderDesc('likes'));
        }
        
        let appwriteRes = { documents: [] };
        let localRes = [];
        await loadTombstones();
        try {
            const [d1Res, coldRes] = await Promise.allSettled([
                listAllConfessionDocuments(queries, firstBatch => {
                    if (hasRenderedCache || currentPage !== 1) return;
                    const quickItems = firstBatch.filter(item =>
                        item.content != null && Number(item.status || 0) === 0 && !tombstonedIds.confessions.has(item.$id || item.id)
                    ).slice(0, PAGE_SIZE);
                    if (quickItems.length) {
                        renderConfessions(quickItems);
                        showCacheNotice('最新内容已显示，正在后台整理完整列表...', 'waiting');
                        hasRenderedCache = true;
                    }
                }),
                (async () => {
                    let docs = [];
                    const index = await fetchWithHashCache('confessions', ['./public/data-backups/confessions/index.json']);
                    if (index && index.chunks) {
                        const promises = index.chunks.map(chunk => {
                            // Reuse posts.js fetchChunkWithCache logic implicitly or just use fetchWithHashCache for simplicity
                            return fetchWithHashCache(`confessions_${chunk.file}`, [`./public/data-backups/confessions/${chunk.file}`]);
                        });
                        const arrays = await Promise.all(promises);
                        docs = arrays.flat();
                    }
                    return applyPendingModifications('confessions', docs);
                })()
            ]);
            
            if (d1Res.status === 'fulfilled') {
                appwriteRes.documents = d1Res.value || [];
            }
            if (coldRes.status === 'fulfilled') {
                localRes = coldRes.value || [];
            }
        } catch (error) {
            console.warn('读取表白墙数据失败:', error.message);
        }

        // 统一格式化归一处理
        const normalizeConfession = (doc) => {
            return {
                $id: doc.$id || doc.id,
                $createdAt: doc.$createdAt || doc.createdAt,
                content: doc.content,
                authorId: doc.authorId,
                
                authorName: (() => {
                    let n = escapeHtml(doc.authorName || '匿名');
                    let sid = (doc.authorId || doc.studentId || '').toString().replace(/^student_/, '').trim();
                    if (sid.length >= 4) n = `${n}<span class="year-badge">${sid.substring(0, 4)}届</span>`;
                    return n;
                })(),

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
            if (tombstonedIds.confessions.has(c.$id)) return false;
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

        confessionsSnapshot = allConfessions;
        totalPages = Math.ceil(confessionsSnapshot.length / PAGE_SIZE) || 1;
        currentPage = Math.min(currentPage, totalPages);
        renderConfessionsSnapshotPage();

        // 如果先前加载了本地缓存，弹出优雅的同步完成通告
        if (hasRenderedCache) {
            showCacheNotice(' 表白墙已成功同步至最新内容', 'success');
        }
        
    } catch (error) {
        console.error('装载表白墙最新内容挂裂:', error);
        const currentUserId = currentUser?.studentId || 'guest';
        if (!localStorage.getItem(`cache_confessions_v2_${currentUserId}_${currentSort}_p${currentPage}`)) {
            confessionList.innerHTML = '<div class="empty-state"><p>同步失败，请检查网络</p></div>';
        }
    }
}

function renderConfessionsSnapshotPage() {
    confessionsSnapshot.sort((a, b) => currentSort === 'latest'
        ? new Date(b.$createdAt) - new Date(a.$createdAt)
        : (b.likes || 0) - (a.likes || 0));

    const start = (currentPage - 1) * PAGE_SIZE;
    const paged = confessionsSnapshot.slice(start, start + PAGE_SIZE);
    totalPages = Math.ceil(confessionsSnapshot.length / PAGE_SIZE) || 1;
    renderConfessions(paged);
    renderPagination();

    const currentUserId = currentUser?.studentId || 'guest';
    const cacheKey = `cache_confessions_v2_${currentUserId}_${currentSort}_p${currentPage}`;
    scheduleAfterPaint(() => {
        localStorage.setItem(cacheKey, JSON.stringify({ data: paged, totalPages, updateAt: Date.now() }));
    });
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
    
    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.permissions === 255);
    confessionList.innerHTML = confessions.map(c => {
        const confessionId = c.$id || c.id;
        const confessionCreatedAt = c.$createdAt || c.createdAt;
        
        const createdAt = new Date(confessionCreatedAt);
        const timeStr = formatTime(createdAt);
        
        const deleteHtml = isAdmin ? `<button class="confession-delete-btn" data-id="${confessionId}">🗑️ 删除</button>` : '';
        
        return `
            <div class="confession-card" data-id="${confessionId}">
                <div class="confession-content">${escapeHtml(c.content)}</div>
                <div class="confession-footer">
                    <div class="confession-meta" ${c.authorName === '匿名' ? '' : `onclick="window.goToUserProfile('${c.authorId || c.studentId}', event)" style="cursor: pointer;"`}>
                        <span class="confession-time">${timeStr}</span>
                    </div>
                    ${deleteHtml}
                </div>
            </div>
        `;
    }).join('');

    if (isAdmin) {
        confessionList.querySelectorAll('.confession-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.dataset.id;
                if (!confirm('确定删除这条表白吗？')) return;
                try {
                    const response = await fetch('/api/data', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            collection: 'confessions',
                            documentId: id,
                            userId: currentUser?.studentId,
                            sessionSecret: currentUser?.token,
                            appToken: currentUser?.appToken
                        })
                    });
                    const res = await response.json().catch(() => ({}));
                    if (!response.ok || !res.success) throw new Error(res.error || '删除失败');
                    alert('表白已成功撤销/软删除');
                    loadConfessions({ forceRefresh: true });
                } catch (err) {
                    alert(err.message || '删除失败');
                }
            });
        });
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
        const response = await fetch('/api/create-confession', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content,
                userId: currentUser.studentId,
                sessionSecret: currentUser.token || '',
                appToken: currentUser.appToken || ''
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
        localStorage.removeItem(`cache_confessions_v2_${currentUserId}_${currentSort}_p1`);
        
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
            if (confessionsSnapshot.length) renderConfessionsSnapshotPage();
            else loadConfessions();
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
            if (confessionsSnapshot.length) renderConfessionsSnapshotPage();
            else loadConfessions();
        });
    });
}
