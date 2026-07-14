const MOBILE_QUERY = '(max-width: 900px) and (pointer: coarse)';

export function createListSkeleton(type = 'post', count = 4) {
    const itemClass = type === 'confession' ? 'feed-skeleton-card compact' : 'feed-skeleton-card';
    return `
        <div class="feed-skeleton" aria-label="内容加载中" aria-busy="true">
            ${Array.from({ length: count }, () => `
                <div class="${itemClass}">
                    <div class="feed-skeleton-head">
                        <span class="skeleton-block skeleton-avatar"></span>
                        <span class="feed-skeleton-meta">
                            <span class="skeleton-block skeleton-name"></span>
                            <span class="skeleton-block skeleton-time"></span>
                        </span>
                    </div>
                    <span class="skeleton-block skeleton-title"></span>
                    <span class="skeleton-block skeleton-line"></span>
                    <span class="skeleton-block skeleton-line short"></span>
                </div>
            `).join('')}
        </div>
    `;
}

export function scheduleAfterPaint(task) {
    const execute = () => {
        try {
            task();
        } catch (error) {
            console.warn('后台缓存写入失败:', error);
        }
    };
    const runWhenIdle = () => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(execute, { timeout: 1500 });
        } else {
            window.setTimeout(execute, 0);
        }
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(runWhenIdle));
    } else {
        runWhenIdle();
    }
}

export function setupPullToRefresh({ onRefresh, threshold = 72 } = {}) {
    if (typeof onRefresh !== 'function' || !window.matchMedia(MOBILE_QUERY).matches) {
        return { destroy() {} };
    }

    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = '<span class="pull-refresh-spinner"></span><span class="pull-refresh-text">下拉刷新</span>';
    document.body.appendChild(indicator);
    document.documentElement.classList.add('pull-refresh-enabled');

    const text = indicator.querySelector('.pull-refresh-text');
    const spinner = indicator.querySelector('.pull-refresh-spinner');
    let startY = 0;
    let pullDistance = 0;
    let tracking = false;
    let refreshing = false;

    const atPageTop = () => window.scrollY <= 1 && document.documentElement.scrollTop <= 1;
    const blockedTarget = target => target.closest('input, textarea, select, [contenteditable="true"], .modal-overlay');

    function render(distance) {
        pullDistance = Math.min(104, Math.max(0, distance));
        indicator.style.setProperty('--pull-distance', `${pullDistance}px`);
        spinner.style.transform = `rotate(${pullDistance * 3}deg)`;
        indicator.classList.toggle('visible', pullDistance > 4);
        indicator.classList.toggle('ready', pullDistance >= threshold);
        text.textContent = pullDistance >= threshold ? '松开刷新' : '下拉刷新';
    }

    function reset(delay = 0) {
        window.setTimeout(() => {
            indicator.classList.remove('visible', 'ready', 'refreshing', 'success');
            indicator.style.setProperty('--pull-distance', '0px');
            spinner.style.transform = 'rotate(0deg)';
            text.textContent = '下拉刷新';
            pullDistance = 0;
        }, delay);
    }

    function handleStart(event) {
        if (refreshing || !atPageTop() || event.touches.length !== 1 || blockedTarget(event.target)) return;
        startY = event.touches[0].clientY;
        tracking = true;
        indicator.classList.add('pulling');
    }

    function handleMove(event) {
        if (!tracking || refreshing || event.touches.length !== 1) return;
        const delta = event.touches[0].clientY - startY;
        if (delta <= 0 || !atPageTop()) {
            render(0);
            return;
        }
        if (event.cancelable) event.preventDefault();
        render(delta * 0.48);
    }

    async function handleEnd() {
        if (!tracking) return;
        tracking = false;
        indicator.classList.remove('pulling');
        if (pullDistance < threshold || refreshing) {
            reset();
            return;
        }

        refreshing = true;
        indicator.classList.add('visible', 'refreshing');
        indicator.classList.remove('ready');
        indicator.style.setProperty('--pull-distance', `${threshold}px`);
        text.textContent = '正在刷新';
        if (navigator.vibrate) navigator.vibrate(18);

        try {
            await onRefresh();
            indicator.classList.remove('refreshing');
            indicator.classList.add('success');
            text.textContent = '刷新完成';
            reset(550);
        } catch (error) {
            indicator.classList.remove('refreshing');
            text.textContent = '刷新失败，请重试';
            reset(900);
            console.warn('下拉刷新失败:', error);
        } finally {
            refreshing = false;
        }
    }

    document.addEventListener('touchstart', handleStart, { passive: true });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: true });
    document.addEventListener('touchcancel', handleEnd, { passive: true });

    return {
        destroy() {
            document.removeEventListener('touchstart', handleStart);
            document.removeEventListener('touchmove', handleMove);
            document.removeEventListener('touchend', handleEnd);
            document.removeEventListener('touchcancel', handleEnd);
            indicator.remove();
            document.documentElement.classList.remove('pull-refresh-enabled');
        }
    };
}
