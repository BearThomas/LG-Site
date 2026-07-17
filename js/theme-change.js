(function () {
    'use strict';

    const THEME_KEY = 'theme';
    const DARK = 'dark';
    const LIGHT = 'light';
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const navMediaQuery = window.matchMedia('(max-width: 900px)');
    let navRestorePoint = null;

    function getPreference() {
        return localStorage.getItem(THEME_KEY) || 'auto';
    }

    function resolveTheme(preference) {
        if (preference === DARK || preference === LIGHT) {
            return preference;
        }
        return mediaQuery.matches ? DARK : LIGHT;
    }

    function syncThemeButton(theme) {
        const button = document.getElementById('themeToggle');
        if (!button) return;

        const isDark = theme === DARK;
        const sunSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-brightness-high-fill" viewBox="0 0 16 16">
  <path d="M12 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708z"/>
</svg>`;
        const moonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" class="bi bi-moon-fill" viewBox="0 0 16 16">
  <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/>
</svg>`;
        
        button.innerHTML = isDark ? moonSvg : sunSvg;
        button.setAttribute('aria-label', isDark ? '切换浅色模式' : '切换深色模式');
        button.setAttribute('title', isDark ? '切换浅色模式' : '切换深色模式');
    }

    function applyTheme(preference, shouldPersist) {
        const nextPreference = preference || getPreference();
        const theme = resolveTheme(nextPreference);

        document.documentElement.dataset.theme = theme;
        document.documentElement.classList.toggle(DARK, theme === DARK);
        document.documentElement.classList.toggle(LIGHT, theme === LIGHT);

        if (document.body) {
            document.body.classList.toggle(DARK, theme === DARK);
            document.body.classList.toggle(LIGHT, theme === LIGHT);
        }

        if (shouldPersist) {
            localStorage.setItem(THEME_KEY, nextPreference);
        }

        syncThemeButton(theme);
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }

    function toggleTheme() {
        const current = resolveTheme(getPreference());
        applyTheme(current === DARK ? LIGHT : DARK, true);
    }

    function ensureThemeToggle() {
        if (document.getElementById('themeToggle')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'themeToggle';
        button.className = 'theme-toggle';
        button.addEventListener('click', toggleTheme);

        const titleBar = document.querySelector('.title-bar');
        if (!titleBar) {
            button.classList.add('theme-toggle-floating');
            document.body.appendChild(button);
            syncThemeButton(resolveTheme(getPreference()));
            return;
        }

        const userArea = titleBar.querySelector('.user-area');
        titleBar.insertBefore(button, userArea || null);
        syncThemeButton(resolveTheme(getPreference()));
    }

    function syncResponsiveNav() {
        const titleBar = document.querySelector('.title-bar');
        const nav = document.querySelector('.nav-bar');
        if (!titleBar || !nav) return;

        if (!navRestorePoint && titleBar.contains(nav)) {
            navRestorePoint = document.createComment('nav-bar-restore-point');
            titleBar.insertBefore(navRestorePoint, nav);
        }

        if (navMediaQuery.matches) {
            nav.classList.add('mobile-bottom-nav');
            if (nav.parentElement !== document.body) {
                document.body.appendChild(nav);
            }
            return;
        }

        nav.classList.remove('mobile-bottom-nav');
        if (navRestorePoint && navRestorePoint.parentNode && nav.parentElement !== titleBar) {
            navRestorePoint.parentNode.insertBefore(nav, navRestorePoint.nextSibling);
        }
    }

    applyTheme(getPreference(), false);

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(getPreference(), false);
        syncResponsiveNav();
        ensureThemeToggle();
    });

    const handleSystemThemeChange = () => {
        if (getPreference() === 'auto') {
            applyTheme('auto', false);
        }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleSystemThemeChange);
    }

    if (typeof navMediaQuery.addEventListener === 'function') {
        navMediaQuery.addEventListener('change', syncResponsiveNav);
    } else if (typeof navMediaQuery.addListener === 'function') {
        navMediaQuery.addListener(syncResponsiveNav);
    }

    window.setTheme = function (theme) {
        applyTheme(theme, true);
    };
    window.toggleTheme = toggleTheme;
    window.getThemePreference = getPreference;
})();
