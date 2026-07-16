// js/dynamic-bg.js
// Optimized Canvas-based dynamic background showing Meteor Shower (Dark) and Sunshine Rays (Light).
// Transitions smoothly when the theme changes.

(function() {
    'use strict';

    let canvas = null;
    let ctx = null;
    let width = 0;
    let height = 0;

    // Theme state
    let targetTheme = 'light'; // 'light' or 'dark'
    let themeProgress = 0;     // 0 (fully light) to 1 (fully dark)
    const transitionSpeed = 0.04; // Animation speed for theme switching

    // Stars & Meteors (Dark Mode)
    const stars = [];
    const meteors = [];
    const maxStars = 80;

    // Sparkles & Sunbeams (Light Mode)
    const sparkles = [];
    const maxSparkles = 30;
    let sunbeamAngle = 0;

    // Initialize Canvas
    function init() {
        // Create main background canvas
        canvas = document.getElementById('bgCanvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'bgCanvas';
            canvas.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:-2; pointer-events:none;';
            document.body.appendChild(canvas);
        }
        ctx = canvas.getContext('2d');
        
        // Restore default cursor
        document.body.style.cursor = 'default';

        resize();
        window.addEventListener('resize', resize);

        // Detect initial theme
        const isDark = document.body.classList.contains('dark') || 
                       document.documentElement.classList.contains('dark') ||
                       (localStorage.getItem('theme') === 'dark');
        targetTheme = isDark ? 'dark' : 'light';
        themeProgress = isDark ? 1 : 0;

        // Initialize particles
        initStars();
        initSparkles();

        // Start animation loop
        requestAnimationFrame(tick);

        // Listen for theme change events
        window.addEventListener('themeChanged', (e) => {
            targetTheme = e.detail?.theme || 'light';
        });

        // Fallback observer for theme class changes on body/html
        const observer = new MutationObserver(() => {
            const darkActive = document.body.classList.contains('dark') || document.documentElement.classList.contains('dark');
            targetTheme = darkActive ? 'dark' : 'light';
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    // ================= Particle Classes =================

    // Star Class (Background stars in Dark Mode)
    class Star {
        constructor() {
            this.reset();
            this.y = Math.random() * height;
        }
        reset() {
            this.x = Math.random() * width;
            this.y = 0;
            this.size = Math.random() * 1.5 + 0.5;
            this.alpha = Math.random() * 0.5 + 0.3;
            this.blinkSpeed = Math.random() * 0.02 + 0.005;
        }
        update() {
            this.alpha += this.blinkSpeed;
            if (this.alpha > 0.9 || this.alpha < 0.2) {
                this.blinkSpeed = -this.blinkSpeed;
            }
        }
        draw(c) {
            c.fillStyle = `rgba(255, 255, 255, ${this.alpha})`;
            c.beginPath();
            c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            c.fill();
        }
    }

    // Meteor Class (Shooting stars in Dark Mode)
    class Meteor {
        constructor() {
            this.reset();
        }
        reset() {
            this.x = Math.random() * (width * 1.2) - (width * 0.2);
            this.y = -50;
            this.length = Math.random() * 80 + 60;
            this.speed = Math.random() * 8 + 6;
            this.thickness = Math.random() * 1.5 + 0.8;
            this.alpha = Math.random() * 0.6 + 0.4;
            this.dx = -this.speed;
            this.dy = this.speed * 0.8;
        }
        update() {
            this.x += this.dx;
            this.y += this.dy;
            if (this.x < -100 || this.y > height + 100) {
                this.reset();
            }
        }
        draw(c) {
            const grad = c.createLinearGradient(this.x, this.y, this.x - this.dx * 8, this.y - this.dy * 8);
            grad.addColorStop(0, `rgba(255, 255, 255, ${this.alpha})`);
            grad.addColorStop(0.1, `rgba(147, 197, 253, ${this.alpha * 0.7})`);
            grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
            c.strokeStyle = grad;
            c.lineWidth = this.thickness;
            c.beginPath();
            c.moveTo(this.x, this.y);
            c.lineTo(this.x + this.dx * 3, this.y + this.dy * 3);
            c.stroke();
        }
    }

    // Sparkle Class (Floating warm dust in Light Mode)
    class Sparkle {
        constructor() {
            this.reset();
            this.y = Math.random() * height;
        }
        reset() {
            this.x = Math.random() * width;
            this.y = height + 10;
            this.size = Math.random() * 2 + 1;
            this.speedY = -(Math.random() * 0.4 + 0.2);
            this.speedX = Math.random() * 0.3 - 0.15;
            this.alpha = Math.random() * 0.4 + 0.1;
            this.fadeSpeed = Math.random() * 0.005 + 0.002;
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.y < -10 || this.alpha <= 0) {
                this.reset();
            }
        }
        draw(c) {
            c.fillStyle = `rgba(251, 191, 36, ${this.alpha})`;
            c.beginPath();
            c.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            c.fill();
        }
    }

    function initStars() {
        for (let i = 0; i < maxStars; i++) {
            stars.push(new Star());
        }
        for (let i = 0; i < 4; i++) {
            meteors.push(new Meteor());
        }
    }

    function initSparkles() {
        for (let i = 0; i < maxSparkles; i++) {
            sparkles.push(new Sparkle());
        }
    }

    function lerp(start, end, amt) {
        return (1 - amt) * start + amt * end;
    }

    function drawBackground() {
        const lightColor1 = { r: 255, g: 249, b: 230 };
        const lightColor2 = { r: 230, g: 242, b: 255 };

        const darkColor1 = { r: 11, g: 15, b: 25 };
        const darkColor2 = { r: 21, g: 29, b: 46 };

        const r1 = Math.round(lerp(lightColor1.r, darkColor1.r, themeProgress));
        const g1 = Math.round(lerp(lightColor1.g, darkColor1.g, themeProgress));
        const b1 = Math.round(lerp(lightColor1.b, darkColor1.b, themeProgress));

        const r2 = Math.round(lerp(lightColor2.r, darkColor2.r, themeProgress));
        const g2 = Math.round(lerp(lightColor2.g, darkColor2.g, themeProgress));
        const b2 = Math.round(lerp(lightColor2.b, darkColor2.b, themeProgress));

        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, `rgb(${r1}, ${g1}, ${b1})`);
        grad.addColorStop(1, `rgb(${r2}, ${g2}, ${b2})`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
    }

    function drawLightMode() {
        const lightAlpha = 1 - themeProgress;
        if (lightAlpha <= 0) return;

        ctx.save();
        ctx.globalAlpha = lightAlpha;

        sunbeamAngle += 0.001;
        const centerX = width;
        const centerY = 0;
        const beamRadius = Math.max(width, height) * 1.2;

        ctx.translate(centerX, centerY);
        ctx.rotate(sunbeamAngle);

        const beamCount = 6;
        for (let i = 0; i < beamCount; i++) {
            const angleStart = (i * Math.PI * 2) / beamCount;
            const angleEnd = angleStart + Math.PI / 12;

            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, beamRadius);
            grad.addColorStop(0, 'rgba(253, 224, 71, 0.12)');
            grad.addColorStop(0.5, 'rgba(253, 224, 71, 0.04)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, beamRadius, angleStart, angleEnd);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();

        ctx.save();
        ctx.globalAlpha = lightAlpha;
        sparkles.forEach(s => {
            s.update();
            s.draw(ctx);
        });
        ctx.restore();
    }

    function drawDarkMode() {
        const darkAlpha = themeProgress;
        if (darkAlpha <= 0) return;

        ctx.save();
        ctx.globalAlpha = darkAlpha;

        stars.forEach(s => {
            s.update();
            s.draw(ctx);
        });

        meteors.forEach(m => {
            m.update();
            m.draw(ctx);
        });

        ctx.restore();
    }

    // ================= Animation Loop =================
    function tick() {
        // Transition themeProgress (0: light, 1: dark)
        if (targetTheme === 'dark' && themeProgress < 1) {
            themeProgress = Math.min(1, themeProgress + transitionSpeed);
        } else if (targetTheme === 'light' && themeProgress > 0) {
            themeProgress = Math.max(0, themeProgress - transitionSpeed);
        }

        // Render Background Canvas Frame
        drawBackground();
        drawLightMode();
        drawDarkMode();

        requestAnimationFrame(tick);
    }

    // Wait for DOM to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
