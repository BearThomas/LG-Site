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
        button.textContent = isDark ? '☀' : '☾';
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
