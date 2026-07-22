import { Client, Databases, Query } from './d1-appwrite-compat.js';
import { createListSkeleton, setupPullToRefresh } from './feed-experience.js';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_CONFESSIONS,
    DATABASE_ID,
    escapeHtml,
    formatTime,
    restoreSecureKey
} from './shared.js';

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

let currentUser = null;
let secureKeyReady = Promise.resolve(null);
let allConfessions = [];
let currentFilteredConfessions = [];
let feedOffset = 0;
const PAGE_SIZE = 15;
let isPreloading = false;
let currentSearchKeyword = '';
let currentTimeFilter = 'all';
let currentSortFilter = 'new';

document.addEventListener('DOMContentLoaded', async () => {
    secureKeyReady = restoreSecureKey();
    checkLoginStatus();
    bindEvents();
    await loadConfessions();
    setupPullToRefresh({
        onRefresh: async () => {
            await loadConfessions({ forceRefresh: true });
        }
    });
});

function checkLoginStatus() {
    const userData = localStorage.getItem('campus_user');
    if (userData) {
        try {
            currentUser = JSON.parse(userData);
        } catch (e) {
            currentUser = null;
        }
    }
}

async function loadConfessions({ forceRefresh = false } = {}) {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;

    if (!forceRefresh) {
        confessionList.innerHTML = createListSkeleton('confession', 4);
    }

    let cloudDocs = [];
    try {
        const response = await databases.listDocuments(DATABASE_ID, COLLECTION_CONFESSIONS, [
            Query.equal('status', 0),
            Query.orderDesc('$createdAt'),
            Query.limit(50)
        ]);
        cloudDocs = response.documents || [];
    } catch (e) {
        console.warn('云端表白拉取失败:', e.message);
    }

    if (!cloudDocs.length) {
        try {
            const res = await fetch('/data-fallback/confessions.json');
            if (res.ok) {
                cloudDocs = await res.json();
            }
        } catch (e) {}
    }

    const seen = new Set();
    allConfessions = (cloudDocs || []).map(c => ({
        $id: c.$id || c.id,
        $createdAt: c.$createdAt || c.createdAt,
        content: c.content || '',
        likes: Number(c.likes || 0),
        status: c.status !== undefined ? c.status : 0
    })).filter(c => {
        if (!c.content || c.status !== 0) return false;
        if (seen.has(c.$id)) return false;
        seen.add(c.$id);
        return true;
    });

    applyFiltersAndSort();
}

function applyFiltersAndSort() {
    let result = [...allConfessions];

    if (currentSearchKeyword) {
        const kw = currentSearchKeyword.toLowerCase();
        result = result.filter(c => c.content.toLowerCase().includes(kw));
    }

    if (currentTimeFilter !== 'all') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfWeek = startOfDay - (now.getDay() || 7 - 1) * 86400000;
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        result = result.filter(c => {
            const t = new Date(c.$createdAt).getTime();
            if (currentTimeFilter === 'today') return t >= startOfDay;
            if (currentTimeFilter === 'week') return t >= startOfWeek;
            if (currentTimeFilter === 'month') return t >= startOfMonth;
            return true;
        });
    }

    result.sort((a, b) => {
        if (currentSortFilter === 'hot') {
            return (b.likes || 0) - (a.likes || 0);
        }
        return new Date(b.$createdAt) - new Date(a.$createdAt);
    });

    currentFilteredConfessions = result;
    feedOffset = 0;
    renderConfessionBatch(true);
    setupPreloadScrollListener();
}

function renderConfessionBatch(isInitial = false) {
    const confessionList = document.getElementById('confessionList');
    if (!confessionList) return;

    const batch = currentFilteredConfessions.slice(feedOffset, feedOffset + PAGE_SIZE);

    if (!batch.length && isInitial) {
        confessionList.innerHTML = `<div class="empty-state"><p>没有找到匹配的表白</p></div>`;
        return;
    }

    const html = batch.map(c => {
        const fullContent = escapeHtml(c.content);
        const isLong = fullContent.length > 80;
        const shortContent = isLong ? fullContent.slice(0, 80) + '...' : fullContent;

        return `
            <div class="confession-card feed-card-confession" data-id="${c.$id}">
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
