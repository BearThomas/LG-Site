// js/posts.js
import { Client, Databases, Query } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

// ========== Appwrite 配置 ==========
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = 'lg';
const DATABASE_ID = 'lg';
const COLLECTION_POSTS = 'posts';
const COLLECTION_BOARDS = 'boards';
const COLLECTION_USERS = 'users';

// 初始化 Appwrite
const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);

// ========== 全局状态 ==========
let currentUser = null;
let currentBoard = { $id: 'main', name: '主板块' };
let currentTimeFilter = 'all'; // 存储当前选中的时间：all, today, week, month
let currentPage = 1;
let totalPages = 1;
const PAGE_SIZE = 10;

// DOM 元素
const postsList = document.getElementById('postsList');
const pagination = document.getElementById('pagination');
const currentBoardName = document.getElementById('currentBoardName');
const boardMemberCount = document.getElementById('boardMemberCount');
const joinBoardBtn = document.getElementById('joinBoardBtn');
const newPostBtn = document.getElementById('newPostBtn');
const postModal = document.getElementById('postModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelPostBtn = document.getElementById('cancelPostBtn');
const submitPostBtn = document.getElementById('submitPostBtn');
const postTitle = document.getElementById('postTitle');
const postContent = document.getElementById('postContent');
const postBoardSelect = document.getElementById('postBoardSelect');

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
    checkLoginStatus();
    await loadBoards();
    await loadPosts();
    bindEvents();
});

const ENCRYPT_KEY = '176ec04db0ffc0e689e2e36b40e6c68a528b4179339fbaad8bdd12bf63597eecs';

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

// ========== 登录状态 ==========
function checkLoginStatus() {
    // const persistentJwt = localStorage.getItem('persistent_jwt');
    // if (persistentJwt && typeof client !== 'undefined') {
    //     client.setJWT(persistentJwt);
    // }
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
            
        } catch (e) {
            currentUser = null;
        }
    } else {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
    }
}

// ========== 加载板块基础数据 ==========
async function loadBoards() {
    try {
        if (currentBoard.$id === 'main') {
            if (currentBoardName) currentBoardName.textContent = '主板块';
            if (boardMemberCount) boardMemberCount.textContent = '42 人';
        }

        if (currentUser && currentBoard.$id !== 'main') {
            try {
                const userDoc = await databases.getDocument(DATABASE_ID, COLLECTION_USERS, currentUser.studentId);
                const isJoined = userDoc.joinedBoards?.includes(currentBoard.$id);
                if (joinBoardBtn) joinBoardBtn.style.display = isJoined ? 'none' : 'inline-block';
            } catch (e) {
                if (joinBoardBtn) joinBoardBtn.style.display = 'none';
            }
        } else {
            if (joinBoardBtn) joinBoardBtn.style.display = 'none';
        }
        
    } catch (error) {
        console.error('加载板块基础数据失败:', error);
    }
}

// ========== 【核心重构】加载帖子（包含动态时间筛选逻辑） ==========
// js/posts.js - loadPosts 函数
// js/posts.js - loadPosts 函数

// js/posts.js - loadPosts 函数（热数据 + 冷备份合并）

async function loadPosts() {
    try {
        if (!postsList) return;
        postsList.innerHTML = '<div class="loading-state">加载中...</div>';
        
        const currentUserId = currentUser?.studentId;

        // ========== 1. 加载热数据（Appwrite） ==========
        const queries = [
            Query.equal('boardId', currentBoard.$id),
            Query.limit(100),  // 多取一些用于时间筛选
            Query.orderDesc('$createdAt')
        ];
        
        if (currentPage > 1) {
            queries.push(Query.offset((currentPage - 1) * PAGE_SIZE));
        }

        let hotPosts = [];
        try {
            const response = await databases.listDocuments(DATABASE_ID, COLLECTION_POSTS, queries);
            hotPosts = response.documents;
        } catch (e) {
            console.warn('热数据加载失败，仅显示冷备份:', e.message);
        }

        // ========== 2. 加载冷备份数据 ==========
        let coldPosts = [];
        try {
            const url = `https://cdn.jsdelivr.net/gh/BearThomas/LG-Site-Backup@main/backups/last/posts.json`;
            const backupRes = await fetch(url);
            if (backupRes.ok) {
                const backupData = await backupRes.json();
                let docs = backupData.documents || backupData || [];
                
                // ⭐ 如果加密了，解密
                console.log(`从冷备份获取到 ${docs.length} 条帖子`);
                console.log(backupData);
                if (backupData.encrypted) {
                    docs = await Promise.all(docs.map(async post => ({
                        ...post,
                        content: await decryptText(post.content),
                        title: await decryptText(post.title),
                        authorName: await decryptText(post.authorName),
                        targetGroups: JSON.parse(await decryptText(post.targetGroups) || '[]')
                    })));
                }
                
                coldPosts = docs;
            }
        } catch (e) {
            console.log('无冷备份数据');
        }

        // ========== 3. 统一字段名 ==========
        const normalizePost = (post, isCold) => {
            return {
                $id: post.$id || post.id,
                $createdAt: post.$createdAt || post.createdAt,
                $updatedAt: post.$updatedAt || post.updatedAt,
                title: post.title,
                content: post.content,
                authorId: post.authorId,
                authorName: post.authorName,
                boardId: post.boardId,
                viewPermission: post.viewPermission,
                targetGroups: post.targetGroups || [],
                status: post.status || 0,
                _isCold: isCold
            };
        };

        const normalizedHot = hotPosts.map(p => normalizePost(p, false));
        const normalizedCold = coldPosts.map(p => normalizePost(p, true));

        // ========== 4. 合并 + 去重（按 $id） ==========
        const seen = new Set();
        const allPosts = [...normalizedHot, ...normalizedCold].filter(post => {
            if (seen.has(post.$id)) return false;
            seen.add(post.$id);
            return true;
        });

        // ========== 5. 按时间排序 ==========
        allPosts.sort((a, b) => new Date(b.$createdAt) - new Date(a.$createdAt));

        // ========== 6. 时间筛选 ==========
        let filteredPosts = allPosts;
        if (currentTimeFilter !== 'all') {
            const now = new Date();
            let startTime = new Date();

            if (currentTimeFilter === 'today') {
                startTime.setHours(0, 0, 0, 0);
            } else if (currentTimeFilter === 'week') {
                startTime.setDate(now.getDate() - 7);
            } else if (currentTimeFilter === 'month') {
                startTime.setDate(now.getDate() - 30);
            }

            filteredPosts = allPosts.filter(post => 
                new Date(post.$createdAt) >= startTime
            );
        }

        // ========== 7. 权限过滤 ==========
        const visiblePosts = filteredPosts.filter(post => {
            if (post.viewPermission === 1) return true;
            if (post.authorId === currentUserId) return true;
            if (post.viewPermission === 4) {
                return (post.targetGroups || []).includes(currentUserId);
            }
            return false;
        });

        // ========== 8. 分页 ==========
        const start = (currentPage - 1) * PAGE_SIZE;
        const paged = visiblePosts.slice(start, start + PAGE_SIZE);
        totalPages = Math.ceil(visiblePosts.length / PAGE_SIZE) || 1;

        renderPosts(paged);
        renderPagination();

    } catch (error) {
        console.error('加载帖子失败:', error);
        if (postsList) {
            postsList.innerHTML = `<div class="empty-state"><p>加载失败</p></div>`;
        }
    }
}

// 修改 js/posts.js 中的 renderPosts 函数
function renderPosts(posts) {
    if (!postsList) return;
    if (!posts.length) {
        postsList.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>暂无帖子...</p></div>`;
        return;
    }
    
    postsList.innerHTML = posts.map(post => {
        // 💡 核心兼容修改：如果 Appwrite 原始数据有 $ 符号就用 $，硬备份没有就直接读字段
        const postId = post.$id || post.id;
        const postCreatedAt = post.$createdAt || post.createdAt;
        
        const isPinned = post.status ? (post.status & 1) !== 0 : false;
        const isLocked = post.status ? (post.status & 2) !== 0 : false;
        const createdAt = new Date(postCreatedAt);
        const timeStr = formatTime(createdAt);
        
        return `
            <div class="post-card ${isPinned ? 'pinned' : ''}" data-post-id="${postId}">
                <div class="post-header">
                    <div class="post-avatar">${post.authorName?.charAt(0) || '?'}</div>
                    <div class="post-author-info">
                        <div class="post-author">${escapeHtml(post.authorName || '匿名')}</div>
                        <div class="post-meta">
                            <span>${timeStr}</span>
                            ${isPinned ? '<span class="post-badge pinned-badge">置顶</span>' : ''}
                            ${isLocked ? '<span class="post-badge locked-badge">已锁定</span>' : ''}
                        </div>
                    </div>
                </div>
                <div class="post-title">${escapeHtml(post.title || '无标题')}</div>
                <div class="post-content-preview">${escapeHtml((post.content || '').slice(0, 150))}${post.content?.length > 150 ? '...' : ''}</div>
                <div class="post-footer">
                    <span class="post-stat">👍 0</span>
                    <span class="post-stat">💬 0</span>
                    <span class="post-stat">👁️ 0</span>
                </div>
            </div>
        `;
    }).join('');
    
    // 绑定卡片跳转详情点击事件
    document.querySelectorAll('.post-card').forEach(card => {
        card.addEventListener('click', () => openPostDetail(card.dataset.postId));
    });
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
        html += `<span class="page-ellipsis">...</span>`;
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
            loadPosts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// ========== 发帖 ==========
async function submitPost() {
    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }
    
    const title = postTitle.value.trim();
    const content = postContent.value.trim();
    const visibilityType = document.getElementById('visibilityType').value;
    
    if (!title) {
        alert('请输入标题');
        return;
    }
    if (!content) {
        alert('请输入内容');
        return;
    }
    
    let viewPermission = 1; 
    let targetUsers = [];
    
    if (visibilityType === 'specific') {
        if (selectedUserIds.size === 0) {
            alert('请至少添加一个可见用户');
            return;
        }
        viewPermission = 4; 
        targetUsers = Array.from(selectedUserIds);
    }
    
    const user = JSON.parse(localStorage.getItem('campus_user'));
    
    try {
        const response = await fetch('/.netlify/functions/create-post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: `student_${user.studentId}`,  // 直接传 userId
                boardId: currentBoard.$id,
                title,
                content,
                viewPermission,
                targetUsers
            })
        });
        
        if (response.ok) {
            alert('发布成功！');
            selectedUserIds.clear();
            renderSelectedUsers();
            closeModal();
            loadPosts();
        } else {
            const result = await response.json();
            alert(result.error || '发布失败');
        }
    } catch (err) {
        alert('网络错误，请稍后重试');
    }
}

// ========== 发帖弹窗控制 ==========
function openModal() {
    if (!currentUser) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }
    
    if (postBoardSelect) {
        postBoardSelect.innerHTML = `<option value="main" selected>主板块</option>`;
    }
    
    if (postModal) postModal.style.display = 'flex';
    if (postTitle) postTitle.value = '';
    if (postContent) postContent.value = '';
    
    selectedUserIds.clear(); 
    renderSelectedUsers();   
    
    const visibilityTypeEl = document.getElementById('visibilityType');
    if (visibilityTypeEl) visibilityTypeEl.value = 'all';
    
    const specificUsersArea = document.getElementById('specificUsersArea');
    if (specificUsersArea) specificUsersArea.style.display = 'none';
}

function closeModal() {
    if (postModal) postModal.style.display = 'none';
}

function openPostDetail(postId) {
    location.href = `post.html?id=${postId}`;
}

// ========== 事件绑定 ==========
function bindEvents() {
    if (newPostBtn) newPostBtn.addEventListener('click', openModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (cancelPostBtn) cancelPostBtn.addEventListener('click', closeModal);
    if (submitPostBtn) submitPostBtn.addEventListener('click', submitPost);
    
    if (postModal) {
        postModal.addEventListener('click', (e) => {
            if (e.target === postModal) closeModal();
        });
    }
    
    // 【关键修改】：彻底移除标签筛选的监听，改为完善时间筛选事件
    const timeFilter = document.getElementById('timeFilter');
    if (timeFilter) {
        timeFilter.addEventListener('change', (e) => {
            currentTimeFilter = e.target.value; // 获取选中的时间范围值
            currentPage = 1; // 筛选条件改变，分页重置为第一页
            loadPosts(); // 重新加载数据
        });
    }
    
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
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

// ========== 可见范围管理 ==========
let selectedUserIds = new Set(); 

const visibilityTypeEl = document.getElementById('visibilityType');
if (visibilityTypeEl) {
    visibilityTypeEl.addEventListener('change', function() {
        const specificArea = document.getElementById('specificUsersArea');
        if (specificArea) {
            specificArea.style.display = this.value === 'specific' ? 'block' : 'none';
        }
    });
}

const searchUserBtn = document.getElementById('searchUserBtn');
if (searchUserBtn) searchUserBtn.addEventListener('click', searchUsers);

const userSearchInput = document.getElementById('userSearchInput');
if (userSearchInput) {
    userSearchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchUsers();
    });
}

async function searchUsers() {
    const searchInput = document.getElementById('userSearchInput');
    const resultsContainer = document.getElementById('searchResults');
    if (!searchInput || !resultsContainer) return;

    const keyword = searchInput.value.trim();
    if (!keyword) {
        resultsContainer.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`/.netlify/functions/search-users?keyword=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        if (data.users && data.users.length > 0) {
            resultsContainer.innerHTML = data.users.map(user => {
                const isAdded = selectedUserIds.has(user.studentId);
                return `
                    <div class="search-result-item">
                        <div class="user-info">
                            <div class="user-avatar-small">${user.studentId.charAt(0)}</div>
                            <span class="user-student-id">${user.studentId}</span>
                        </div>
                        <button class="add-user-btn ${isAdded ? 'added' : ''}" 
                                data-student-id="${user.studentId}"
                                ${isAdded ? 'disabled' : ''}>
                            ${isAdded ? '已添加' : '+ 添加'}
                        </button>
                    </div>
                `;
            }).join('');
            
            resultsContainer.querySelectorAll('.add-user-btn:not(.added)').forEach(btn => {
                btn.addEventListener('click', function() {
                    addUser(this.dataset.studentId);
                });
            });
        } else {
            resultsContainer.innerHTML = '<div class="search-empty">未找到该学号的用户</div>';
        }
        
        resultsContainer.style.display = 'block';
    } catch (err) {
        console.error('搜索用户失败:', err);
        resultsContainer.innerHTML = '<div class="search-empty">搜索失败，请重试</div>';
        resultsContainer.style.display = 'block';
    }
}

function addUser(studentId) {
    selectedUserIds.add(studentId);
    renderSelectedUsers();
    const resultsContainer = document.getElementById('searchResults');
    const searchInput = document.getElementById('userSearchInput');
    if (resultsContainer) resultsContainer.style.display = 'none';
    if (searchInput) searchInput.value = '';
}

function removeUser(studentId) {
    selectedUserIds.delete(studentId);
    renderSelectedUsers();
}

function renderSelectedUsers() {
    const container = document.getElementById('selectedUsers');
    const countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = selectedUserIds.size;
    if (!container) return;
    
    if (selectedUserIds.size === 0) {
        container.innerHTML = '<div class="no-users-hint">尚未添加用户</div>';
        return;
    }
    
    container.innerHTML = Array.from(selectedUserIds).map(studentId => `
        <span class="user-tag">
            ${studentId}
            <span class="remove-tag" data-student-id="${studentId}">&times;</span>
        </span>
    `).join('');
    
    container.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', function() {
            removeUser(this.dataset.studentId);
        });
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
    div.textContent = text;
    return div.innerHTML;
}

async function decryptColdData(encryptedText) {
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