(function() {
    'use strict';

    const userNotLogin = document.getElementById('userNotLogin');
    const userLoggedIn = document.getElementById('userLoggedIn');
    const userNameSpan = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const logoutBtn = document.getElementById('logoutBtn');

    const bellOutline = '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z"/></svg>';
    const bellFilled = '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zm.995-14.901a1 1 0 1 0-1.99 0A5.002 5.002 0 0 0 3 6c0 1.098-.5 6-2 7h14c-1.5-1-2-5.902-2-7 0-2.42-1.72-4.44-4.005-4.901z"/></svg>';
    const primaryNavIcons = {
        home: '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.354 1.146ZM2.5 14V7.707l5.5-5.5 5.5 5.5V14H10v-4a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4H2.5Z"/></svg>',
        posts: '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 0A1.5 1.5 0 0 0 0 1.5V13a1 1 0 0 0 1 1V1.5a.5.5 0 0 1 .5-.5H14a1 1 0 0 0-1-1H1.5z"/><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v11A1.5 1.5 0 0 0 3.5 16h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 16 9.586V3.5A1.5 1.5 0 0 0 14.5 2h-11zM3 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V9h-4.5A1.5 1.5 0 0 0 9 10.5V15H3.5a.5.5 0 0 1-.5-.5v-11zm7 11.293V10.5a.5.5 0 0 1 .5-.5h4.293L10 14.793z"/></svg>',
        confession: '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z"/></svg>',
        events: '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 .5a.5.5 0 0 1 .5.5v.5h7V1a.5.5 0 0 1 1 0v.5h1A1.5 1.5 0 0 1 15 3v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 14V3a1.5 1.5 0 0 1 1.5-1.5h1V1a.5.5 0 0 1 .5-.5ZM2 6v8a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V6H2Zm0-1h12V3a.5.5 0 0 0-.5-.5h-1V3a.5.5 0 0 1-1 0v-.5h-7V3a.5.5 0 0 1-1 0v-.5h-1A.5.5 0 0 0 2 3v2Z"/></svg>',
        docs: '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/></svg>'
    };

    function normalizePrimaryNavIcons(navBar) {
        navBar.querySelectorAll('.nav-bar-item').forEach(item => {
            const target = `${item.getAttribute('onclick') || ''} ${item.dataset.navEvents || ''}`;
            const key = target.includes('events') || item.dataset.navEvents ? 'events'
                : target.includes('confession') ? 'confession'
                    : target.includes('posts') ? 'posts'
                        : target.includes('docs') ? 'docs'
                            : target.includes("'./'") ? 'home' : '';
            if (!key) return;
            item.querySelector('svg')?.remove();
            item.insertAdjacentHTML('afterbegin', primaryNavIcons[key]);
        });
    }

    function renderNotificationIcon(unreadCount = 0) {
        const navMessages = document.getElementById('navMessages');
        if (!navMessages) return;
        const iconWrapper = document.createElement('span');
        iconWrapper.className = 'notification-icon-wrap';
        iconWrapper.innerHTML = unreadCount > 0 ? bellFilled : bellOutline;
        if (unreadCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'nav-badge';
            iconWrapper.appendChild(badge);
        }
        navMessages.replaceChildren(iconWrapper);
        navMessages.setAttribute('aria-label', unreadCount > 0 ? `通知中心，${unreadCount} 条未读` : '通知中心');
    }

    function setupPrimaryNavigation() {
        const navBar = document.querySelector('.nav-bar');
        const userArea = document.getElementById('userArea');
        const messagesLink = document.getElementById('navMessages');
        if (!navBar || !userArea) return;

        // 移除底部导航栏中的“帮助”按钮，固定保留 4 个按钮：首页、帖子、表白墙、大事记
        navBar.querySelectorAll('.nav-bar-item').forEach(item => {
            const onclick = (item.getAttribute('onclick') || '').toLowerCase();
            if (onclick.includes('docs')) {
                item.remove();
            }
        });

        if (!navBar.querySelector('[data-nav-events]')) {
            const eventsItem = document.createElement('li');
            eventsItem.className = 'nav-bar-item';
            eventsItem.dataset.navEvents = 'true';
            eventsItem.innerHTML = `${primaryNavIcons.events}<span>大事记</span>`;
            eventsItem.addEventListener('click', () => { location.href = 'events.html'; });
            navBar.appendChild(eventsItem);
        }

        normalizePrimaryNavIcons(navBar);

        // 动态设置选中态高亮 (active)
        const currentPage = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        navBar.querySelectorAll('.nav-bar-item').forEach(item => {
            item.classList.remove('active');
            const onclick = (item.getAttribute('onclick') || '').toLowerCase();
            const isEvents = item.dataset.navEvents === 'true' || onclick.includes('events');
            const isConfession = onclick.includes('confession');
            const isPosts = onclick.includes('posts');
            const isHome = onclick.includes("'./'") || onclick.includes('"./"') || onclick.includes('index') || onclick === '';

            if (isEvents && currentPage.includes('events')) {
                item.classList.add('active');
            } else if (isConfession && currentPage.includes('confession')) {
                item.classList.add('active');
            } else if (isPosts && (currentPage.includes('posts') || currentPage.includes('post.'))) {
                item.classList.add('active');
            } else if (isHome && (currentPage === '' || currentPage === 'index.html' || currentPage === 'index')) {
                item.classList.add('active');
            }
        });

        if (messagesLink && messagesLink.parentElement === navBar) {
            messagesLink.classList.remove('nav-bar-item');
            messagesLink.classList.add('notification-center-link');
            messagesLink.setAttribute('role', 'link');
            messagesLink.setAttribute('aria-label', '通知中心');
            messagesLink.setAttribute('title', '通知中心');
            messagesLink.setAttribute('tabindex', '0');
            messagesLink.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    location.href = 'messages.html';
                }
            });
            userArea.insertBefore(messagesLink, userArea.firstChild);
            renderNotificationIcon();
        }
    }

    setupPrimaryNavigation();

    // Check if we are inside the Android App WebView container
    const isAndroidApp = !!(window.AndroidBridge || window.webkit?.messageHandlers?.AndroidBridge);

    function setupDropdownMenu() {
        if (!dropdownMenu) return;
        dropdownMenu.replaceChildren();

        const profileLink = document.createElement('a');
        profileLink.href = 'profile.html';
        profileLink.textContent = '个人中心';

        const messagesLink = document.createElement('a');
        messagesLink.href = 'messages.html';
        messagesLink.textContent = '通知中心';

        const settingsLink = document.createElement('a');
        settingsLink.href = 'settings.html';
        settingsLink.textContent = '设置';

        const helpLink = document.createElement('a');
        helpLink.href = 'docs.html';
        helpLink.textContent = '帮助';

        dropdownMenu.appendChild(profileLink);
        dropdownMenu.appendChild(messagesLink);
        dropdownMenu.appendChild(settingsLink);
        dropdownMenu.appendChild(helpLink);

        if (!isAndroidApp) {
            const downloadLink = document.createElement('a');
            downloadLink.href = 'download.html';
            downloadLink.className = 'download-app-link';
            downloadLink.textContent = '下载 APP';
            dropdownMenu.appendChild(downloadLink);
        }

        const logoutLink = document.createElement('a');
        logoutLink.href = '#';
        logoutLink.id = 'logoutBtn';
        logoutLink.textContent = '退出登录';
        logoutLink.addEventListener('click', async event => {
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
                    console.warn('云端退出失败，已清理本地会话', error.message);
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

        dropdownMenu.appendChild(logoutLink);
    }

    setupDropdownMenu();

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
        const firstChar = cleanName.charAt(0) || '?';

        userAvatar.style.overflow = 'hidden';
        userAvatar.style.border = 'none';
        userAvatar.style.padding = '0';
        userAvatar.style.boxShadow = 'none';
        userAvatar.style.outline = 'none';
        userAvatar.style.webkitTapHighlightColor = 'transparent';

        userAvatar.style.backgroundColor = 'var(--accent, #228be6)';
        userAvatar.style.color = '#ffffff';
        userAvatar.style.fontWeight = 'bold';

        if (isImage) {
            userAvatar.replaceChildren();
            const image = document.createElement('img');
            image.src = cleanUrl;
            image.alt = '用户头像';
            image.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;';
            image.onerror = () => {
                userAvatar.textContent = firstChar;
                userAvatar.style.lineHeight = '40px';
            };
            userAvatar.appendChild(image);
        } else {
            userAvatar.textContent = firstChar;
            userAvatar.style.lineHeight = '40px';
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
        if (sid.length >= 4) displayName = `${displayName}<span class="year-badge">${sid.substring(0, 4)}级</span>`;
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
        
        // Report device token to backend if running inside Android app
        if (window.AndroidBridge && typeof window.AndroidBridge.getRegistrationId === 'function') {
            try {
                const regId = window.AndroidBridge.getRegistrationId();
                if (regId && user.deviceToken !== regId) {
                    await fetch('/api/update-profile', {
                        method: 'POST',
                        headers: authHeaders(user),
                        body: JSON.stringify({ deviceToken: regId })
                    });
                    user.deviceToken = regId;
                    localStorage.setItem('campus_user', JSON.stringify(user));
                }
            } catch (e) {
                console.warn('Failed to upload device token:', e);
            }
        }

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
            updateNotificationBadge(user);
        } catch (error) {
            console.warn('顶栏资料同步失败，继续使用本地缓存', error.message);
            updateNotificationBadge(user);
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
                console.warn('云端退出失败，已清理本地会话', error.message);
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

    async function updateNotificationBadge(user) {
        if (!user) return;
        try {
            const response = await fetch('/api/list-notifications', { headers: authHeaders(user) });
            if (!response.ok) return;
            const result = await response.json();
            const unreadCount = Number(result.unreadCount || 0);

            renderNotificationIcon(unreadCount);
        } catch (e) {
            console.warn('Failed to load notification count:', e.message);
        }
    }

    checkLoginStatus();
    window.addEventListener('storage', event => {
        if (event.key === 'campus_user') checkLoginStatus();
    });
    window.refreshNavbar = checkLoginStatus;
    window.refreshNotificationBadge = () => {
        const u = readSavedUser();
        if (u) updateNotificationBadge(u);
    };

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.warn('SW auto registration:', err.message);
            });
        });
    }
})();
