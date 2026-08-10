(function() {
    'use strict';

    const SUPER_ADMIN_ID = '20240338';
    const PERMISSIONS = {
        BASIC_USER: 1,         // 1
        VIEW_DASHBOARD: 2,     // 2
        AUDIT_EVENTS: 4,       // 4
        MANAGE_USERS: 8,       // 8
        MANAGE_PERMISSIONS: 16,// 16
        DATABASE_STUDIO: 32    // 32
    };

    let currentUser = null;
    let currentConfirmAction = null;
    let generatedConfirmCode = '';

    function getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (currentUser?.appToken) headers['X-LG-Token'] = currentUser.appToken;
        if (currentUser?.token) headers['X-Appwrite-Session'] = currentUser.token;
        return headers;
    }

    function isSuperAdmin() {
        if (!currentUser) return false;
        const sid = String(currentUser.studentId || currentUser.userId || '').replace(/^student_/, '');
        return sid === SUPER_ADMIN_ID;
    }

    function hasPermission(permBit) {
        if (!currentUser) return false;
        if (isSuperAdmin()) return true;
        const perms = Number(currentUser.permissions || 0);
        return (perms & permBit) === permBit;
    }

    function initPage() {
        try {
            currentUser = JSON.parse(localStorage.getItem('campus_user') || 'null');
        } catch { currentUser = null; }

        if (!currentUser) {
            alert('请先登录管理员账号');
            location.href = 'login.html';
            return;
        }

        if (!isSuperAdmin() && !hasPermission(PERMISSIONS.VIEW_DASHBOARD) && currentUser.role !== 'admin') {
            alert('权限不足，无法访问管理面板');
            location.href = './';
            return;
        }

        // 显示超级管理员 DB Studio Tab 选项卡
        if (isSuperAdmin() || hasPermission(PERMISSIONS.DATABASE_STUDIO)) {
            const studioTabBtn = document.getElementById('studioTabBtn');
            if (studioTabBtn) studioTabBtn.style.display = 'flex';
        }

        setupTabNavigation();
        loadDashboardStats();
    }

    // 选项卡导航逻辑
    function setupTabNavigation() {
        const tabBtns = document.querySelectorAll('.admin-tab-btn');
        const tabPanels = document.querySelectorAll('.tab-panel');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                tabBtns.forEach(b => b.classList.remove('active'));
                tabPanels.forEach(p => p.classList.remove('active'));

                btn.classList.add('active');
                document.getElementById(targetTab)?.classList.add('active');

                // 懒加载各选项卡数据
                if (targetTab === 'tab-stats') loadDashboardStats();
                if (targetTab === 'tab-events') loadEventsList();
                if (targetTab === 'tab-perms') loadPermissionsList();
                if (targetTab === 'tab-studio') loadDatabaseTables();
            });
        });
    }

    // 1. 数据概览拉取
    async function loadDashboardStats() {
        try {
            const res = await fetch('/api/admin-stats', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('请求失败');
            const data = await res.json();
            const s = data.stats || {};

            document.getElementById('statUserTotal').textContent = s.users?.total ?? 0;
            document.getElementById('statUserToday').textContent = `今日 +${s.users?.today ?? 0}`;
            document.getElementById('statPostTotal').textContent = s.posts?.total ?? 0;
            document.getElementById('statPostToday').textContent = `今日 +${s.posts?.today ?? 0}`;
            document.getElementById('statCommentTotal').textContent = s.comments?.total ?? 0;
            document.getElementById('statConfessionTotal').textContent = s.confessions?.total ?? 0;
            
            const pendingCount = s.events?.pending ?? 0;
            document.getElementById('statEventPending').textContent = pendingCount;
            const badge = document.getElementById('eventPendingBadge');
            if (badge) {
                badge.textContent = pendingCount;
                badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
            }
        } catch (e) {
            console.warn('加载面板数据失败:', e.message);
        }
    }

    let eventsMap = new Map();

    // 2. 大事记审核列表
    async function loadEventsList() {
        const tbody = document.getElementById('eventsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">加载中...</td></tr>';
        eventsMap.clear();

        try {
            const res = await fetch('/api/events-admin?status=pending_admin', { headers: getAuthHeaders() });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`获取待审核列表失败 (${res.status}) ${text.slice(0, 60)}`);
            }
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const text = await res.text().catch(() => '');
                throw new Error(`接口未返回 JSON 格式 (${text.slice(0, 60)})`);
            }
            const data = await res.json();
            const events = data.events || data.submissions || (Array.isArray(data) ? data : []);

            if (!events.length) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#888;">暂无待审核的大事记投稿</td></tr>';
                return;
            }

            events.forEach(ev => eventsMap.set(String(ev.id), ev));

            tbody.innerHTML = events.map(ev => `
                <tr>
                    <td><strong>${escapeHtml(ev.title)}</strong></td>
                    <td><span class="badge">${escapeHtml(ev.tag || '校园')}</span></td>
                    <td>${escapeHtml(ev.date)}</td>
                    <td>${escapeHtml(ev.submitter_id || ev.author_id || '-')}</td>
                    <td style="max-width: 300px; font-size: 13px;">${escapeHtml(ev.desc || ev.content || '')}</td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="openEventAuditModal('${ev.id}')">审核调整并发布</button>
                        <button class="btn btn-secondary btn-sm" onclick="handleAuditEvent('${ev.id}', 'rejected')">拒绝</button>
                    </td>
                </tr>
            `).join('');
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">${e.message}</td></tr>`;
        }
    }

    window.loadEventsList = loadEventsList;

    window.openEventAuditModal = function(eventId) {
        const ev = eventsMap.get(String(eventId));
        if (!ev) {
            alert('未能找到对应的事件记录');
            return;
        }

        document.getElementById('auditEventId').value = ev.id;
        document.getElementById('auditEventTitle').value = ev.title || '';
        document.getElementById('auditEventDesc').value = ev.desc || ev.content || '';
        document.getElementById('auditEventTag').value = ev.tag || '校园';
        document.getElementById('auditEventDate').value = ev.date || new Date().toISOString().split('T')[0];
        document.getElementById('auditEventLink').value = ev.link || '';

        const modal = document.getElementById('eventAuditModal');
        if (modal) modal.classList.add('show');
    };

    window.closeEventAuditModal = function() {
        const modal = document.getElementById('eventAuditModal');
        if (modal) modal.classList.remove('show');
    };

    window.submitEventAudit = async function() {
        const eventId = document.getElementById('auditEventId').value;
        const title = document.getElementById('auditEventTitle').value.trim();
        const desc = document.getElementById('auditEventDesc').value.trim();
        const tag = document.getElementById('auditEventTag').value.trim();
        const date = document.getElementById('auditEventDate').value.trim();
        const link = document.getElementById('auditEventLink').value.trim();

        if (!title || !desc || !tag || !date) {
            alert('标题、描述、标签与日期均不能为空');
            return;
        }

        try {
            const res = await fetch('/api/events-admin', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    id: eventId,
                    status: 'published',
                    title,
                    desc,
                    tag,
                    date,
                    link
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || '审核发布失败');

            alert('已成功调整并发布该大事记！');
            closeEventAuditModal();
            loadEventsList();
            loadDashboardStats();
        } catch (e) {
            alert(e.message);
        }
    };

    window.handleAuditEvent = async function(eventId, actionStatus) {
        if (!confirm(`确定将该大事记状态设为: ${actionStatus === 'published' ? '通过发布' : '拒绝'} 吗？`)) return;
        try {
            const res = await fetch('/api/events-admin', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ id: eventId, status: actionStatus })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || '审核操作失败');
            alert('审核完成！');
            loadEventsList();
            loadDashboardStats();
        } catch (e) {
            alert(e.message);
        }
    };

    // 3. 权限与二进制开关勾选列表
    async function loadPermissionsList() {
        const tbody = document.getElementById('permsTableBody');
        const searchVal = document.getElementById('userSearchInput')?.value.trim() || '';
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">加载中...</td></tr>';

        try {
            const res = await fetch(`/api/admin-permissions?q=${encodeURIComponent(searchVal)}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('读取权限列表失败');
            const data = await res.json();
            const users = data.users || [];

            if (!users.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">未查找到匹配用户</td></tr>';
                return;
            }

            tbody.innerHTML = users.map(u => {
                const uid = u.id;
                const perms = Number(u.permissions || 0);
                const isSuper = uid === SUPER_ADMIN_ID;

                const checkboxHtml = `
                    <div class="perm-checkbox-group">
                        <label class="perm-checkbox-item"><input type="checkbox" data-uid="${uid}" value="1" ${perms & 1 ? 'checked' : ''} ${isSuper ? 'disabled' : ''}> 1-基础用户</label>
                        <label class="perm-checkbox-item"><input type="checkbox" data-uid="${uid}" value="2" ${perms & 2 ? 'checked' : ''} ${isSuper ? 'disabled' : ''}> 2-查看面板</label>
                        <label class="perm-checkbox-item"><input type="checkbox" data-uid="${uid}" value="4" ${perms & 4 ? 'checked' : ''} ${isSuper ? 'disabled' : ''}> 4-大事记审核</label>
                        <label class="perm-checkbox-item"><input type="checkbox" data-uid="${uid}" value="8" ${perms & 8 ? 'checked' : ''} ${isSuper ? 'disabled' : ''}> 8-维护用户</label>
                        <label class="perm-checkbox-item"><input type="checkbox" data-uid="${uid}" value="16" ${perms & 16 ? 'checked' : ''} ${isSuper ? 'disabled' : ''}> 16-赋权开关</label>
                        <label class="perm-checkbox-item"><input type="checkbox" data-uid="${uid}" value="32" ${perms & 32 ? 'checked' : ''} ${isSuper ? 'disabled' : ''}> 32-DB控制台</label>
                    </div>
                `;

                return `
                    <tr>
                        <td><strong>${escapeHtml(uid)}</strong> ${isSuper ? '<span class="badge" style="background:#e03131;color:#fff;">超级管理员</span>' : ''}</td>
                        <td>${escapeHtml(u.name)}</td>
                        <td>${escapeHtml(u.role || 'normal')}</td>
                        <td>${checkboxHtml}</td>
                        <td>
                            ${isSuper ? '<span style="color:#aaa;">最高特权</span>' : `<button class="btn btn-primary btn-sm" onclick="saveUserPermissions('${uid}')">保存权限位</button>`}
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">${e.message}</td></tr>`;
        }
    }

    window.loadPermissionsList = loadPermissionsList;

    window.saveUserPermissions = async function(targetUid) {
        const checkboxes = document.querySelectorAll(`input[data-uid="${targetUid}"]`);
        let calculatedPerms = 0;
        checkboxes.forEach(cb => {
            if (cb.checked) calculatedPerms |= Number(cb.value);
        });

        try {
            const res = await fetch('/api/admin-permissions', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ targetUserId: targetUid, permissions: calculatedPerms })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || '更新权限失败');
            alert(`已更新用户 ${targetUid} 的二进制权限开关为: ${calculatedPerms}`);
            loadPermissionsList();
        } catch (e) {
            alert(e.message);
        }
    };

    // 4. DB 控制台与 SQL 终端逻辑
    async function loadDatabaseTables() {
        const select = document.getElementById('dbTableSelect');
        if (!select) return;

        try {
            const res = await fetch('/api/admin-sql?action=tables', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('无法读取数据表');
            const data = await res.json();
            const tables = data.tables || [];

            select.innerHTML = tables.map(t => `<option value="${t}">${t}</option>`).join('');
            loadSelectedTableData();
        } catch (e) {
            console.warn('获取表列表失败:', e.message);
        }
    }

    async function loadSelectedTableData() {
        const select = document.getElementById('dbTableSelect');
        const tableName = select?.value;
        const thead = document.getElementById('dbStudioThead');
        const tbody = document.getElementById('dbStudioTbody');
        const totalSpan = document.getElementById('tableTotalRows');
        if (!tableName || !thead || !tbody) return;

        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">加载表中...</td></tr>';

        try {
            const res = await fetch(`/api/admin-sql?table=${tableName}&limit=30`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('数据表查询失败');
            const data = await res.json();
            const rows = data.rows || [];
            if (totalSpan) totalSpan.textContent = `总行数: ${data.total || 0}`;

            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#888;">此表中暂无数据行</td></tr>';
                return;
            }

            const columns = Object.keys(rows[0]);
            thead.innerHTML = `<tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}<th>操作</th></tr>`;

            tbody.innerHTML = rows.map(r => {
                const primaryVal = r.id || r.$id || Object.values(r)[0];
                return `
                    <tr>
                        ${columns.map(c => `<td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(String(r[c] ?? ''))}</td>`).join('')}
                        <td>
                            <button class="btn btn-secondary btn-sm" style="color:red;" onclick="triggerDeleteRow('${tableName}', '${primaryVal}')">删除行</button>
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:red;">${e.message}</td></tr>`;
        }
    }

    window.loadSelectedTableData = loadSelectedTableData;

    // 二重验证模态框弹窗与高危操作逻辑
    function openSafeModal(promptText, onConfirmCallback) {
        generatedConfirmCode = 'CONFIRM-' + Math.floor(1000 + Math.random() * 9000);
        document.getElementById('safeModalPrompt').textContent = promptText;
        document.getElementById('confirmCodeDisplay').textContent = generatedConfirmCode;
        document.getElementById('confirmCodeInput').value = '';

        const modal = document.getElementById('safeModal');
        if (modal) modal.classList.add('show');

        currentConfirmAction = onConfirmCallback;
    }

    function closeSafeModal() {
        const modal = document.getElementById('safeModal');
        if (modal) modal.classList.remove('show');
        currentConfirmAction = null;
    }

    window.closeSafeModal = closeSafeModal;

    document.getElementById('confirmSubmitBtn')?.addEventListener('click', async () => {
        const inputVal = document.getElementById('confirmCodeInput')?.value.trim();
        if (inputVal !== generatedConfirmCode) {
            alert('输入的安全确认码不匹配！请重新输入。');
            return;
        }
        if (typeof currentConfirmAction === 'function') {
            const callback = currentConfirmAction;
            closeSafeModal();
            await callback(generatedConfirmCode);
        }
    });

    window.triggerDeleteRow = function(tableName, rowIdVal) {
        openSafeModal(`即将删除数据表 ${tableName} 中主键为 ${rowIdVal} 的整行数据！该操作不可逆，确定继续吗？`, async (confirmCode) => {
            try {
                const res = await fetch('/api/admin-sql', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        action: 'delete_row',
                        table: tableName,
                        primaryKey: 'id',
                        idValue: rowIdVal,
                        expectedConfirm: confirmCode,
                        confirmCode: confirmCode
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || '删除行失败');
                alert('删除成功！');
                loadSelectedTableData();
            } catch (e) {
                alert(e.message);
            }
        });
    };

    window.setSqlTemplate = function(sqlText) {
        const input = document.getElementById('sqlTerminalInput');
        if (input) input.value = sqlText;
    };

    window.handleRunSql = async function() {
        const sqlInput = document.getElementById('sqlTerminalInput')?.value.trim();
        if (!sqlInput) {
            alert('请输入要执行的 SQL');
            return;
        }

        const isDangerous = /\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE|INSERT|REPLACE)\b/i.test(sqlInput);

        const executeAction = async (confirmCode = '') => {
            try {
                const res = await fetch('/api/admin-sql', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        action: 'exec_sql',
                        sql: sqlInput,
                        expectedConfirm: confirmCode,
                        confirmCode: confirmCode
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'SQL 执行出错');

                alert(`SQL 执行成功！${data.result?.changes !== undefined ? '影响行数: ' + data.result.changes : ''}`);
                if (data.result?.rows) {
                    console.log('SQL 查询结果:', data.result.rows);
                    alert(`查询成功，共返回 ${data.result.rows.length} 行数据（详情见控制台 Log）`);
                }
            } catch (e) {
                alert(e.message);
            }
        };

        if (isDangerous) {
            openSafeModal(`检测到您正在执行包含高危修改/删除词句的 SQL: \n"${sqlInput.slice(0, 80)}..."`, executeAction);
        } else {
            await executeAction();
        }
    };

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    document.addEventListener('DOMContentLoaded', initPage);
})();
