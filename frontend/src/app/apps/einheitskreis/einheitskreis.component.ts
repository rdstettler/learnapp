import {
    Component, signal, computed, ElementRef, viewChild,
    AfterViewInit, OnDestroy, PLATFORM_ID, inject
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

type ViewMode = 'trig' | 'complex';

interface SpecialAngle {
    deg: number;
    rad: string;       // display label e.g. "π/6"
    radVal: number;     // numeric value
    sin: string;        // exact value string
    cos: string;
}

const SPECIAL_ANGLES: SpecialAngle[] = [
    { deg: 0, rad: '0', radVal: 0, sin: '0', cos: '1' },
    { deg: 30, rad: 'π/6', radVal: Math.PI / 6, sin: '1/2', cos: '√3/2' },
    { deg: 45, rad: 'π/4', radVal: Math.PI / 4, sin: '√2/2', cos: '√2/2' },
    { deg: 60, rad: 'π/3', radVal: Math.PI / 3, sin: '√3/2', cos: '1/2' },
    { deg: 90, rad: 'π/2', radVal: Math.PI / 2, sin: '1', cos: '0' },
    { deg: 120, rad: '2π/3', radVal: 2 * Math.PI / 3, sin: '√3/2', cos: '-1/2' },
    { deg: 135, rad: '3π/4', radVal: 3 * Math.PI / 4, sin: '√2/2', cos: '-√2/2' },
    { deg: 150, rad: '5π/6', radVal: 5 * Math.PI / 6, sin: '1/2', cos: '-√3/2' },
    { deg: 180, rad: 'π', radVal: Math.PI, sin: '0', cos: '-1' },
    { deg: 210, rad: '7π/6', radVal: 7 * Math.PI / 6, sin: '-1/2', cos: '-√3/2' },
    { deg: 225, rad: '5π/4', radVal: 5 * Math.PI / 4, sin: '-√2/2', cos: '-√2/2' },
    { deg: 240, rad: '4π/3', radVal: 4 * Math.PI / 3, sin: '-√3/2', cos: '-1/2' },
    { deg: 270, rad: '3π/2', radVal: 3 * Math.PI / 2, sin: '-1', cos: '0' },
    { deg: 300, rad: '5π/3', radVal: 5 * Math.PI / 3, sin: '-√3/2', cos: '1/2' },
    { deg: 315, rad: '7π/4', radVal: 7 * Math.PI / 4, sin: '-√2/2', cos: '√2/2' },
    { deg: 330, rad: '11π/6', radVal: 11 * Math.PI / 6, sin: '-1/2', cos: '√3/2' },
    { deg: 360, rad: '2π', radVal: 2 * Math.PI, sin: '0', cos: '1' },
];

@Component({
    selector: 'app-einheitskreis',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './einheitskreis.component.html',
    styleUrl: './einheitskreis.component.css'
})
export class EinheitskreisComponent implements AfterViewInit, OnDestroy {
    private platformId = inject(PLATFORM_ID);

    canvas = viewChild<ElementRef<HTMLCanvasElement>>('circleCanvas');
    plotCanvas = viewChild<ElementRef<HTMLCanvasElement>>('plotCanvas');
    private ctx: CanvasRenderingContext2D | null = null;
    private plotCtx: CanvasRenderingContext2D | null = null;
    private animId: number | null = null;

    // ── State signals ──────────────────────────────────────────
    angle = signal(Math.PI / 4);          // current angle in radians
    autoMode = signal(false);
    viewMode = signal<ViewMode>('trig');
    showTanCot = signal(true);
    useDegrees = signal(true);
    snapToSpecial = signal(false);

    // ── Canvas sizing ──────────────────────────────────────────
    private canvasSize = 500;
    private cx = 250;   // center x
    private cy = 250;   // center y
    private radius = 190; // pixel radius of unit circle

    // ── Plot sizing ────────────────────────────────────────────
    private plotWidth = 360;
    private plotHeight = 500;

    // ── Dragging state ─────────────────────────────────────────
    private isDragging = false;

    // ── Auto rotation ──────────────────────────────────────────
    private readonly ANGULAR_SPEED = (2 * Math.PI) / 5; // 2π per 5 seconds
    private lastTimestamp: number | null = null;

    // ── Computed values ────────────────────────────────────────
    angleDeg = computed(() => {
        let deg = (this.angle() * 180 / Math.PI) % 360;
        if (deg < 0) deg += 360;
        return deg;
    });

    sinVal = computed(() => Math.sin(this.angle()));
    cosVal = computed(() => Math.cos(this.angle()));
    tanVal = computed(() => Math.tan(this.angle()));
    cotVal = computed(() => Math.cos(this.angle()) / Math.sin(this.angle()));

    quadrant = computed(() => {
        const d = this.angleDeg();
        if (d < 90) return 'I';
        if (d < 180) return 'II';
        if (d < 270) return 'III';
        return 'IV';
    });

    angleDisplay = computed(() => {
        if (this.useDegrees()) {
            return `${this.angleDeg().toFixed(1)}°`;
        }
        // Find if near a special angle
        const special = this.nearestSpecialAngle();
        if (special && Math.abs(special.radVal - (this.angle() % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) < 0.01) {
            return special.rad;
        }
        return `${(this.angle() % (2 * Math.PI)).toFixed(3)} rad`;
    });

    specialAngle = computed<SpecialAngle | null>(() => this.nearestSpecialAngle());

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        setTimeout(() => this.initCanvas(), 0);
    }

    ngOnDestroy(): void {
        this.stopAnimation();
    }

    private initCanvas(): void {
        const el = this.canvas()?.nativeElement;
        if (!el) return;

        // Support hi-DPI
        const dpr = window.devicePixelRatio || 1;
        el.width = this.canvasSize * dpr;
        el.height = this.canvasSize * dpr;
        el.style.width = this.canvasSize + 'px';
        el.style.height = this.canvasSize + 'px';

        this.ctx = el.getContext('2d');
        if (this.ctx) {
            this.ctx.scale(dpr, dpr);
        }

        // Init plot canvas
        const plotEl = this.plotCanvas()?.nativeElement;
        if (plotEl) {
            plotEl.width = this.plotWidth * dpr;
            plotEl.height = this.plotHeight * dpr;
            plotEl.style.width = this.plotWidth + 'px';
            plotEl.style.height = this.plotHeight + 'px';
            this.plotCtx = plotEl.getContext('2d');
            if (this.plotCtx) {
                this.plotCtx.scale(dpr, dpr);
            }
        }

        this.draw();
    }

    // ── User interaction ───────────────────────────────────────

    onPointerDown(event: PointerEvent): void {
        if (this.autoMode()) return;
        this.isDragging = true;
        this.updateAngleFromPointer(event);
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
    }

    onPointerMove(event: PointerEvent): void {
        if (!this.isDragging) return;
        this.updateAngleFromPointer(event);
    }

    onPointerUp(): void {
        this.isDragging = false;
    }

    private updateAngleFromPointer(event: PointerEvent): void {
        const el = this.canvas()?.nativeElement;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const scaleX = this.canvasSize / rect.width;
        const scaleY = this.canvasSize / rect.height;
        const x = (event.clientX - rect.left) * scaleX - this.cx;
        const y = (event.clientY - rect.top) * scaleY - this.cy;
        let a = Math.atan2(-y, x); // flip y for math convention
        if (a < 0) a += 2 * Math.PI;

        if (this.snapToSpecial()) {
            a = this.snapAngle(a);
        }

        this.angle.set(a);
        this.draw();
    }

    private snapAngle(a: number): number {
        const SNAP_THRESHOLD = 0.08; // ~4.5°
        for (const sa of SPECIAL_ANGLES) {
            if (Math.abs(a - sa.radVal) < SNAP_THRESHOLD) return sa.radVal;
        }
        return a;
    }

    toggleAutoMode(): void {
        this.autoMode.update(v => !v);
        if (this.autoMode()) {
            this.lastTimestamp = null;
            this.startAnimation();
        } else {
            this.stopAnimation();
        }
    }

    toggleViewMode(): void {
        this.viewMode.update(v => v === 'trig' ? 'complex' : 'trig');
        this.draw();
    }

    toggleTanCot(): void {
        this.showTanCot.update(v => !v);
        this.draw();
    }

    toggleDegrees(): void {
        this.useDegrees.update(v => !v);
        this.draw();
    }

    toggleSnap(): void {
        this.snapToSpecial.update(v => !v);
    }

    setAngle(deg: number): void {
        this.angle.set(deg * Math.PI / 180);
        this.draw();
    }

    // ── Animation loop ─────────────────────────────────────────

    private startAnimation(): void {
        const step = (timestamp: number) => {
            if (!this.autoMode()) return;
            if (this.lastTimestamp !== null) {
                const dt = (timestamp - this.lastTimestamp) / 1000;
                this.angle.update(a => (a + this.ANGULAR_SPEED * dt) % (2 * Math.PI));
            }
            this.lastTimestamp = timestamp;
            this.draw();
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    }

    private stopAnimation(): void {
        if (this.animId !== null) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        this.lastTimestamp = null;
    }

    // ── Drawing ────────────────────────────────────────────────

    private draw(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const w = this.canvasSize;

        // Clear
        ctx.clearRect(0, 0, w, w);
        ctx.fillStyle = '#0f0f1e';
        ctx.fillRect(0, 0, w, w);

        this.drawGrid(ctx);
        this.drawUnitCircle(ctx);
        this.drawSpecialAngleDots(ctx);

        if (this.viewMode() === 'trig') {
            this.drawTrigTriangle(ctx);
        } else {
            this.drawComplexView(ctx);
        }

        this.drawRadiusAndPoint(ctx);
        this.drawAngleArc(ctx);

        // Draw the time plot
        this.drawPlot();
    }

    private drawGrid(ctx: CanvasRenderingContext2D): void {
        const w = this.canvasSize;
        const step = this.radius; // 1 unit = radius pixels

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        // Half-units
        for (let i = -3; i <= 3; i++) {
            const px = this.cx + i * step / 2;
            const py = this.cy + i * step / 2;
            if (px >= 0 && px <= w) {
                ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, w); ctx.stroke();
            }
            if (py >= 0 && py <= w) {
                ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
            }
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(this.cx, 0); ctx.lineTo(this.cx, w); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, this.cy); ctx.lineTo(w, this.cy); ctx.stroke();

        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // x-axis numbers
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue;
            ctx.fillText(String(i), this.cx + i * step / 2, this.cy + 5);
        }
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = -2; i <= 2; i++) {
            if (i === 0) continue;
            ctx.fillText(String(-i), this.cx - 5, this.cy + i * step / 2);
        }

        // Label axes
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        if (this.viewMode() === 'complex') {
            ctx.fillText('Re', w - 22, this.cy - 5);
            ctx.fillText('Im', this.cx + 6, 14);
        } else {
            ctx.fillText('x', w - 16, this.cy - 5);
            ctx.fillText('y', this.cx + 6, 14);
        }
    }

    private drawUnitCircle(ctx: CanvasRenderingContext2D): void {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, this.radius, 0, Math.PI * 2);
        ctx.stroke();
    }

    private drawSpecialAngleDots(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        for (const sa of SPECIAL_ANGLES) {
            if (sa.deg === 360) continue;
            const px = this.cx + this.radius * Math.cos(sa.radVal);
            const py = this.cy - this.radius * Math.sin(sa.radVal);
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    private drawRadiusAndPoint(ctx: CanvasRenderingContext2D): void {
        const a = this.angle();
        const px = this.cx + this.radius * Math.cos(a);
        const py = this.cy - this.radius * Math.sin(a);

        // Radius line
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(px, py);
        ctx.stroke();

        // Point on circle (draggable handle)
        ctx.fillStyle = '#64c8ff';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Coordinate label near point
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        if (this.viewMode() === 'complex') {
            ctx.fillText(`e^(i·${this.useDegrees() ? this.angleDeg().toFixed(0) + '°' : (a % (2 * Math.PI)).toFixed(2)})`, px + 14, py - 4);
        } else {
            ctx.fillText(`(${cos.toFixed(2)}, ${sin.toFixed(2)})`, px + 14, py - 4);
        }
    }

    private drawAngleArc(ctx: CanvasRenderingContext2D): void {
        const a = this.angle();
        const arcRadius = 30;

        ctx.strokeStyle = 'rgba(100,200,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, arcRadius, -a, 0); // canvas goes clockwise, angle is counter-clockwise
        ctx.stroke();

        // Angle label
        ctx.fillStyle = '#64c8ff';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelAngle = a / 2;
        const lx = this.cx + (arcRadius + 16) * Math.cos(labelAngle);
        const ly = this.cy - (arcRadius + 16) * Math.sin(labelAngle);
        ctx.fillText('θ', lx, ly);
    }

    private drawTrigTriangle(ctx: CanvasRenderingContext2D): void {
        const a = this.angle();
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const px = this.cx + this.radius * cos;
        const py = this.cy - this.radius * sin;
        const footX = this.cx + this.radius * cos;
        const footY = this.cy;

        // ── Right-angle triangle ──
        // Triangle: origin → footX → point
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);

        // Fill triangle
        ctx.fillStyle = 'rgba(100,200,255,0.06)';
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(footX, footY);
        ctx.lineTo(px, py);
        ctx.closePath();
        ctx.fill();

        // Right angle marker
        const markerSize = 10;
        const sx = cos < 0 ? -1 : 1;
        const sy = sin < 0 ? 1 : -1;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(footX - markerSize * sx, footY);
        ctx.lineTo(footX - markerSize * sx, footY + markerSize * sy);
        ctx.lineTo(footX, footY + markerSize * sy);
        ctx.stroke();

        // ── cos line (along x-axis) ──
        ctx.strokeStyle = '#4ade80'; // green
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(footX, footY);
        ctx.stroke();

        // cos label
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = cos >= 0 ? 'top' : 'top';
        ctx.fillText('cos θ', (this.cx + footX) / 2, this.cy + 12);

        // ── sin line (vertical) ──
        ctx.strokeStyle = '#f472b6'; // pink
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(footX, footY);
        ctx.lineTo(px, py);
        ctx.stroke();

        // sin label
        ctx.fillStyle = '#f472b6';
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('sin θ', footX + 8, (footY + py) / 2);

        // ── tan / cot lines ──
        if (this.showTanCot()) {
            this.drawTanCot(ctx, a, cos, sin);
        }
    }

    private drawTanCot(ctx: CanvasRenderingContext2D, a: number, cos: number, sin: number): void {
        const tan = Math.tan(a);

        // Tangent line: from (1,0) vertically to where the radius extended hits x=1
        if (Math.abs(cos) > 0.01) {
            const tanY = tan;
            const tanPxX = this.cx + this.radius;            // x = 1 on circle
            const tanPxY = this.cy - this.radius * tanY;    // y = tan(θ)

            // Clamp to visible area
            const clampedY = Math.max(10, Math.min(this.canvasSize - 10, tanPxY));

            // tan line (vertical at x=1)
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)'; // amber, less prominent
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(tanPxX, this.cy);
            ctx.lineTo(tanPxX, clampedY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Extended radius to tangent point
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(this.cx, this.cy);
            ctx.lineTo(tanPxX, clampedY);
            ctx.stroke();
            ctx.setLineDash([]);

            // tan label
            if (Math.abs(tanY) < 3) {
                ctx.fillStyle = 'rgba(251, 191, 36, 0.7)';
                ctx.font = '12px system-ui';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText('tan θ', tanPxX + 6, (this.cy + clampedY) / 2);
            }
        }

        // Cotangent line: from (0,1) horizontally to where the radius extended hits y=1
        if (Math.abs(sin) > 0.01) {
            const cot = cos / sin;
            const cotPxX = this.cx + this.radius * cot;     // x = cot(θ)
            const cotPxY = this.cy - this.radius;            // y = 1 on circle

            const clampedX = Math.max(10, Math.min(this.canvasSize - 10, cotPxX));

            ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)'; // purple, less prominent
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(this.cx, cotPxY);
            ctx.lineTo(clampedX, cotPxY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Extended radius to cot point
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(this.cx, this.cy);
            ctx.lineTo(clampedX, cotPxY);
            ctx.stroke();
            ctx.setLineDash([]);

            // cot label
            if (Math.abs(cot) < 3) {
                ctx.fillStyle = 'rgba(168, 85, 247, 0.65)';
                ctx.font = '12px system-ui';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('cot θ', (this.cx + clampedX) / 2, cotPxY - 6);
            }
        }
    }

    private drawComplexView(ctx: CanvasRenderingContext2D): void {
        const a = this.angle();
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const px = this.cx + this.radius * cos;
        const py = this.cy - this.radius * sin;
        const footX = this.cx + this.radius * cos;
        const footY = this.cy;

        // Fill triangle
        ctx.fillStyle = 'rgba(139,92,246,0.08)';
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(footX, footY);
        ctx.lineTo(px, py);
        ctx.closePath();
        ctx.fill();

        // Right angle marker
        const markerSize = 10;
        const sx = cos < 0 ? -1 : 1;
        const sy = sin < 0 ? 1 : -1;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(footX - markerSize * sx, footY);
        ctx.lineTo(footX - markerSize * sx, footY + markerSize * sy);
        ctx.lineTo(footX, footY + markerSize * sy);
        ctx.stroke();

        // Real part (horizontal)
        ctx.strokeStyle = '#38bdf8'; // sky blue
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(footX, footY);
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Re', (this.cx + footX) / 2, this.cy + 12);

        // Imaginary part (vertical)
        ctx.strokeStyle = '#c084fc'; // purple
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(footX, footY);
        ctx.lineTo(px, py);
        ctx.stroke();

        ctx.fillStyle = '#c084fc';
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Im', footX + 8, (footY + py) / 2);

        // Euler formula label on radius
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const midX = (this.cx + px) / 2;
        const midY = (this.cy + py) / 2;
        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(-a);
        ctx.fillText('r = 1', 0, -8);
        ctx.restore();
    }

    // ── Helpers ────────────────────────────────────────────────

    private nearestSpecialAngle(): SpecialAngle | null {
        let normalized = (this.angle() % (2 * Math.PI));
        if (normalized < 0) normalized += 2 * Math.PI;
        for (const sa of SPECIAL_ANGLES) {
            if (Math.abs(normalized - sa.radVal) < 0.015) return sa;
        }
        return null;
    }

    formatNum(n: number): string {
        if (!isFinite(n) || Math.abs(n) > 1e10) return n > 0 ? '∞' : '-∞';
        if (Math.abs(n) < 1e-10) return '0.0000';
        return n.toFixed(4);
    }

    formatShort(n: number): string {
        if (!isFinite(n) || Math.abs(n) > 1e10) return n > 0 ? '∞' : '-∞';
        if (Math.abs(n) < 1e-10) return '0.00';
        return n.toFixed(2);
    }

    readonly specialAngles = SPECIAL_ANGLES.filter(a => a.deg < 360);

    // ── Plot drawing ───────────────────────────────────────────

    private drawPlot(): void {
        const ctx = this.plotCtx;
        if (!ctx) return;

        const w = this.plotWidth;
        const h = this.plotHeight;
        const a = this.angle();
        const isComplex = this.viewMode() === 'complex';

        // Clear
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0f0f1e';
        ctx.fillRect(0, 0, w, h);

        // Layout: the plot shows one full period (0 to 2π) on the x-axis
        // y-axis is amplitude (-1 to 1)
        const padLeft = 40;
        const padRight = 15;
        const padTop = 25;
        const padBottom = 30;
        const plotW = w - padLeft - padRight;
        const plotH = h - padTop - padBottom;
        const midY = padTop + plotH / 2;

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        // Horizontal lines at -1, -0.5, 0, 0.5, 1
        for (const val of [-1, -0.5, 0, 0.5, 1]) {
            const y = midY - val * (plotH / 2);
            ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + plotW, y); ctx.stroke();
        }
        // Vertical lines at 0, π/2, π, 3π/2, 2π
        const piMarks = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, 2 * Math.PI];
        const piLabels = ['0', 'π/2', 'π', '3π/2', '2π'];
        for (let i = 0; i < piMarks.length; i++) {
            const x = padLeft + (piMarks[i] / (2 * Math.PI)) * plotW;
            ctx.beginPath(); ctx.moveTo(x, padTop); ctx.lineTo(x, padTop + plotH); ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        // x-axis (y=0)
        ctx.beginPath(); ctx.moveTo(padLeft, midY); ctx.lineTo(padLeft + plotW, midY); ctx.stroke();
        // y-axis
        ctx.beginPath(); ctx.moveTo(padLeft, padTop); ctx.lineTo(padLeft, padTop + plotH); ctx.stroke();

        // Axis labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i < piMarks.length; i++) {
            const x = padLeft + (piMarks[i] / (2 * Math.PI)) * plotW;
            ctx.fillText(piLabels[i], x, padTop + plotH + 6);
        }
        // y-axis labels
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const val of [-1, -0.5, 0, 0.5, 1]) {
            const y = midY - val * (plotH / 2);
            ctx.fillText(val.toString(), padLeft - 6, y);
        }

        // Title
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(isComplex ? 'Re / Im' : 'sin θ / cos θ', w / 2, 4);

        // Helper: angle to x pixel
        const angleToX = (ang: number) => padLeft + (ang / (2 * Math.PI)) * plotW;
        const valToY = (val: number) => midY - val * (plotH / 2);

        // Draw sin/cos (or Re/Im) curves
        const sinColor = isComplex ? '#c084fc' : '#f472b6';
        const cosColor = isComplex ? '#38bdf8' : '#4ade80';
        const sinLabel = isComplex ? 'Im' : 'sin';
        const cosLabel = isComplex ? 'Re' : 'cos';

        // cos curve
        ctx.strokeStyle = cosColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= plotW; i++) {
            const ang = (i / plotW) * 2 * Math.PI;
            const val = Math.cos(ang);
            const x = padLeft + i;
            const y = valToY(val);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // sin curve
        ctx.strokeStyle = sinColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= plotW; i++) {
            const ang = (i / plotW) * 2 * Math.PI;
            const val = Math.sin(ang);
            const x = padLeft + i;
            const y = valToY(val);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Current angle marker – vertical line
        const markerX = angleToX(a);
        ctx.strokeStyle = 'rgba(100,200,255,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(markerX, padTop);
        ctx.lineTo(markerX, padTop + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Current sin dot
        const sinY = valToY(Math.sin(a));
        ctx.fillStyle = sinColor;
        ctx.beginPath();
        ctx.arc(markerX, sinY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Current cos dot
        const cosY = valToY(Math.cos(a));
        ctx.fillStyle = cosColor;
        ctx.beginPath();
        ctx.arc(markerX, cosY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Connecting lines from dots to y-axis (show current values)
        ctx.strokeStyle = sinColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(markerX, sinY);
        ctx.lineTo(padLeft, sinY);
        ctx.stroke();

        ctx.strokeStyle = cosColor;
        ctx.beginPath();
        ctx.moveTo(markerX, cosY);
        ctx.lineTo(padLeft, cosY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Value labels next to dots
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = sinColor;
        ctx.fillText(`${sinLabel} ${Math.sin(a).toFixed(2)}`, markerX + 8, sinY - 2);
        ctx.fillStyle = cosColor;
        ctx.fillText(`${cosLabel} ${Math.cos(a).toFixed(2)}`, markerX + 8, cosY - 2);

        // Legend
        const legendY = padTop + plotH + 18;
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        ctx.fillStyle = cosColor;
        ctx.fillRect(padLeft, legendY, 12, 3);
        ctx.fillText(cosLabel, padLeft + 16, legendY + 4);
        ctx.fillStyle = sinColor;
        ctx.fillRect(padLeft + 55, legendY, 12, 3);
        ctx.fillText(sinLabel, padLeft + 71, legendY + 4);
    }
}