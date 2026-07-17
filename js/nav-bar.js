(function() {
    'use strict';

    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    const userNameSpan = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const logoutBtn = document.getElementById('logoutBtn');

    function readSavedUser() {
        try {
            const user = JSON.parse(localStorage.getItem('campus_user') || 'null');
            if (!user || user.authVersion !== 2 || !user.studentId) return null;
            return user;
        } catch {
            return null;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function authHeaders(user) {
        const headers = {};
        if (user?.appToken) headers['X-LG-Token'] = user.appToken;
        if (user?.token) headers['X-Appwrite-Session'] = user.token;
        return headers;
    }

    function renderNavbarAvatar(name, avatarUrl) {
        if (!userAvatar) return;
        const cleanName = String(name || '').trim();
        const cleanUrl = String(avatarUrl || '').trim();
        const isImage = cleanUrl.startsWith('https://') || cleanUrl.startsWith('http://') || cleanUrl.startsWith('data:') || (cleanUrl.startsWith('/') && !cleanUrl.startsWith('//'));

        userAvatar.style.overflow = 'hidden';
        userAvatar.style.border = 'none';
        userAvatar.style.padding = '0';
        userAvatar.style.boxShadow = 'none';
        userAvatar.style.outline = 'none';
        userAvatar.style.webkitTapHighlightColor = 'transparent';

        if (isImage) {
            userAvatar.style.backgroundColor = 'transparent';
            userAvatar.replaceChildren();
            const image = document.createElement('img');
            image.src = cleanUrl;
            image.alt = '用户头像';
            image.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;background:transparent;';
            userAvatar.appendChild(image);
        } else {
            userAvatar.textContent = cleanName.charAt(0) || '?';
            userAvatar.style.backgroundColor = '#228be6';
            userAvatar.style.lineHeight = '40px';
            userAvatar.style.color = '#ffffff';
            userAvatar.style.fontWeight = 'bold';
        }
    }

    function showNotLoggedIn() {
        if (userNotLogin) userNotLogin.style.display = 'flex';
        if (userLoggedIn) userLoggedIn.style.display = 'none';
    }

    function showLoggedIn(name, avatar, studentId) {
        if (userNotLogin) userNotLogin.style.display = 'none';
        if (userLoggedIn) userLoggedIn.style.display = 'flex';
        
        let displayName = escapeHtml(name || '同学');
        const sid = (studentId || '').toString().replace(/^student_/, '').trim();
        if (sid.length >= 4) displayName = `${displayName}<span class="year-badge">${sid.substring(0, 4)}届</span>`;
        if (userNameSpan) userNameSpan.innerHTML = displayName;

        renderNavbarAvatar(name, avatar);
    }

    async function checkLoginStatus() {
        const user = readSavedUser();
        if (!user) {
            localStorage.removeItem('campus_user');
            showNotLoggedIn();
            return;
        }

        showLoggedIn(user.name || user.studentId, user.avatar || '', user.studentId);
        try {
            const response = await fetch('/api/auth-me', { headers: authHeaders(user) });
            if (response.status === 401) {
                localStorage.removeItem('campus_user');
                showNotLoggedIn();
                return;
            }
            if (!response.ok) return;
            const result = await response.json();
            const profile = result.profile || {};
            user.name = profile.name || user.name;
            user.avatar = profile.avatar || '';
            user.appToken = result.appToken || user.appToken || '';
            user.ownedBoards = profile.ownedBoards || [];
            user.joinedBoards = profile.joinedBoards || [];
            user.role = profile.role || 'normal';
            user.permissions = profile.permissions ?? 31;
            // A legacy release stored the Appwrite session in localStorage.
            // /api/auth-me has now migrated it into an HttpOnly cookie.
            delete user.token;
            localStorage.setItem('campus_user', JSON.stringify(user));
            showLoggedIn(user.name, user.avatar, user.studentId);
        } catch (error) {
            console.warn('顶栏资料同步失败，继续使用本地缓存:', error.message);
        }
    }

    userAvatar?.addEventListener('click', event => {
        event.stopPropagation();
        dropdownMenu?.classList.toggle('show');
    });
    document.addEventListener('click', () => dropdownMenu?.classList.remove('show'));

    logoutBtn?.addEventListener('click', async event => {
        event.preventDefault();
        const user = readSavedUser();
        if (user) {
            try {
                await fetch('/api/auth-logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders(user) },
                    body: JSON.stringify({
                        studentId: user.studentId,
                        appToken: user.appToken || '',
                        sessionSecret: user.token || ''
                    })
                });
            } catch (error) {
                console.warn('云端退出失败，已清理本地会话:', error.message);
            }
        }
        if (typeof localforage !== 'undefined') {
            try { await localforage.removeItem('secure_gate_key'); } catch {}
        }
        localStorage.removeItem('campus_user');
        localStorage.removeItem('persistent_jwt');
        showNotLoggedIn();
        location.reload();
    });

    checkLoginStatus();
    window.addEventListener('storage', event => {
        if (event.key === 'campus_user') checkLoginStatus();
    });
    window.refreshNavbar = checkLoginStatus;
})();
