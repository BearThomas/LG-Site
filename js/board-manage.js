// js/board-manage.js
// Javascript logic for Board Manage page.
import { escapeHtml } from './shared.js';

let currentUser = null;
let ownedBoards = [];
let selectedBoardId = '';
let activeTab = 'settings';
let migratingPostId = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verify login state
    currentUser = JSON.parse(localStorage.getItem('campus_user') || 'null');
    if (!currentUser) {
        alert('请登录后访问版主中心');
        location.href = 'login.html';
        return;
    }

    // Sync latest user profile info to ensure role/ownedBoards are up to date
    try {
        const headers = {};
        if (currentUser.appToken) headers['X-LG-Token'] = currentUser.appToken;
        const res = await fetch('/api/auth-me', { headers });
        if (res.ok) {
            const data = await res.json();
            const profile = data.profile || {};
            currentUser.name = profile.name || currentUser.name;
            currentUser.avatar = profile.avatar || '';
            currentUser.appToken = data.appToken || currentUser.appToken || '';
            currentUser.ownedBoards = profile.ownedBoards || [];
            currentUser.joinedBoards = profile.joinedBoards || [];
            currentUser.role = profile.role || 'normal';
            currentUser.permissions = profile.permissions ?? 31;
            localStorage.setItem('campus_user', JSON.stringify(currentUser));
        }
    } catch (e) {
        console.warn('同步用户数据失败:', e);
    }

    // 2. Fetch all boards and filter
    await loadOwnedBoards();

    if (ownedBoards.length === 0) {
        alert('你目前没有管理的板块！请先创建板块。');
        location.href = 'posts.html';
        return;
    }

    // 3. Initialize board switch
    const boardSelect = document.getElementById('ownedBoardsSelect');
    if (boardSelect) {
        boardSelect.addEventListener('change', (e) => {
            selectedBoardId = e.target.value;
            loadActiveTabPanel();
        });
    }

    // 4. Initialize tab switching
    const tabItems = document.querySelectorAll('.tab-item');
    tabItems.forEach(tab => {
        tab.addEventListener('click', (e) => {
            tabItems.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            loadActiveTabPanel();
        });
    });

    // 5. Initialize migration confirm button
    document.getElementById('confirmMigrateBtn')?.addEventListener('click', confirmMigratePost);

    loadActiveTabPanel();
});

async function loadOwnedBoards() {
    try {
        const res = await fetch('/api/board');
        if (!res.ok) return;
        const data = await res.json();
        const boardsList = data.boards || [];
        
        const cleanId = id => String(id || '').trim().replace(/^student_/, '');
        const userCleanId = cleanId(currentUser.studentId || currentUser.userId);

        const isAdmin = currentUser.role === 'admin' || currentUser.permissions === 255;
        if (isAdmin) {
            ownedBoards = boardsList; // Admins can manage all boards
        } else {
            ownedBoards = boardsList.filter(b => cleanId(b.ownerId) === userCleanId);
        }

        const select = document.getElementById('ownedBoardsSelect');
        if (select) {
            if (ownedBoards.length > 0) {
                select.innerHTML = ownedBoards.map(b => 
                    `<option value="${b.id}">${escapeHtml(b.name)} (${b.id})</option>`
                ).join('');
                selectedBoardId = ownedBoards[0].id;
            } else {
                select.innerHTML = '<option value="">无管理的板块</option>';
            }
        }
    } catch (e) {
        console.error('获取管理板块列表失败:', e);
    }
}

function loadActiveTabPanel() {
    const container = document.getElementById('panelContainer');
    if (!container || !selectedBoardId) return;

    const board = ownedBoards.find(b => b.id === selectedBoardId);
    if (!board) return;

    if (activeTab === 'settings') {
        renderSettingsPanel(board);
    } else if (activeTab === 'requests') {
        renderRequestsPanel(board);
    } else if (activeTab === 'members') {
        renderMembersPanel(board);
    } else if (activeTab === 'posts') {
        renderPostsPanel(board);
    }
}

// ================= Tab Panels Renderers =================

// 1. Settings Panel
function renderSettingsPanel(board) {
    const container = document.getElementById('panelContainer');
    // Fetch join_type from database if not cached
    const joinType = board.joinType !== undefined ? board.joinType : 0; // fallback to 0
    
    container.innerHTML = `
        <h3 class="panel-title">板块基本设置</h3>
        <div class="form-group">
            <label>板块标识 (ID)</label>
            <input type="text" value="${board.id}" disabled style="background:#f1f5f9; color:#64748b;">
        </div>
        <div class="form-group">
            <label>板块名称</label>
            <input type="text" value="${escapeHtml(board.name)}" disabled style="background:#f1f5f9; color:#64748b;">
        </div>
        <div class="form-group">
            <label>板块简介 (最多 80 字)</label>
            <textarea id="editDesc" rows="3" maxlength="80">${escapeHtml(board.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label>加入设置</label>
            <select id="editJoinType">
                <option value="0" ${joinType === 0 ? 'selected' : ''}>🌍 公开（任何人可直接加入并查看）</option>
                <option value="1" ${joinType === 1 ? 'selected' : ''}>🔒 私密（需要版主审批同意后方可加入）</option>
            </select>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:30px;">
            <button class="action-btn primary" id="saveSettingsBtn">保存更改</button>
            <button class="action-btn danger" id="deleteBoardBtn">🚨 注销/删除板块</button>
        </div>
    `;

    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => saveBoardSettings(board));
    document.getElementById('deleteBoardBtn')?.addEventListener('click', () => deleteBoard(board));
}

async function saveBoardSettings(board) {
    const description = document.getElementById('editDesc').value.trim();
    const joinType = Number(document.getElementById('editJoinType').value);

    try {
        const res = await fetch('/api/board/settings', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ boardId: board.id, description, joinType })
        });
        
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '保存失败');
            return;
        }

        alert('设置已成功保存！');
        // Update local cache
        board.description = description;
        board.joinType = joinType;
    } catch (e) {
        alert('网络请求失败');
    }
}

async function deleteBoard(board) {
    const firstConf = confirm(`您真的确定要删除板块【${board.name}】吗？此操作无法撤销。`);
    if (!firstConf) return;

    const secondConf = confirm(`警告：删除板块会使所有在该板块下的帖子、评论失去归属。请输入板块的 ID [ ${board.id} ] 来确认删除：`);
    if (!secondConf) return;

    const promptId = prompt('请再次输入板块 ID 以确认：');
    if (promptId !== board.id) {
        alert('输入不一致，已取消删除');
        return;
    }

    try {
        const res = await fetch('/api/board', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ boardId: board.id })
        });

        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '删除失败');
            return;
        }

        alert('板块已被成功删除！');
        location.reload();
    } catch (e) {
        alert('删除请求失败');
    }
}

// 2. Requests (Approvals) Panel
async function renderRequestsPanel(board) {
    const container = document.getElementById('panelContainer');
    container.innerHTML = `
        <h3 class="panel-title">加入申请审批</h3>
        <div class="card-list" id="requestsListContainer">
            <div style="text-align:center; padding: 20px;">正在加载申请列表...</div>
        </div>
    `;

    try {
        const res = await fetch(`/api/board/requests?boardId=${board.id}`, {
            headers: { 'X-LG-Token': currentUser.appToken || '' }
        });
        if (!res.ok) {
            document.getElementById('requestsListContainer').innerHTML = '<div class="empty-state">获取审批列表失败</div>';
            return;
        }
        
        const data = await res.json();
        const list = data.requests || [];

        const listContainer = document.getElementById('requestsListContainer');
        if (list.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">暂无待审批的加入申请</div>';
            return;
        }

        listContainer.innerHTML = list.map(r => `
            <div class="data-card" data-req-user="${r.userId}">
                <div class="card-info">
                    <span class="card-primary">${escapeHtml(r.name)}</span>
                    <span class="card-secondary">学号: ${r.userId} | 班级: ${r.className || '未知'}</span>
                </div>
                <div class="card-actions">
                    <button class="action-btn primary" onclick="processRequest('${board.id}', '${r.userId}', 'approve')">同意</button>
                    <button class="action-btn" onclick="processRequest('${board.id}', '${r.userId}', 'reject')">拒绝</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('requestsListContainer').innerHTML = '<div class="empty-state">网络请求失败</div>';
    }
}

window.processRequest = async (boardId, userId, action) => {
    try {
        const res = await fetch('/api/board/requests', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ boardId, userId, action })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '操作失败');
            return;
        }
        
        // Remove item from UI
        document.querySelector(`.data-card[data-req-user="${userId}"]`)?.remove();
        
        const listContainer = document.getElementById('requestsListContainer');
        if (listContainer && listContainer.children.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">暂无待审批的加入申请</div>';
        }
    } catch (e) {
        alert('请求失败');
    }
};

// 3. Members Panel
async function renderMembersPanel(board) {
    const container = document.getElementById('panelContainer');
    container.innerHTML = `
        <h3 class="panel-title">板块成员管理</h3>
        <div class="card-list" id="membersListContainer">
            <div style="text-align:center; padding: 20px;">正在加载成员列表...</div>
        </div>
    `;

    try {
        const res = await fetch(`/api/board/members?boardId=${board.id}`, {
            headers: { 'X-LG-Token': currentUser.appToken || '' }
        });
        if (!res.ok) {
            document.getElementById('membersListContainer').innerHTML = '<div class="empty-state">获取成员列表失败</div>';
            return;
        }
        
        const data = await res.json();
        const list = data.members || [];

        const listContainer = document.getElementById('membersListContainer');
        if (list.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">该板块暂无成员</div>';
            return;
        }

        listContainer.innerHTML = list.map(m => `
            <div class="data-card" data-member-user="${m.userId}">
                <div class="card-info">
                    <span class="card-primary">${escapeHtml(m.name)} ${m.isOwner ? '<span style="font-size:11px; background:#eff6ff; color:#3b82f6; padding:2px 6px; border-radius:4px; margin-left:6px;">主理人</span>' : ''}</span>
                    <span class="card-secondary">学号: ${m.userId} | 班级: ${m.className || '无'}</span>
                </div>
                <div class="card-actions">
                    ${m.isOwner ? '' : `<button class="action-btn danger" onclick="kickMember('${board.id}', '${m.userId}', '${escapeHtml(m.name)}')">移出板块</button>`}
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('membersListContainer').innerHTML = '<div class="empty-state">网络请求失败</div>';
    }
}

window.kickMember = async (boardId, userId, name) => {
    const conf = confirm(`确定要把成员【${name}】从板块中移出吗？该用户将失去在此板块发帖的权限。`);
    if (!conf) return;

    try {
        const res = await fetch('/api/board/members', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ boardId, userId })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '移除失败');
            return;
        }
        
        document.querySelector(`.data-card[data-member-user="${userId}"]`)?.remove();
    } catch (e) {
        alert('请求失败');
    }
};

// 4. Posts Panel
async function renderPostsPanel(board) {
    const container = document.getElementById('panelContainer');
    container.innerHTML = `
        <h3 class="panel-title">板块帖子管理</h3>
        <div class="card-list" id="postsListContainer">
            <div style="text-align:center; padding: 20px;">正在加载帖子列表...</div>
        </div>
    `;

    try {
        const res = await fetch(`/api/board/posts?boardId=${board.id}`, {
            headers: { 'X-LG-Token': currentUser.appToken || '' }
        });
        if (!res.ok) {
            document.getElementById('postsListContainer').innerHTML = '<div class="empty-state">获取帖子列表失败</div>';
            return;
        }
        
        const data = await res.json();
        const list = data.posts || [];

        const listContainer = document.getElementById('postsListContainer');
        if (list.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">此板块内暂无帖子</div>';
            return;
        }

        listContainer.innerHTML = list.map(p => `
            <div class="data-card" data-post-id="${p.id}">
                <div class="card-info" style="max-width:70%;">
                    <span class="card-primary" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.title)}</span>
                    <span class="card-secondary">作者: ${escapeHtml(p.authorName)} | 评论: ${p.commentCount} | 发布时间: ${p.createdAt.slice(0, 10)}</span>
                </div>
                <div class="card-actions">
                    <button class="action-btn primary" onclick="openMigrationDialog('${p.id}')">迁移板块</button>
                    <button class="action-btn danger" onclick="deletePost('${p.id}', '${escapeHtml(p.title)}')">删除</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        document.getElementById('postsListContainer').innerHTML = '<div class="empty-state">网络请求失败</div>';
    }
}

window.deletePost = async (postId, title) => {
    const conf = confirm(`确定要永久删除帖子【${title}】吗？删除帖子同时会清除帖子下所有的点赞和评论，此操作不可逆。`);
    if (!conf) return;

    try {
        const res = await fetch('/api/board/posts', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ postId })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '删除失败');
            return;
        }
        
        document.querySelector(`.data-card[data-post-id="${postId}"]`)?.remove();
    } catch (e) {
        alert('请求失败');
    }
};

window.openMigrationDialog = (postId) => {
    migratingPostId = postId;
    const modal = document.getElementById('migrationModal');
    const select = document.getElementById('targetBoardSelect');
    if (!modal || !select) return;

    // Populate with all boards except selectedBoardId
    // Standard boards (main) and other custom boards user joined
    const joinedBoards = currentUser.joinedBoards || [];
    const options = [
        { id: 'main', name: '主板块' }
    ];

    // Add joined custom boards
    for (const bId of joinedBoards) {
        if (bId !== selectedBoardId && bId !== 'main' && !bId.startsWith('class_')) {
            options.push({ id: bId, name: bId });
        }
    }

    select.innerHTML = options.map(o => 
        `<option value="${o.id}">${escapeHtml(o.name)}</option>`
    ).join('');

    modal.style.display = 'flex';
};

window.closeMigrationModal = () => {
    const modal = document.getElementById('migrationModal');
    if (modal) modal.style.display = 'none';
    migratingPostId = null;
};

async function confirmMigratePost() {
    if (!migratingPostId) return;
    const targetBoardId = document.getElementById('targetBoardSelect').value;
    if (!targetBoardId) return;

    try {
        const res = await fetch('/api/board/posts', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-LG-Token': currentUser.appToken || ''
            },
            body: JSON.stringify({ postId: migratingPostId, targetBoardId })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '迁移失败');
            return;
        }
        
        alert('帖子已成功迁移！');
        document.querySelector(`.data-card[data-post-id="${migratingPostId}"]`)?.remove();
        closeMigrationModal();
    } catch (e) {
        alert('网络请求错误');
    }
}
