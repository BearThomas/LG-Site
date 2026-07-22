(function () {
    'use strict';

    function initSettings() {
        const container = document.getElementById('themeOptionsContainer');
        if (!container) return;

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

    document.addEventListener('DOMContentLoaded', initSettings);
})();
