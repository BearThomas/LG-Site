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
        applyCustomVars();
        window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }


    // --- ThemeManager (Custom Engine) ---
    const CUSTOM_THEME_KEY = 'custom_theme_config';
    
    const PRESET_THEMES = {
        'default': null, // Use CSS defaults
        'purple': {
            '--bg-gradient': 'linear-gradient(to bottom, #090014, #1a0b2e, #2d1b4e)',
            '--accent-color': '#a855f7',
            '--accent-hover': '#c084fc',
            '--accent-soft': 'rgba(168, 85, 247, 0.15)',
            '--card-bg': 'rgba(30, 20, 50, 0.6)',
            '--board-bg': 'rgba(20, 10, 40, 0.8)',
            '--glass-border': 'rgba(168, 85, 247, 0.2)'
        },
        'classic': {
            '--bg-base': '#111111',
            '--bg-gradient': 'linear-gradient(to bottom, #111, #222)',
            '--accent-color': '#ffffff',
            '--accent-hover': '#dddddd',
            '--accent-soft': 'rgba(255, 255, 255, 0.1)',
            '--text-primary': '#eeeeee'
        },
        'sky': {
            '--bg-gradient': 'linear-gradient(to bottom, #0b192c, #1a365d, #2c5282)',
            '--accent-color': '#63b3ed',
            '--accent-hover': '#90cdf4',
            '--accent-soft': 'rgba(99, 179, 237, 0.15)'
        }
    };

    function loadCustomTheme() {
        try {
            const saved = localStorage.getItem(CUSTOM_THEME_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    }

    function applyCustomVars() {
        // 1. Clear previous custom vars
        document.documentElement.style.cssText = '';
        
        const custom = loadCustomTheme();
        if (!custom) return; // Use CSS defaults

        // 2. If it's a preset key, apply preset vars
        if (custom.preset && PRESET_THEMES[custom.preset]) {
            const vars = PRESET_THEMES[custom.preset];
            for (const [k, v] of Object.entries(vars)) {
                document.documentElement.style.setProperty(k, v);
            }
        } 
        // 3. Or apply user custom colors
        else if (custom.colors) {
            for (const [k, v] of Object.entries(custom.colors)) {
                document.documentElement.style.setProperty(k, v);
            }
        }
    }
    
    window.ThemeManager = {
        saveTheme: function(config) {
            localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(config));
            applyCustomVars();
        },
        clearTheme: function() {
            localStorage.removeItem(CUSTOM_THEME_KEY);
            applyCustomVars();
        },
        getCurrent: loadCustomTheme,
        exportTheme: function() {
            const current = loadCustomTheme();
            if (!current) return '';
            return btoa(JSON.stringify(current));
        },
        importTheme: function(base64Str) {
            try {
                const config = JSON.parse(atob(base64Str));
                this.saveTheme(config);
                return true;
            } catch (e) {
                return false;
            }
        }
    };
    // ------------------------------------

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
