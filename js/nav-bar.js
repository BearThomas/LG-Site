// ========== 🏔️ 终极闭环：自动下井捞数据库版顶栏组件 ==========
// Made by BearThomas 2026/5/31
(function() {
    'use strict';
    
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    const userNameSpan = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // 配置与数据库常数
    const DATABASE_ID = 'lg';
    const COLLECTION_USERS = 'users';

    // ========== 🌟 顶栏全能响应式头像渲染器 ==========
    function renderNavbarAvatar(name, avatarUrl) {
        if (!userAvatar) return;
        
        const cleanName = (name || '').toString().trim();
        const cleanUrl = (avatarUrl || '').toString().trim();
        
        // 判定是否为合法的第三方网络图片链接
        const isImgUrl = cleanUrl && (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') || cleanUrl.startsWith('/'));
        
        if (isImgUrl) {
            // 💡【核心修复】：不仅给图片加控制，反手把外层这个 button 容器的边框、背景、阴影通通扬了！
            userAvatar.innerHTML = `<img src="${cleanUrl}" style="width: 100% !important; height: 100% !important; border-radius: 50%; object-fit: cover; display: block;" alt="用户头像">`;
            
            // 🧼 强行给外层 Button 物理洗白，剥夺它的所有皮肤属性：
            userAvatar.style.overflow = 'hidden';
            userAvatar.style.backgroundColor = 'transparent'; // 变透明，彻底干掉按钮内部残留的蓝色
            userAvatar.style.border = 'none';                  // 斩断按钮自带的蓝色边框
            userAvatar.style.padding = '0';                    // 防止内边距把图片往里挤、露出按钮底色
            userAvatar.style.boxShadow = 'none';               // 掐断可能存在的蓝色阴影
            userAvatar.style.outline = 'none';                 // 防止点击时产生蓝色的外轮廓线
        } else {
            // 🔤 降级兜底：只有显示首字时，才允许重新染上炫彩主题蓝
            userAvatar.textContent = cleanName ? cleanName.charAt(0) : '?';
            userAvatar.style.backgroundColor = '#228be6'; // 恢复原来的 button 颜色
            userAvatar.style.border = '';                 // 恢复默认边框
            userAvatar.style.lineHeight = '40px'; 
        }
    }

    // ========== 🌟 核心流控：先本地粗渲染，再异步深入数据库翻新 ==========
    async function checkLoginStatus() {
        const userData = localStorage.getItem('campus_user');
        
        if (!userData) {
            showNotLoggedIn();
            return;
        }
        
        try {
            const user = JSON.parse(userData);
            const myUid = (user.studentId || user.userId || '').toString().trim();

            // 🚀 【阶梯一：先从缓存读，秒展示（绝不等待网络，防止视觉卡顿）】
            let currentName = user.name || user.studentId;
            let currentAvatar = user.avatar || '';
            showLoggedIn(currentName, currentAvatar);

            // 🚀 【阶梯二：深度穿透，对齐页面可能已经拉好的 window.userCache 大字典】
            if (window.userCache && window.userCache[myUid]) {
                const globalCache = window.userCache[myUid];
                currentName = globalCache.name || currentName;
                currentAvatar = globalCache.avatar || currentAvatar;
                showLoggedIn(currentName, currentAvatar);
                
                // 自愈同步，修正本地单机缓存
                if (user.name !== globalCache.name || user.avatar !== globalCache.avatar) {
                    user.name = globalCache.name;
                    user.avatar = globalCache.avatar;
                    localStorage.setItem('campus_user', JSON.stringify(user));
                }
                return; // 既然页面大字典已经命中，直接收兵，不耗费云端额外额度
            }

            // 🚀 【阶梯三：终极防御！如果页面没加载大字典（如独立页面），顶栏主动下井查 user 数据库表】
            // 判定是否能蹭到当前页面可能已经 import 好的 Appwrite SDK 实例
            if (myUid) {
                try {
                    // 动态按需导入高权 SDK，或者直接使用页面上现成的 databases 实例
                    let dbInstance = window.databases;
                    
                    if (!dbInstance) {
                        const { Client, Databases } = await import('https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm');
                        const navClient = new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('lg');
                        dbInstance = new Databases(navClient);
                    }

                    // 🛠️ 核心穿透：直奔 user 数据库表，精准抓取这名学生的专属名片行
                    const userDoc = await dbInstance.getDocument(DATABASE_ID, COLLECTION_USERS, myUid);
                    
                    if (userDoc) {
                        const dbName = userDoc.name || currentName;
                        const dbAvatar = userDoc.avatar || '';

                        // 翻新顶栏 DOM
                        showLoggedIn(dbName, dbAvatar);

                        // 💡 顺手强行缝合洗白 LocalStorage，保证下一次跳页时开局就是最新的！
                        if (user.name !== dbName || user.avatar !== dbAvatar) {
                            user.name = dbName;
                            user.avatar = dbAvatar;
                            localStorage.setItem('campus_user', JSON.stringify(user));
                        }
                    }
                } catch (dbError) {
                    // 静默降级，不阻断主线
                    console.log("ℹ️ 顶栏主动穿透数据库受阻（可能由于未登录或跨域），保持本地粗渲染快照.");
                }
            }
            
        } catch (e) {
            localStorage.removeItem('campus_user');
            showNotLoggedIn();
        }
    }
    
    function showNotLoggedIn() {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
    }
    
    function showLoggedIn(displayName, avatarUrl) {
        if (userNotLogin) userNotLogin.style.display = 'none';
        if (userLoggedIn) userLoggedIn.style.display = 'flex';
        
        if (userNameSpan) {
            userNameSpan.textContent = escapeHtml(displayName);
        }
        renderNavbarAvatar(displayName, avatarUrl);
    }
    
    // 下拉菜单切换
    if (userAvatar) {
        userAvatar.addEventListener('click', (e) => {
            if (!dropdownMenu) return;
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });
    }
    
    document.addEventListener('click', () => {
        if (dropdownMenu) dropdownMenu.classList.remove('show');
    });
    
    // 退出登录
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const { Client, Account } = await import('https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm');
                const client = new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('lg');
                const account = new Account(client);
                await account.deleteSession('current');
            } catch (err) {
                console.warn('删除云端会话阻碍:', err.message);
            }
            
            if (typeof localforage !== 'undefined') {
                try { await localforage.removeItem('secure_gate_key'); } catch (clearDbErr) {}
            }
            
            localStorage.removeItem('campus_user');
            showNotLoggedIn();
            window.location.reload();
        });
    }
    
    // 🚀 初始化：开局一瞬间，本地有什么立刻先展示出来
    checkLoginStatus();
    
    // 🌟【高频动态自愈哨兵】：在关键加载时间点反向检查
    setTimeout(checkLoginStatus, 80);
    setTimeout(checkLoginStatus, 500);
    setTimeout(checkLoginStatus, 1500); 
    
    window.addEventListener('storage', (e) => {
        if (e.key === 'campus_user') {
            checkLoginStatus();
        }
    });

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
    
    // 暴露出全局接口
    window.refreshNavbar = checkLoginStatus;
    
})();