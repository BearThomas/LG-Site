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

    if (isInitial) {
        confessionList.innerHTML = html;
    } else {
        confessionList.insertAdjacentHTML('beforeend', html);
    }

    feedOffset += batch.length;
}

function setupPreloadScrollListener() {
    window.removeEventListener('scroll', handleScrollPreload);
    window.addEventListener('scroll', handleScrollPreload);
}

function handleScrollPreload() {
    if (isPreloading) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    if (documentHeight > 0 && (scrollTop + windowHeight) >= (documentHeight * 0.67)) {
        if (feedOffset < currentFilteredConfessions.length) {
            isPreloading = true;
            renderConfessionBatch(false);
            setTimeout(() => { isPreloading = false; }, 400);
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

function bindEvents() {
    const searchInput = document.getElementById('confessionSearchInput');
    const searchBtn = document.getElementById('confessionSearchBtn');
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentSearchKeyword = e.target.value.trim();
                applyFiltersAndSort();
            }, 300);
        });
    }
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            currentSearchKeyword = searchInput.value.trim();
            applyFiltersAndSort();
        });
    }

    const filterBtn = document.getElementById('confessionFilterBtn');
    const filterMenu = document.getElementById('confessionFilterMenu');
    if (filterBtn && filterMenu) {
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = filterMenu.style.display === 'none';
            filterMenu.style.display = isHidden ? 'flex' : 'none';
            filterBtn.classList.toggle('active', isHidden);
        });
        document.addEventListener('click', (e) => {
            if (!filterMenu.contains(e.target) && e.target !== filterBtn) {
                filterMenu.style.display = 'none';
                filterBtn.classList.remove('active');
            }
        });
    }

    const timeFilter = document.getElementById('confessionTimeFilter');
    if (timeFilter) {
        timeFilter.addEventListener('change', (e) => {
            currentTimeFilter = e.target.value;
            applyFiltersAndSort();
        });
    }

    const sortFilter = document.getElementById('confessionSortFilter');
    if (sortFilter) {
        sortFilter.addEventListener('change', (e) => {
            currentSortFilter = e.target.value;
            applyFiltersAndSort();
        });
    }

    const fabBtn = document.getElementById('fabConfessionBtn');
    const modal = document.getElementById('createConfessionModal');
    const closeModalBtn = document.getElementById('closeConfessionModal');
    const contentArea = document.getElementById('confessionContent');
    const charCount = document.getElementById('charCount');
    const publishBtn = document.getElementById('publishBtn');

    if (fabBtn && modal) {
        fabBtn.addEventListener('click', () => {
            if (!localStorage.getItem('campus_user')) {
                location.href = 'login.html';
                return;
            }
            modal.style.display = 'flex';
            if (contentArea) contentArea.value = '';
            if (charCount) charCount.textContent = '0';
        });
    }

    if (closeModalBtn && modal) {
        closeModalBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    if (contentArea && charCount) {
        contentArea.addEventListener('input', () => {
            charCount.textContent = contentArea.value.length;
        });
    }

    if (publishBtn && contentArea) {
        publishBtn.addEventListener('click', async () => {
            const text = contentArea.value.trim();
            if (text.length < 2) {
                alert('字数太少了，多说两个字吧');
                return;
            }
            publishBtn.disabled = true;
            publishBtn.textContent = '正在提交...';

            try {
                const res = await fetch('/api/create-confession', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: text })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    alert('表白发布成功！已匿名提交');
                    if (modal) modal.style.display = 'none';
                    await loadConfessions({ forceRefresh: true });
                } else {
                    alert(data.error || '发布表白失败');
                }
            } catch (err) {
                alert('网络错误，发布失败: ' + err.message);
            } finally {
                publishBtn.disabled = false;
                publishBtn.textContent = '匿名发布';
            }
        });
    }
}
