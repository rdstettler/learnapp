/**
 * Lightweight canvas-based confetti animation.
 * No external dependencies — just call `launchConfetti()` on 100% score.
 */

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    rotation: number;
    rotationSpeed: number;
    opacity: number;
    shape: 'rect' | 'circle';
}

const COLORS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bff', '#ff9f43', '#54a0ff'];

export function launchConfetti(duration = 2500, particleCount = 80): void {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Particle[] = [];

    // Create particles from the top-center area
    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: canvas.width * (0.2 + Math.random() * 0.6),
            y: canvas.height * 0.15 - Math.random() * 60,
            vx: (Math.random() - 0.5) * 12,
            vy: Math.random() * 4 + 2,
            size: Math.random() * 8 + 4,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.2,
            opacity: 1,
            shape: Math.random() > 0.5 ? 'rect' : 'circle'
        });
    }

    const startTime = performance.now();

    function animate(now: number) {
        const elapsed = now - startTime;
        if (elapsed > duration + 1500) {
            canvas.remove();
            return;
        }

        ctx!.clearRect(0, 0, canvas.width, canvas.height);

        const fadeStart = duration;
        for (const p of particles) {
            p.x += p.vx;
            p.vy += 0.15; // gravity
            p.y += p.vy;
            p.vx *= 0.99; // air resistance
            p.rotation += p.rotationSpeed;

            // Fade out after duration
            if (elapsed > fadeStart) {
                p.opacity = Math.max(0, 1 - (elapsed - fadeStart) / 1500);
            }

            if (p.opacity <= 0) continue;

            ctx!.save();
            ctx!.translate(p.x, p.y);
            ctx!.rotate(p.rotation);
            ctx!.globalAlpha = p.opacity;
            ctx!.fillStyle = p.color;

            if (p.shape === 'rect') {
                ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            } else {
                ctx!.beginPath();
                ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx!.fill();
            }

            ctx!.restore();
        }

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}
