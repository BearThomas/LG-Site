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
            const response = await fetch('/data/events.json');
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

        if (weekEvents.length === 0) {
            container.innerHTML = `
                <div class="event-card">
                    <span class="event-tag"></span>
                    <div class="event-title">本周暂无大事记</div>
                    <div class="event-desc">敬请期待下周精彩</div>
                    <div class="event-date"> ${formatDate(new Date().toISOString())}</div>
                </div>
            `;
            return;
        }

        container.innerHTML = weekEvents.map(event => `
            <div class="event-card">
                <span class="event-tag">${event.tag}</span>
                <div class="event-title">${event.title}</div>
                <div class="event-desc">${event.desc}</div>
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
                    <span class="event-tag">${event.tag}</span>
                </div>
                <div class="event-list-content">
                    <div class="event-title">${event.title}</div>
                    <div class="event-desc">${event.desc}</div>
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
                        ${tags.map(tag => `<option value="${tag}">${tag}</option>`).join('')}
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