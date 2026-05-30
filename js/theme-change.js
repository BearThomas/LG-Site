function setTheme(theme) {
    if (theme === 'auto') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        theme = isDark ? 'dark' : 'light';
    }
    
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    
    links.forEach(link => {
        const oldPath = link.href;
        const newPath = oldPath.replace(/^(.*?)\/(light|dark)\/(.*)$/, `$1/${theme}/$3`);
        if (newPath !== oldPath) {
            link.href = newPath;
        }
    });
    
    localStorage.setItem('theme', theme);
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
    setTheme(savedTheme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem('theme') === 'auto') {
        setTheme('auto');
    }
});