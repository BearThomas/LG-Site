// js/profile.js
// Made by BearThomas 2026/5/30
import { Client, Databases } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';
import {
    APPWRITE_ENDPOINT,
    APPWRITE_PROJECT_ID,
    COLLECTION_USERS,
    DATABASE_ID
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
    document.getElementById('profileUsername').textContent = currentUser.name || '未设置名称';
    document.getElementById('nameInput').value = currentUser.name || '';
    document.getElementById('avatarInput').value = currentUser.avatar || ''; // 回显本地记录的头像链接
    updateAvatarPreview(currentUser.name, currentUser.avatar);

    // 2. 异步向云端对齐最新个性化资料
    try {
        const userDoc = await databases.getDocument(DATABASE_ID, COLLECTION_USERS, currentUser.userId);
        if (userDoc) {
            document.getElementById('profileUsername').textContent = userDoc.name || '未设置名称';
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
        console.warn('静默同步云端资料受阻，保持本地快照渲染:', e.message);
    }
}

// ========== 🌟 智能头像全能渲染器 ==========
function updateAvatarPreview(name, avatarUrl) {
    const avatarText = document.getElementById('avatarText');
    const avatarImg = document.getElementById('avatarImg');
    
    if (!avatarText || !avatarImg) return;

    // 盘查是否输入了合法的图片网络链接
    const hasUrl = avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://') || avatarUrl.startsWith('/'));

    if (hasUrl) {
        // 模式 A：渲染网络图片头像
        avatarText.style.display = 'none';
        avatarImg.src = avatarUrl.trim();
        avatarImg.style.display = 'block';
    } else {
        // 模式 B：降级渲染动态首字文本头像
        avatarImg.style.display = 'none';
        avatarImg.src = '';
        const cleanName = name ? name.trim() : '';
        avatarText.textContent = cleanName ? cleanName.charAt(0) : '?';
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
                sessionSecret: currentUser.token
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
        document.getElementById('profileUsername').textContent = currentUser.name;
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
                sessionSecret: currentUser.token
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
}

document.addEventListener('DOMContentLoaded', async () => {
    await initProfile();
    bindEvents();
});
