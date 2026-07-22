// js/events.js
// 大事记数据加载与筛选逻辑

const EventsManager = (function() {
    'use strict';

    let allEvents = [];
    let currentFilters = {
        tag: 'all',
        keyword: '',
        dateRange: 'all'
    };

    function escapeHtml(value) {
        const element = document.createElement('div');
        element.textContent = String(value ?? '');
        return element.innerHTML;
    }

    // ========== 日期工具函数 ==========
    function getWeekRange(date) {
        const d = new Date(date);
        const day = d.getDay() || 7; // 周日为7
        const monday = new Date(d);
        monday.setDate(d.getDate() - day + 1);
        monday.setHours(0, 0, 0, 0);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        
        return { start: monday, end: sunday };
    }

    function isThisWeek(dateStr) {
        const eventDate = new Date(dateStr);
        const now = new Date();
        const { start, end } = getWeekRange(now);
        return eventDate >= start && eventDate <= end;
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const weekDay = weekDays[d.getDay()];
        return `${month}月${day}日 ${weekDay}`;
    }

    // ========== 数据加载 ==========
    async function loadEvents() {
        try {
            const response = await fetch('/api/events');
            if (!response.ok) throw new Error('加载失败');
            allEvents = await response.json();
            // 按日期排序（最近的在前）
            allEvents.sort((a, b) => new Date(b.date) - new Date(a.date));
            return allEvents;
        } catch (err) {
            console.error('加载大事记失败:', err);
            return [];
        }
    }

    // ========== 筛选逻辑 ==========
    function filterEvents(filters = {}) {
        // 合并筛选条件
        const f = { ...currentFilters, ...filters };
        currentFilters = f;

        return allEvents.filter(event => {
            // 标签筛选
            if (f.tag && f.tag !== 'all' && event.tag !== f.tag) {
                return false;
            }

            // 关键词模糊搜索（标题 + 描述）
            if (f.keyword && f.keyword.trim()) {
                const kw = f.keyword.trim().toLowerCase();
                const titleMatch = event.title.toLowerCase().includes(kw);
                const descMatch = event.desc.toLowerCase().includes(kw);
                if (!titleMatch && !descMatch) {
                    return false;
                }
            }

            // 日期范围筛选
            if (f.dateRange && f.dateRange !== 'all') {
                const eventDate = new Date(event.date);
                const now = new Date();
                
                if (f.dateRange === 'thisWeek') {
                    const { start, end } = getWeekRange(now);
                    if (eventDate < start || eventDate > end) return false;
                } else if (f.dateRange === 'nextWeek') {
                    const nextWeek = new Date(now);
                    nextWeek.setDate(now.getDate() + 7);
                    const { start, end } = getWeekRange(nextWeek);
                    if (eventDate < start || eventDate > end) return false;
                } else if (f.dateRange === 'thisMonth') {
                    if (eventDate.getMonth() !== now.getMonth() || 
                        eventDate.getFullYear() !== now.getFullYear()) {
                        return false;
                    }
                } else if (f.dateRange === 'past') {
                    if (eventDate >= now) return false;
                } else if (f.dateRange === 'upcoming') {
                    if (eventDate < now) return false;
                }
            }

            return true;
        });
    }

    // ========== 获取所有标签 ==========
    function getAllTags() {
        const tags = [...new Set(allEvents.map(e => e.tag))];
        return tags;
    }

    // ========== 渲染本周大事记（首页用） ==========
    function renderWeekEvents(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const weekEvents = allEvents.filter(e => isThisWeek(e.date));
        const board = container.closest('.event-board');

        if (weekEvents.length === 0) {
            if (board) board.style.display = 'none';
            return;
        }

        if (board) board.style.display = 'block';

        container.innerHTML = weekEvents.map(event => `
            <div class="event-card feed-card-event">
                <span class="event-tag">${escapeHtml(event.tag)}</span>
                <div class="event-title">${escapeHtml(event.title)}</div>
                <div class="event-desc">${escapeHtml(event.desc)}</div>
                <div class="event-date">${formatDate(event.date)}</div>
            </div>
        `).join('');
    }

    // ========== 渲染完整大事记列表（大事记页面用） ==========
    function renderAllEvents(containerSelector, filters = {}) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const filtered = filterEvents(filters);

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="events-empty">
                    <span style="font-size: 3rem;"></span>
                    <p>没有找到匹配的大事记</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filtered.map(event => `
            <div class="event-list-item">
                <div class="event-list-tag">
                    <span class="event-tag">${escapeHtml(event.tag)}</span>
                </div>
                <div class="event-list-content">
                    <div class="event-title">${escapeHtml(event.title)}</div>
                    <div class="event-desc">${escapeHtml(event.desc)}</div>
                    <div class="event-date">${formatDate(event.date)}</div>
                </div>
            </div>
        `).join('');
    }

    // ========== 初始化筛选器UI（大事记页面用） ==========
    function initFilters(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const tags = getAllTags();

        container.innerHTML = `
            <div class="filter-bar">
                <div class="filter-group">
                    <label>标签</label>
                    <select id="filterTag">
                        <option value="all">全部</option>
                        ${tags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('')}
                    </select>
                </div>
                <div class="filter-group">
                    <label>时间</label>
                    <select id="filterDate">
                        <option value="all">全部时间</option>
                        <option value="thisWeek">本周</option>
                        <option value="nextWeek">下周</option>
                        <option value="thisMonth">本月</option>
                        <option value="upcoming">即将到来</option>
                        <option value="past">已结束</option>
                    </select>
                </div>
                <div class="filter-group filter-search">
                    <label>搜索</label>
                    <input type="text" id="filterKeyword" placeholder="搜索大事记...">
                </div>
            </div>
        `;

        // 绑定筛选事件（防抖）
        let debounceTimer;
        const bindFilter = (callback) => {
            document.getElementById('filterTag').addEventListener('change', callback);
            document.getElementById('filterDate').addEventListener('change', callback);
            document.getElementById('filterKeyword').addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(callback, 300);
            });
        };

        return { bindFilter };
    }

    // ========== 公开 API ==========
    return {
        loadEvents,
        renderWeekEvents,
        renderAllEvents,
        initFilters,
        getAllTags,
        getCurrentFilters: () => currentFilters
    };

})();

// ========== 投稿与记录逻辑 ==========
(function() {
    const submitBtn = document.getElementById('submitEventBtn');
    const mySubmissionsBtn = document.getElementById('mySubmissionsBtn');
    const submitModal = document.getElementById('submitEventModal');
    const recordsModal = document.getElementById('mySubmissionsModal');
    const cancelSubmitBtn = document.getElementById('cancelSubmitBtn');
    const confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
    const closeSubmissionsBtn = document.getElementById('closeSubmissionsBtn');
    const contentInput = document.getElementById('eventSubmitContent');
    const recordsList = document.getElementById('mySubmissionsList');

    if (!submitBtn || !mySubmissionsBtn || !submitModal || !recordsModal) return;

    function getSavedUser() {
        try {
            const user = JSON.parse(localStorage.getItem('campus_user') || 'null');
            return user?.authVersion === 2 && user?.studentId ? user : null;
        } catch {
            return null;
        }
    }

    function authHeaders(user, includeJson = false) {
        const headers = {};
        if (includeJson) headers['Content-Type'] = 'application/json';
        if (user?.appToken) headers['X-LG-Token'] = user.appToken;
        if (user?.token) headers['X-Appwrite-Session'] = user.token;
        return headers;
    }

    async function checkAdminPendingEvents() {
        const user = getSavedUser();
        if (!user) return;

        const adminAuditBtn = document.getElementById('adminAuditBtn');
        const adminPendingCount = document.getElementById('adminPendingCount');

        try {
            const res = await fetch('/api/events-admin', {
                method: 'POST',
                headers: authHeaders(user, true),
                body: JSON.stringify({
                    studentId: user.studentId,
                    appToken: user.appToken || '',
                    sessionSecret: user.token || '',
                    action: 'list'
                })
            });

            if (res.status === 403 || !res.ok) return;

            const data = await res.json();
            if (Array.isArray(data)) {
                if (adminPendingCount) adminPendingCount.textContent = data.length;
                if (adminAuditBtn) adminAuditBtn.style.display = 'inline-flex';
            }
        } catch (e) {
            console.warn('检查管理员待审核大事记数量失败:', e.message);
        }
    }

    checkAdminPendingEvents();

    function readLocalRecords() {
        try {
            const records = JSON.parse(localStorage.getItem('my_event_submissions') || '[]');
            return Array.isArray(records) ? records.slice(0, 50) : [];
        } catch {
            return [];
        }
    }

    function writeLocalRecords(records) {
        localStorage.setItem('my_event_submissions', JSON.stringify(records.slice(0, 50)));
    }

    function escapeHtml(value) {
        const element = document.createElement('div');
        element.textContent = String(value ?? '');
        return element.innerHTML;
    }

    const statusLabels = {
        pending_admin: 'AI 初审已通过 · 等待管理员确认',
        published: '已发布',
        rejected: '管理员未通过'
    };

    function renderSubmissionRecords(records) {
        if (records.length === 0) {
            recordsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">暂无记录</div>';
            return;
        }
        recordsList.innerHTML = records.map(record => {
            const status = statusLabels[record.status] || record.statusLabel || '状态待同步';
            const statusColor = record.status === 'published'
                ? 'var(--success, #2f9e44)'
                : record.status === 'rejected'
                    ? 'var(--danger, #e03131)'
                    : 'var(--warning, #f08c00)';
            return `
                <div style="border-bottom: 1px solid var(--border); padding: 12px 0;">
                    <div style="font-weight: 600; margin-bottom: 5px;">${escapeHtml(record.title || '待生成标题')}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 7px;">原内容：${escapeHtml(record.content || '')}</div>
                    <div style="display: flex; gap: 10px; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);">
                        <span>${new Date(record.date).toLocaleString()}</span>
                        <span style="color: ${statusColor}; text-align: right;">${escapeHtml(status)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    submitBtn.addEventListener('click', () => {
        submitModal.style.display = 'flex';
        contentInput.value = '';
    });

    cancelSubmitBtn.addEventListener('click', () => {
        submitModal.style.display = 'none';
    });

    confirmSubmitBtn.addEventListener('click', async () => {
        const val = contentInput.value.trim();
        if (val.length < 5 || val.length > 500) {
            alert('字数需在 5 到 500 之间');
            return;
        }

        const user = getSavedUser();
        if (!user) {
            alert('请先登录后投稿');
            location.href = 'login.html';
            return;
        }

        confirmSubmitBtn.disabled = true;
        confirmSubmitBtn.textContent = 'AI 审核中...';

        try {
            const res = await fetch('/api/events-submit', {
                method: 'POST',
                headers: authHeaders(user, true),
                body: JSON.stringify({
                    studentId: user.studentId,
                    appToken: user.appToken || '',
                    sessionSecret: user.token || '',
                    content: val
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert('投稿成功！已通过初审，请等待管理员复核。');
                submitModal.style.display = 'none';
                
                // 保存到本地记录
                const records = readLocalRecords();
                records.unshift({
                    id: data.eventId,
                    content: val,
                    title: data.data?.title || '无标题',
                    date: new Date().toISOString(),
                    status: data.data?.status || 'pending_admin'
                });
                writeLocalRecords(records);
            } else {
                alert('投稿失败: ' + (data.error || '未知错误'));
            }
        } catch(e) {
            alert('网络错误，请稍后再试');
        } finally {
            confirmSubmitBtn.disabled = false;
            confirmSubmitBtn.textContent = '提交审核';
        }
    });

    mySubmissionsBtn.addEventListener('click', async () => {
        recordsModal.style.display = 'flex';
        const records = readLocalRecords();
        renderSubmissionRecords(records);
        if (!records.length) return;

        const user = getSavedUser();
        if (!user) return;

        recordsList.insertAdjacentHTML('afterbegin', '<div id="submissionSyncState" style="font-size: 0.82rem; color: var(--text-muted); padding-bottom: 10px;">正在同步审核状态…</div>');
        try {
            const ids = records.map(record => record.id).filter(Boolean).join(',');
            const response = await fetch(`/api/events-submit?ids=${encodeURIComponent(ids)}`, {
                headers: authHeaders(user)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || '状态同步失败');

            const serverRecords = new Map((data.submissions || []).map(item => [item.id, item]));
            const updated = records.map(record => {
                const serverRecord = serverRecords.get(record.id);
                if (!serverRecord) return { ...record, statusLabel: '记录暂未查到，请稍后重试' };
                return {
                    ...record,
                    title: serverRecord.title || record.title,
                    status: serverRecord.status || record.status
                };
            });
            writeLocalRecords(updated);
            renderSubmissionRecords(updated);
        } catch (error) {
            document.getElementById('submissionSyncState').textContent = error.message;
        }
    });

    closeSubmissionsBtn.addEventListener('click', () => {
        recordsModal.style.display = 'none';
    });
})();
