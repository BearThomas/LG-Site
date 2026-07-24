// js/profile.js
// Made by BearThomas 2026/5/30
import { Client, Databases, Query } from './d1-appwrite-compat.js';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_USERS,
    DATABASE_ID,
    COLLECTION_POSTS,
    COLLECTION_COMMENTS,
    setupImageUpload
} from './shared.js';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
const databases = new Databases(client);

let currentUser = null;

function applyAppwriteAuth(savedUser) {
    const token = savedUser?.token;
    if (!token) return;

    if (typeof client.setSession === 'function') {
        client.setSession(token);
        return;
    }

    if (typeof token === 'string' && token.split('.').length === 3) {
        client.setJWT(token);
    }
}

// ========== 页面初始化入口 ==========
async function initProfile() {
    const userData = localStorage.getItem('campus_user');
    if (!userData) {
        alert('请先登录');
        location.href = 'login.html';
        return;
    }

    try {
        currentUser = JSON.parse(userData);
        if (currentUser.authVersion !== 2) {
            throw new Error('旧登录凭证已失效');
        }
        applyAppwriteAuth(currentUser);
    } catch (err) {
        localStorage.removeItem('campus_user');
        location.href = 'login.html';
        return;
    }

    const validUid = currentUser.studentId || currentUser.userId || currentUser.$id;
    if (!validUid) {
        alert('登录凭证不完整，请重新登录');
        location.href = 'login.html';
        return;
    }
    const cleanUid = String(validUid).replace(/^student_/, '');
    currentUser.userId = cleanUid;
    currentUser.studentId = currentUser.studentId || cleanUid;

    // 1. 瞬间本地回显 (防止白屏)
    document.getElementById('profileUserId').textContent = `ID: ${currentUser.userId}`;
    
            let __name = window.escapeHtml ? window.escapeHtml(currentUser.name || '未设置名称') : currentUser.name || '未设置名称';

            let __sid = ((currentUser || window.currentUser || {}).studentId || '').toString().replace(/^student_/, '').trim();
            if (__sid.length >= 4) __name = `${__name}<span class="year-badge">${__sid.substring(0, 4)}级</span>`;
            document.getElementById('profileUsername').innerHTML = __name;
            
            const followingCountEl = document.getElementById('profileFollowingCount');
            if (followingCountEl) {
                followingCountEl.textContent = currentUser.followingCount || 0;
                followingCountEl.parentElement.addEventListener('click', () => {
                    if (window.showFollowsList) window.showFollowsList('关注列表', currentUser.studentId || currentUser.userId, 'following');
                });
            }
            const followersCountEl = document.getElementById('profileFollowersCount');
            if (followersCountEl) {
                followersCountEl.textContent = currentUser.followersCount || 0;
                followersCountEl.parentElement.addEventListener('click', () => {
                    if (window.showFollowsList) window.showFollowsList('粉丝列表', currentUser.studentId || currentUser.userId, 'followers');
                });
            }
    document.getElementById('nameInput').value = currentUser.name || '';
    document.getElementById('avatarInput').value = currentUser.avatar || ''; // 回显本地记录的头像链接
    updateAvatarPreview(currentUser.name, currentUser.avatar);

    // 2. 异步向云端对齐最新个性化资料
    try {
        const userDoc = await databases.getDocument(DATABASE_ID, COLLECTION_USERS, currentUser.userId);
        if (userDoc) {
            
            let __name = window.escapeHtml ? window.escapeHtml(userDoc.name || '未设置名称') : userDoc.name || '未设置名称';

            let __sid = ((currentUser || window.currentUser || {}).studentId || '').toString().replace(/^student_/, '').trim();
            if (__sid.length >= 4) __name = `${__name}<span class="year-badge">${__sid.substring(0, 4)}级</span>`;
            document.getElementById('profileUsername').innerHTML = __name;
            
            document.getElementById('nameInput').value = userDoc.name || '';
            document.getElementById('avatarInput').value = userDoc.avatar || ''; // 刷入云端最新网址
            
            // 实时渲染最新头像
            updateAvatarPreview(userDoc.name, userDoc.avatar);

            // 联动重写本地缓存
            currentUser.name = userDoc.name;
            currentUser.avatar = userDoc.avatar;
            localStorage.setItem('campus_user', JSON.stringify(currentUser));
        }
    } catch (e) {
        console.warn('静默同步云端资料受阻，保持本地快照渲染', e.message);
    }
}

// ========== 🌟 智能头像全能渲染器 ==========
function updateAvatarPreview(name, avatarUrl) {
    const avatarText = document.getElementById('avatarText');
    const avatarImg = document.getElementById('avatarImg');
    const avatarPreview = document.getElementById('avatarPreview');
    
    if (!avatarText || !avatarImg) return;

    if (avatarPreview) {
        avatarPreview.style.backgroundColor = 'var(--accent, #228be6)';
        avatarPreview.style.color = '#ffffff';
        avatarPreview.style.fontWeight = 'bold';
    }

    const cleanUrl = avatarUrl ? avatarUrl.trim() : '';
    const hasUrl = cleanUrl && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('/') || cleanUrl.startsWith('data:'));
    const firstChar = (name || '?').trim().replace(/^同学.*/, '学').charAt(0) || '?';

    if (hasUrl) {
        avatarText.style.display = 'none';
        avatarImg.src = cleanUrl;
        avatarImg.onerror = () => {
            avatarImg.style.display = 'none';
            avatarImg.src = '';
            avatarText.textContent = firstChar;
            avatarText.style.display = 'block';
        };
        avatarImg.style.display = 'block';
    } else {
        avatarImg.style.display = 'none';
        avatarImg.src = '';
        avatarText.textContent = firstChar;
        avatarText.style.display = 'block';
    }
}

// ========== 保存个人资料 (包含姓名和头像网址) ==========
async function saveProfile() {
    const newName = document.getElementById('nameInput').value.trim();
    const newAvatar = document.getElementById('avatarInput').value.trim();

    if (!newName) {
        alert('名字或昵称不能为空');
        return;
    }

    const saveBtn = document.getElementById('saveProfileBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = '正在同步云端...';

    try {
        const response = await fetch('/api/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.studentId || currentUser.userId,
                name: newName,
                avatar: newAvatar,
                sessionSecret: currentUser.token,
                appToken: currentUser.appToken
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            throw new Error(result.error || '保存失败');
        }

        // 3. 实时翻新本地高速缓存，确保系统顶栏、主页侧边栏无视刷新直观同步
        currentUser.name = result.name || newName;
        currentUser.avatar = result.avatar || newAvatar;
        localStorage.setItem('campus_user', JSON.stringify(currentUser));

        // 刷新左侧卡片预览
        
            let __name = window.escapeHtml ? window.escapeHtml(currentUser.name) : currentUser.name;

            let __sid = ((currentUser || window.currentUser || {}).studentId || '').toString().replace(/^student_/, '').trim();
            if (__sid.length >= 4) __name = `${__name}<span class="year-badge">${__sid.substring(0, 4)}级</span>`;
            document.getElementById('profileUsername').innerHTML = __name;
            
        updateAvatarPreview(currentUser.name, currentUser.avatar);
        
        alert('个人中心资料（含自定义头像）已成功保存！');
    } catch (error) {
        console.error('修改个性化名片失败:', error);
        alert(`保存失败: ${error.message || '网络通信故障'}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存资料';
    }
}

// ========== 修改账户密码 ==========
async function updatePassword() {
    const oldPassword = document.getElementById('oldPasswordInput').value.trim();
    const newPassword = document.getElementById('newPasswordInput').value.trim();

    if (!oldPassword || !newPassword) {
        alert('请完整填写原当前密码与安全新密码');
        return;
    }
    if (newPassword.length < 8) {
        alert('新密码安全强度不足，长度至少为 8 位');
        return;
    }

    const pwdBtn = document.getElementById('updatePasswordBtn');
    pwdBtn.disabled = true;
    pwdBtn.textContent = '正在修改...';

    try {
        const response = await fetch('/api/update-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                studentId: currentUser.studentId || currentUser.userId,
                oldPassword,
                newPassword,
                sessionSecret: currentUser.token,
                appToken: currentUser.appToken
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.success) {
            throw new Error(result.error || '修改失败');
        }

        alert('密码修改成功！为了安全，系统将重新对齐会话，请重新登录。');
        localStorage.removeItem('campus_user');
        location.href = 'login.html';
    } catch (error) {
        alert(`修改失败: ${error.message || '网络连接异常'}`);
    } finally {
        pwdBtn.disabled = false;
        pwdBtn.textContent = '修改账户密码';
    }
}

// ========== 底层事件监听绑定 ==========
function bindEvents() {
    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
    document.getElementById('updatePasswordBtn')?.addEventListener('click', updatePassword);
    
    // 监听姓名输入框，实时刷新首字
    document.getElementById('nameInput')?.addEventListener('input', (e) => {
        const currentAvatarUrl = document.getElementById('avatarInput').value;
        updateAvatarPreview(e.target.value, currentAvatarUrl);
    });

    // 🌟 新增：当学生在头像框里粘贴或修改网址时，左侧名片瞬间变幻加载新图片，交互感拉满！
    document.getElementById('avatarInput')?.addEventListener('input', (e) => {
        const currentName = document.getElementById('nameInput').value;
        updateAvatarPreview(currentName, e.target.value);
    });

    setupImageUpload('uploadAvatarBtn', 'avatarFileInput', null, currentUser, (url) => {
        const avatarInput = document.getElementById('avatarInput');
        if (avatarInput) {
            avatarInput.value = url;
            const currentName = document.getElementById('nameInput')?.value || '';
            updateAvatarPreview(currentName, url);
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await initProfile();
    bindEvents();
});


// ========================== 我的足迹功能 ==========================
const tabMyPosts = document.getElementById('tabMyPosts');
const tabMyComments = document.getElementById('tabMyComments');
const myPostsList = document.getElementById('myPostsList');
const myCommentsList = document.getElementById('myCommentsList');

if (tabMyPosts && tabMyComments) {
    tabMyPosts.addEventListener('click', () => {
        tabMyPosts.style.fontWeight = 'bold';
        tabMyPosts.style.color = 'var(--accent)';
        tabMyComments.style.fontWeight = 'normal';
        tabMyComments.style.color = 'var(--text-secondary)';
        myPostsList.style.display = 'block';
        myCommentsList.style.display = 'none';
        loadMyActivity('posts');
    });

    tabMyComments.addEventListener('click', () => {
        tabMyComments.style.fontWeight = 'bold';
        tabMyComments.style.color = 'var(--accent)';
        tabMyPosts.style.fontWeight = 'normal';
        tabMyPosts.style.color = 'var(--text-secondary)';
        myCommentsList.style.display = 'block';
        myPostsList.style.display = 'none';
        loadMyActivity('comments');
    });
}

async function loadMyActivity(type) {
    const listElement = type === 'posts' ? myPostsList : myCommentsList;
    if (!currentUser || !currentUser.studentId) {
        listElement.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">请先登录</div>';
        return;
    }
    
    // Check if already loaded
    if (listElement.getAttribute('data-loaded')) return;
    
    listElement.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">正在检索...</div>';

    try {
        const response = await fetch(`/api/my-activity?type=${encodeURIComponent(type)}`, {
            headers: currentUser.appToken ? { 'X-LG-Token': currentUser.appToken } : {}
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || '加载失败');
        const allDocs = Array.isArray(result.documents) ? result.documents : [];

        if (allDocs.length === 0) {
            listElement.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">暂无足迹</div>';
        } else {
            const escapeText = value => {
                const element = document.createElement('div');
                element.textContent = String(value ?? '');
                return element.innerHTML;
            };
            listElement.innerHTML = allDocs.map(doc => {
                const date = new Date(doc.$createdAt || doc.createdAt || doc.created_at).toLocaleString();
                if (type === 'posts') {
                    return `<div style="padding: 10px; border-bottom: 1px solid var(--border); cursor: pointer;" onclick="location.href='post?id=${doc.$id || doc.id}'">
                        <strong style="color: var(--text-primary);">${escapeText(doc.title || '无标题')}</strong>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">${date}</div>
                    </div>`;
                } else {
                    return `<div style="padding: 10px; border-bottom: 1px solid var(--border); cursor: pointer;" onclick="location.href='post?id=${doc.postId || doc.post_id}'">
                        <div style="color: var(--text-secondary);">${escapeText(doc.content || '...')}</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">${date} - 回复</div>
                    </div>`;
                }
            }).join('');
        }
        
        listElement.setAttribute('data-loaded', 'true');
    } catch(err) {
        console.error("加载足迹失败:", err);
        listElement.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger, #fa5252);">加载失败，请重试</div>';
    }
}

// Ensure loadMyActivity is called once user is loaded. We can just add an interval to wait for currentUser to be set if it takes time.
let activityLoadTimer = setInterval(() => {
    if (currentUser && currentUser.studentId) {
        clearInterval(activityLoadTimer);
        loadMyActivity('posts'); // Load default
    } else if (currentUser === null && window.localStorage.getItem('campus_user') === null) {
        clearInterval(activityLoadTimer);
        myPostsList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">请先登录</div>';
    }
}, 500);
