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
    return { destroy() {} };


}
