(async function() {
    'use strict';

    const messagesList = document.getElementById('messagesList');
    const markAllReadBtn = document.getElementById('markAllReadBtn');

    function readSavedUser() {
        try {
            const user = JSON.parse(localStorage.getItem('campus_user') || 'null');
            if (!user || user.authVersion !== 2 || !user.studentId) return null;
            return user;
        } catch {
            return null;
        }
    }

    const user = readSavedUser();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    function getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (user.appToken) headers['X-LG-Token'] = user.appToken;
        return headers;
    }

    async function loadNotifications() {
        try {
            const res = await fetch(`/api/list-notifications`, {
                headers: getHeaders()
            });
            if (!res.ok) throw new Error('API error');
            const data = await res.json();
            
            renderNotifications(data.documents || []);
            if (data.unreadCount > 0) {
                markAllReadBtn.style.display = 'block';
            } else {
                markAllReadBtn.style.display = 'none';
            }
        } catch (e) {
            messagesList.innerHTML = `<div class="loading-state" style="color: var(--danger);">加载通知失败，请刷新重试。</div>`;
        }
    }

    function timeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);
        if (seconds < 60) return '刚刚';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}分钟前`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}天前`;
        return date.toLocaleDateString();
    }

    function renderNotifications(notifs) {
        if (notifs.length === 0) {
            messagesList.innerHTML = `
                <div class="empty-state">
                    <span class="empty-state-icon">🔔</span>
                    暂无任何消息通知
                </div>
            `;
            return;
        }

        messagesList.innerHTML = '';
        notifs.forEach(notif => {
            const card = document.createElement('div');
            card.className = `message-card ${notif.is_read ? '' : 'unread'}`;
            
            const isComment = notif.type === 'comment';
            const isFollow = notif.type === 'follow';
            let iconSvg = '';
            
            if (isComment) {
                iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-chat-left-text" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M3 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM3 8.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/></svg>`;
            } else if (isFollow) {
                iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-person-heart" viewBox="0 0 16 16"><path d="M9 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-9 8c0 1 1 1 1 1h10s1 0 1-1-1-4-6-4-6 3-6 4Zm13.5-8.09c1.387-1.425 4.855 1.07 0 4.277-4.854-3.207-1.387-5.702 0-4.276Z"/></svg>`;
            } else {
                iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-info-circle" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>`;
            }

            card.innerHTML = `
                <div class="message-icon">${iconSvg}</div>
                <div class="message-content-wrapper">
                    <div class="message-title-row">
                        <span class="message-title">${notif.title || '新通知'}</span>
                        <span class="message-time">${timeAgo(notif.created_at)}</span>
                    </div>
                    <div class="message-body">${notif.content}</div>
                </div>
            `;

            card.addEventListener('click', async () => {
                if (!notif.is_read) {
                    try {
                        await fetch(`/api/read-notifications`, {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({ ids: [notif.id] })
                        });
                    } catch (e) {
                        console.error(e);
                    }
                }
                
                if (notif.target_id) {
                    if (isFollow) {
                        window.location.href = `user.html?id=${notif.target_id}`;
                    } else {
                        window.location.href = `post.html?id=${notif.target_id}`;
                    }
                }
            });

            messagesList.appendChild(card);
        });
    }

    markAllReadBtn.addEventListener('click', async () => {
        try {
            const res = await fetch(`/api/read-notifications`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ all: true })
            });
            if (res.ok) {
                loadNotifications();
                if (window.refreshNotificationBadge) {
                    window.refreshNotificationBadge();
                }
            }
        } catch (e) {
            alert('操作失败，请重试');
        }
    });

    loadNotifications();
})();
