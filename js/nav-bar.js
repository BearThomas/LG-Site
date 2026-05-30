// ========== 登录状态管理 ==========
(function() {
    'use strict';
    
    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    const userNameSpan = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // 检查登录状态
    function checkLoginStatus() {
        const userData = localStorage.getItem('campus_user');
        
        if (!userData) {
            showNotLoggedIn();
            return;
        }
        
        try {
            const user = JSON.parse(userData);
            showLoggedIn(user.studentId);
        } catch (e) {
            localStorage.removeItem('campus_user');
            showNotLoggedIn();
        }
    }
    
    function showNotLoggedIn() {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
    }
    
    function showLoggedIn(studentId) {
        if (userNotLogin) userNotLogin.style.display = 'none';
        if (userLoggedIn) userLoggedIn.style.display = 'flex';
        
        if (userNameSpan) {
            userNameSpan.textContent = `学号尾号 ${studentId.slice(-4)}`;
        }
        
        if (userAvatar) {
            userAvatar.textContent = studentId.charAt(0);
        }
    }
    
    // 下拉菜单切换
    if (userAvatar) {
        userAvatar.addEventListener('click', (e) => {
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
            
            // 1. 删除服务端 Session
            try {
                const { Client, Account } = await import('https://cdn.jsdelivr.net/npm/appwrite@14.0.0/+esm');
                const client = new Client()
                    .setEndpoint('https://sgp.cloud.appwrite.io/v1')
                    .setProject('lg');
                const account = new Account(client);
                await account.deleteSession('current');
            } catch (err) {
                console.warn('删除会话失败:', err.message);
            }
            
            // 2. 清空本地存储
            localStorage.removeItem('campus_user');
            showNotLoggedIn();
            
            // 3. 刷新页面
            window.location.reload();
        });
    }
    
    // 初始化
    checkLoginStatus();
    
    // 监听 storage 变化（多标签页同步）
    window.addEventListener('storage', (e) => {
        if (e.key === 'campus_user') {
            checkLoginStatus();
        }
    });
    
})();