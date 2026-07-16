// js/dynamic-bg.js
// Optimized Canvas-based dynamic background showing Meteor Shower (Dark) and Sunshine Rays (Light).
// Renders real-time liquid glass refraction magnifier following the mouse cursor.

(function() {
    'use strict';

    let canvas = null;
    let ctx = null;
    let width = 0;
    let height = 0;

    // Glass refraction canvas and container
    let glassContainer = null;
    let glassCanvas = null;
    let glassCtx = null;
    let cursor = null;

    // Configuration
    const BALL_SIZE = 200;
    const REFRACTION_STRENGTH = 0.85;
    const EDGE_WIDTH = 0.35; // edge refractive zone percentage
    const SATURATE = 1.8;

    // Mouse tracking
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let targetMouseX = mouseX;
    let targetMouseY = mouseY;

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
        // 1. Create main background canvas
        canvas = document.getElementById('bgCanvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'bgCanvas';
            canvas.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:-2; pointer-events:none;';
            document.body.appendChild(canvas);
        }
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // 2. Create Glass Refraction Container
        glassContainer = document.getElementById('glassContainer');
        if (!glassContainer) {
            glassContainer = document.createElement('div');
            glassContainer.id = 'glassContainer';
            glassContainer.style.cssText = `
              position: fixed; 
              width: ${BALL_SIZE}px; 
              height: ${BALL_SIZE}px; 
              border-radius: 50%; 
              pointer-events: none; 
              transform: translate(-50%, -50%); 
              z-index: 9999;
              box-shadow: 
                inset 0 0 0 1px rgba(255,255,255,0.4),
                inset 0 2px 6px rgba(255,255,255,0.6),
                inset 0 -2px 6px rgba(255,255,255,0.2),
                0 8px 32px rgba(0,0,0,0.3);
            `;
            
            glassCanvas = document.createElement('canvas');
            glassCanvas.id = 'glass';
            glassCanvas.width = BALL_SIZE;
            glassCanvas.height = BALL_SIZE;
            glassCanvas.style.cssText = 'width:100%; height:100%; border-radius:50%; display:block;';
            glassCtx = glassCanvas.getContext('2d');
            
            const highlight = document.createElement('div');
            highlight.style.cssText = `
              position: absolute;
              top: 8%;
              left: 18%;
              width: 40%;
              height: 25%;
              border-radius: 50%;
              background: radial-gradient(ellipse, rgba(255,255,255,0.5), transparent 70%);
              filter: blur(4px);
              pointer-events: none;
            `;
            
            glassContainer.appendChild(glassCanvas);
            glassContainer.appendChild(highlight);
            document.body.appendChild(glassContainer);
        }

        // 3. Create Custom Cursor Dot
        cursor = document.getElementById('cursor');
        if (!cursor) {
            cursor = document.createElement('div');
            cursor.id = 'cursor';
            cursor.style.cssText = `
              position: fixed;
              width: 8px;
              height: 8px;
              background: rgba(255,255,255,0.8);
              border-radius: 50%;
              pointer-events: none;
              transform: translate(-50%, -50%);
              z-index: 10000;
            `;
            document.body.appendChild(cursor);
        }

        // Apply cursor hiding when mouse moves
        document.body.style.cursor = 'none';

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

        // Listen for mousemove
        document.addEventListener('mousemove', (e) => {
            targetMouseX = e.clientX;
            targetMouseY = e.clientY;
        });

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

    // ================= Liquid Glass Refraction Rendering (Optimized Bounding Box) =================

    function updateGlass() {
        if (!glassCtx) return;

        const center = BALL_SIZE / 2;
        const radius = center;

        // Bounding box on background canvas (clamped)
        const ballLeft = Math.max(0, Math.min(width - BALL_SIZE, mouseX - center));
        const ballTop = Math.max(0, Math.min(height - BALL_SIZE, mouseY - center));

        let bgImageData;
        try {
            bgImageData = ctx.getImageData(ballLeft, ballTop, BALL_SIZE, BALL_SIZE);
        } catch (e) {
            return; // fail-safe for rendering context
        }

        const imgData = glassCtx.createImageData(BALL_SIZE, BALL_SIZE);
        const data = imgData.data;
        const bgData = bgImageData.data;

        for (let y = 0; y < BALL_SIZE; y++) {
            for (let x = 0; x < BALL_SIZE; x++) {
                const dx = x - center;
                const dy = y - center;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const idx = (y * BALL_SIZE + x) * 4;

                // Out of circle boundary
                if (dist > radius) {
                    data[idx + 3] = 0;
                    continue;
                }

                const normDist = dist / radius;
                const edgeStart = 1 - EDGE_WIDTH;

                let refraction = 0;
                if (normDist > edgeStart) {
                    const t = (normDist - edgeStart) / EDGE_WIDTH;
                    refraction = t * t * REFRACTION_STRENGTH;
                }

                const angle = Math.atan2(dy, dx);
                const displacement = refraction * radius * 0.7;

                // Relative sampling coordinates inside 200x200 box
                const sampleX = Math.max(0, Math.min(BALL_SIZE - 1, x + Math.cos(angle) * displacement));
                const sampleY = Math.max(0, Math.min(BALL_SIZE - 1, y + Math.sin(angle) * displacement));

                const bgIdx = (Math.floor(sampleY) * BALL_SIZE + Math.floor(sampleX)) * 4;

                let r = bgData[bgIdx];
                let g = bgData[bgIdx + 1];
                let b = bgData[bgIdx + 2];

                // Boost saturation
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = gray + (r - gray) * SATURATE;
                g = gray + (g - gray) * SATURATE;
                b = gray + (b - gray) * SATURATE;

                // Highlight edge pixels
                if (refraction > 0) {
                    const bright = 1 + refraction * 0.3;
                    r *= bright;
                    g *= bright;
                    b *= bright;
                }

                data[idx] = Math.min(255, r);
                data[idx + 1] = Math.min(255, g);
                data[idx + 2] = Math.min(255, b);
                data[idx + 3] = 255;
            }
        }

        glassCtx.putImageData(imgData, 0, 0);

        // Move Glass Container & Cursor elements to mouse coordinates
        if (glassContainer) {
            glassContainer.style.left = mouseX + 'px';
            glassContainer.style.top = mouseY + 'px';
        }
        if (cursor) {
            cursor.style.left = mouseX + 'px';
            cursor.style.top = mouseY + 'px';
        }
    }

    // ================= Animation Loop =================
    function tick() {
        // Interpolate mouse coordinates for smooth lag-follow effect
        mouseX += (targetMouseX - mouseX) * 0.15;
        mouseY += (targetMouseY - mouseY) * 0.15;

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

        // Render Glass Refraction Overlay
        updateGlass();

        requestAnimationFrame(tick);
    }

    // Wait for DOM to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
