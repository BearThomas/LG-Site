// js/profile.js
// Made by BearThomas 2026/5/30
import { Client, Databases, Account } from 'https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm';

// ========== Appwrite 配置 ==========
const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = 'lg';
const DATABASE_ID = 'lg';
const COLLECTION_USERS = 'users';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
const databases = new Databases(client);
const account = new Account(client);

let currentUser = null;

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
    } catch (err) {
        localStorage.removeItem('campus_user');
        location.href = 'login.html';
        return;
    }

    const validUid = currentUser.userId || currentUser.studentId || currentUser.$id;
    if (!validUid) {
        alert('登录凭证不完整，请重新登录');
        location.href = 'login.html';
        return;
    }
    currentUser.userId = validUid; 

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
        alert('❌ 名字或昵称不能为空');
        return;
    }

    const saveBtn = document.getElementById('saveProfileBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = '正在同步云端...';

    try {
        // 1. 同步更变 Appwrite Auth 账户中心的全局显示名称
        await account.updateName(newName);

        // 2. 将新的昵称和头像图片链接（URL字符串）共同砸进用户扩展数据库文档
        await databases.updateDocument(DATABASE_ID, COLLECTION_USERS, currentUser.userId, {
            name: newName,
            avatar: newAvatar || null // 如果没填就归于 null 释放
        });

        // 3. 实时翻新本地高速缓存，确保系统顶栏、主页侧边栏无视刷新直观同步
        currentUser.name = newName;
        currentUser.avatar = newAvatar;
        localStorage.setItem('campus_user', JSON.stringify(currentUser));

        // 刷新左侧卡片预览
        document.getElementById('profileUsername').textContent = newName;
        updateAvatarPreview(newName, newAvatar);
        
        alert('✨ 个人中心资料（含自定义头像）已成功保存！');
    } catch (error) {
        console.error('修改个性化名片失败:', error);
        alert(`❌ 保存失败: ${error.message || '网络通信故障'}`);
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
        alert('❌ 请完整填写原当前密码与安全新密码');
        return;
    }
    if (newPassword.length < 6) {
        alert('❌ 新密码安全强度不足，长度至少为 6 位');
        return;
    }

    const pwdBtn = document.getElementById('updatePasswordBtn');
    pwdBtn.disabled = true;

    try {
        await account.updatePassword(newPassword, oldPassword);
        alert('🔒 密码修改成功！为了安全，系统将重新对齐会话，请重新登录。');
        localStorage.removeItem('campus_user');
        location.href = 'login.html';
    } catch (error) {
        if (error.code === 401 || error.message.includes("Invalid credentials")) {
            alert('❌ 修改失败：当前的旧密码输入错误，或当前登录会话已过期失效！');
        } else {
            alert(`❌ 修改失败: ${error.message || '网络连接异常'}`);
        }
    } {
        pwdBtn.disabled = false;
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