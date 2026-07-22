(function () {
    'use strict';

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    async function initPushNotificationUI() {
        const togglePushBtn = document.getElementById('togglePushBtn');
        const pushStatusHint = document.getElementById('pushStatusHint');
        if (!togglePushBtn) return;

        const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
        if (!isSupported) {
            if (pushStatusHint) pushStatusHint.textContent = '当前设备或环境暂不支持 Web Push（iOS 请务必先“添加到主屏幕”在独立应用中打开）';
            togglePushBtn.disabled = true;
            togglePushBtn.style.opacity = '0.5';
            return;
        }

        let reg = null;
        try {
            reg = await navigator.serviceWorker.register('/sw.js');
        } catch (e) {
            console.warn('Service Worker 注册失败:', e);
        }

        const checkSub = async () => {
            if (!reg) return false;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                togglePushBtn.textContent = '已订阅推送通知';
                togglePushBtn.style.background = 'var(--surface-2)';
                togglePushBtn.style.color = 'var(--text-muted)';
                togglePushBtn.style.borderColor = 'var(--border)';
                if (pushStatusHint) pushStatusHint.textContent = '已成功在当前设备上启用消息推送';
                return true;
            }
            return false;
        };

        await checkSub();

        togglePushBtn.addEventListener('click', async () => {
            const user = JSON.parse(localStorage.getItem('campus_user') || 'null');
            if (!user) {
                alert('请先登录后再开启推送通知');
                location.href = 'login.html';
                return;
            }

            try {
                togglePushBtn.disabled = true;
                togglePushBtn.textContent = '请求权限中...';

                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    alert('未授予通知权限。如果是在 iOS 端，请前往 iPhone [设置] -> [通知] -> 找到 [龙高北小站] 允许通知。');
                    togglePushBtn.textContent = '订阅推送通知';
                    togglePushBtn.disabled = false;
                    return;
                }

                togglePushBtn.textContent = '开启中...';
                let vapidKey = 'BA1lrxEsu6DcYOwWIJwFc2XNF2hQPpxRH_Ryl6__kHVCxqBBtwS-6EYCXG9Hfic34t8iRhWPFkD_FlyFzs2qIsc';
                try {
                    const res = await fetch('/api/runtime-config');
                    if (res.ok) {
                        const config = await res.json();
                        if (config.vapidPublicKey) vapidKey = config.vapidPublicKey;
                    }
                } catch(e) {}

                const swRegistration = await navigator.serviceWorker.ready;
                const subscription = await swRegistration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(vapidKey)
                });

                const saveRes = await fetch('/api/subscribe-push', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(user.appToken ? { 'X-LG-Token': user.appToken } : {}),
                        ...(user.token ? { 'X-Appwrite-Session': user.token } : {})
                    },
                    body: JSON.stringify({ subscription })
                });

                if (saveRes.ok) {
                    alert('推送通知开启成功！您现在可以接收互动和系统通知。');
                    await checkSub();
                } else {
                    const errData = await saveRes.json().catch(() => ({}));
                    alert('推送保存失败: ' + (errData.error || '未知错误'));
                }
            } catch (err) {
                console.error('订阅失败:', err);
                alert('订阅推送失败: ' + err.message);
            } finally {
                togglePushBtn.disabled = false;
            }
        });
    }

    function initSettings() {
        const container = document.getElementById('themeOptionsContainer');
        if (container) {
            const getCurrentTheme = () => localStorage.getItem('theme') || 'auto';

            const updateActiveCard = (currentVal) => {
                container.querySelectorAll('.theme-option-card').forEach(card => {
                    const val = card.dataset.themeVal;
                    if (val === currentVal) {
                        card.classList.add('active');
                    } else {
                        card.classList.remove('active');
                    }
                });
            };

            updateActiveCard(getCurrentTheme());

            container.querySelectorAll('.theme-option-card').forEach(card => {
                card.addEventListener('click', () => {
                    const targetVal = card.dataset.themeVal;
                    if (typeof window.setTheme === 'function') {
                        window.setTheme(targetVal);
                    } else {
                        localStorage.setItem('theme', targetVal);
                        location.reload();
                    }
                    updateActiveCard(targetVal);
                });
            });
        }

        initPushNotificationUI();
    }

    document.addEventListener('DOMContentLoaded', initSettings);
})();
