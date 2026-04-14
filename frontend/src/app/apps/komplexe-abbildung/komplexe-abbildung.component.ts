import { Component, signal, computed, ElementRef, viewChild, AfterViewInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

interface ComplexNumber {
    re: number;
    im: number;
}

interface TransformFunction {
    id: string;
    name: string;
    description: string;
    formula: string;
    apply: (z: ComplexNumber, params: TransformParams) => ComplexNumber;
}

interface TransformParams {
    a: ComplexNumber; // for linear: slope
    b: ComplexNumber; // for linear: offset
    n: number;        // for z^n: exponent
    c: ComplexNumber;  // for Möbius: c
    d: ComplexNumber;  // for Möbius: d
}

@Component({
    selector: 'app-komplexe-abbildung',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './komplexe-abbildung.component.html',
    styleUrl: './komplexe-abbildung.component.css'
})
export class KomplexeAbbildungComponent implements AfterViewInit {
    private platformId = inject(PLATFORM_ID);

    sourceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('sourceCanvas');
    resultCanvas = viewChild<ElementRef<HTMLCanvasElement>>('resultCanvas');
    fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

    private sourceCtx: CanvasRenderingContext2D | null = null;
    private resultCtx: CanvasRenderingContext2D | null = null;
    private sourceImageData: ImageData | null = null;

    selectedFunction = signal<string>('z2');
    imageLoaded = signal(false);
    isProcessing = signal(false);
    showAxes = signal(true);
    resolution = signal<number>(1);
    imageName = signal<string>('');

    // Parameters for interactive control
    paramA = signal<number>(1);
    paramB = signal<number>(0);
    paramAngle = signal<number>(0);
    paramN = signal<number>(2);

    canvasWidth = 450;
    canvasHeight = 450;

    readonly functions: TransformFunction[] = [
        {
            id: 'z2',
            name: 'z²',
            description: 'Quadrierung – verdoppelt Winkel, quadriert Abstände',
            formula: 'f(z) = z²',
            apply: (z) => this.cMul(z, z)
        },
        {
            id: 'z3',
            name: 'z³',
            description: 'Kubierung – verdreifacht Winkel',
            formula: 'f(z) = z³',
            apply: (z) => this.cMul(this.cMul(z, z), z)
        },
        {
            id: 'zn',
            name: 'zⁿ',
            description: 'n-te Potenz – wähle den Exponenten',
            formula: 'f(z) = zⁿ',
            apply: (z, p) => this.cPow(z, p.n)
        },
        {
            id: 'exp',
            name: 'exp(z)',
            description: 'Exponentialfunktion – Geraden werden zu Spiralen',
            formula: 'f(z) = eᶻ',
            apply: (z) => this.cExp(z)
        },
        {
            id: 'ln',
            name: 'ln(z)',
            description: 'Logarithmus – Kreise werden zu Geraden',
            formula: 'f(z) = ln(z)',
            apply: (z) => this.cLn(z)
        },
        {
            id: 'inv',
            name: '1/z',
            description: 'Inversion – spiegelt an der Einheitskreislinie',
            formula: 'f(z) = 1/z',
            apply: (z) => this.cInv(z)
        },
        {
            id: 'sin',
            name: 'sin(z)',
            description: 'Sinus – erzeugt wellenförmige Verzerrungen',
            formula: 'f(z) = sin(z)',
            apply: (z) => this.cSin(z)
        },
        {
            id: 'cos',
            name: 'cos(z)',
            description: 'Cosinus – ähnlich Sinus, aber phasenverschoben',
            formula: 'f(z) = cos(z)',
            apply: (z) => this.cCos(z)
        },
        {
            id: 'sqrt',
            name: '√z',
            description: 'Wurzel – halbiert Winkel, Wurzel des Abstands',
            formula: 'f(z) = √z',
            apply: (z) => this.cSqrt(z)
        },
        {
            id: 'joukowski',
            name: 'z + 1/z',
            description: 'Joukowski – Kreise werden zu Tragflächenprofilen',
            formula: 'f(z) = z + 1/z',
            apply: (z) => this.cAdd(z, this.cInv(z))
        },
        {
            id: 'linear',
            name: 'az + b',
            description: 'Lineartransformation – Drehung, Skalierung, Verschiebung',
            formula: 'f(z) = az + b',
            apply: (z, p) => this.cAdd(this.cMul(p.a, z), p.b)
        },
        {
            id: 'mobius',
            name: '(az+b)/(cz+d)',
            description: 'Möbius-Transformation – kreiserhaltende Abbildung',
            formula: 'f(z) = (az+b)/(cz+d)',
            apply: (z, p) => {
                const num = this.cAdd(this.cMul(p.a, z), p.b);
                const den = this.cAdd(this.cMul(p.c, z), p.d);
                return this.cDiv(num, den);
            }
        }
    ];

    currentFunction = computed(() => {
        return this.functions.find(f => f.id === this.selectedFunction()) ?? this.functions[0];
    });

    needsParamN = computed(() => this.selectedFunction() === 'zn');
    needsLinearParams = computed(() => this.selectedFunction() === 'linear');
    needsMobiusParams = computed(() => this.selectedFunction() === 'mobius');

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        setTimeout(() => this.initCanvases(), 0);
    }

    private initCanvases(): void {
        const srcEl = this.sourceCanvas()?.nativeElement;
        const resEl = this.resultCanvas()?.nativeElement;
        if (!srcEl || !resEl) return;

        srcEl.width = this.canvasWidth;
        srcEl.height = this.canvasHeight;
        resEl.width = this.canvasWidth;
        resEl.height = this.canvasHeight;

        this.sourceCtx = srcEl.getContext('2d');
        this.resultCtx = resEl.getContext('2d');

        this.drawEmptyState(this.sourceCtx!, 'Bild hochladen');
        this.drawEmptyState(this.resultCtx!, 'Transformiertes Bild');
    }

    private drawEmptyState(ctx: CanvasRenderingContext2D, label: string): void {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

        if (this.showAxes()) {
            this.drawGrid(ctx);
        }

        ctx.fillStyle = '#666';
        ctx.font = '16px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(label, this.canvasWidth / 2, this.canvasHeight / 2);
    }

    private drawGrid(ctx: CanvasRenderingContext2D): void {
        const w = this.canvasWidth;
        const h = this.canvasHeight;
        const cx = w / 2;
        const cy = h / 2;
        const step = 50;

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let x = cx % step; x < w; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = cy % step; y < h; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // axes
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();

        // unit circle
        ctx.strokeStyle = 'rgba(100,200,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, step, 0, Math.PI * 2);
        ctx.stroke();

        // labels
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Re', w - 20, cy - 5);
        ctx.fillText('Im', cx + 5, 12);
    }

    triggerFileInput(): void {
        this.fileInput()?.nativeElement.click();
    }

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        if (!input.files?.length) return;

        const file = input.files[0];
        this.imageName.set(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                this.loadImage(img);
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    }

    loadSampleImage(): void {
        this.imageName.set('Musterbild');
        this.generateSampleImage();
    }

    private generateSampleImage(): void {
        const srcCtx = this.sourceCtx;
        if (!srcCtx) return;

        const w = this.canvasWidth;
        const h = this.canvasHeight;

        // Generate a colorful grid pattern as sample
        srcCtx.fillStyle = '#1a1a2e';
        srcCtx.fillRect(0, 0, w, h);

        const step = 25;
        for (let x = 0; x < w; x += step) {
            for (let y = 0; y < h; y += step) {
                const hue = ((x / w) * 360 + (y / h) * 60) % 360;
                const lightness = 40 + 20 * Math.sin(x * 0.05) * Math.cos(y * 0.05);
                srcCtx.fillStyle = `hsl(${hue}, 70%, ${lightness}%)`;
                srcCtx.fillRect(x, y, step - 1, step - 1);
            }
        }

        // Draw some geometric shapes for better visualization
        // concentric circles
        const cx = w / 2, cy = h / 2;
        for (let r = 30; r < 200; r += 30) {
            srcCtx.strokeStyle = `hsla(${r * 2}, 80%, 60%, 0.8)`;
            srcCtx.lineWidth = 2;
            srcCtx.beginPath();
            srcCtx.arc(cx, cy, r, 0, Math.PI * 2);
            srcCtx.stroke();
        }

        // radial lines
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
            srcCtx.strokeStyle = 'rgba(255,255,255,0.3)';
            srcCtx.lineWidth = 1;
            srcCtx.beginPath();
            srcCtx.moveTo(cx, cy);
            srcCtx.lineTo(cx + 200 * Math.cos(angle), cy + 200 * Math.sin(angle));
            srcCtx.stroke();
        }

        // grid lines
        srcCtx.strokeStyle = 'rgba(255,200,0,0.3)';
        srcCtx.lineWidth = 1;
        for (let x = 0; x < w; x += 50) {
            srcCtx.beginPath(); srcCtx.moveTo(x, 0); srcCtx.lineTo(x, h); srcCtx.stroke();
        }
        for (let y = 0; y < h; y += 50) {
            srcCtx.beginPath(); srcCtx.moveTo(0, y); srcCtx.lineTo(w, y); srcCtx.stroke();
        }

        this.sourceImageData = srcCtx.getImageData(0, 0, w, h);
        this.imageLoaded.set(true);
        this.applyTransform();
    }

    private loadImage(img: HTMLImageElement): void {
        const srcCtx = this.sourceCtx;
        if (!srcCtx) return;

        const w = this.canvasWidth;
        const h = this.canvasHeight;

        srcCtx.fillStyle = '#1a1a2e';
        srcCtx.fillRect(0, 0, w, h);

        // Scale image to fit canvas while preserving aspect ratio
        const scale = Math.min(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;

        srcCtx.drawImage(img, dx, dy, dw, dh);

        this.sourceImageData = srcCtx.getImageData(0, 0, w, h);
        this.imageLoaded.set(true);
        this.applyTransform();
    }

    selectFunction(id: string): void {
        this.selectedFunction.set(id);
        if (this.imageLoaded()) {
            this.applyTransform();
        }
    }

    onParamChange(): void {
        if (this.imageLoaded()) {
            this.applyTransform();
        }
    }

    toggleAxes(): void {
        this.showAxes.update(v => !v);
        if (this.imageLoaded()) {
            this.applyTransform();
        }
    }

    applyTransform(): void {
        if (!this.sourceImageData || !this.resultCtx) return;

        this.isProcessing.set(true);

        // Use requestAnimationFrame to not block the UI
        requestAnimationFrame(() => {
            this.performTransform();
            this.isProcessing.set(false);
        });
    }

    private performTransform(): void {
        const ctx = this.resultCtx!;
        const w = this.canvasWidth;
        const h = this.canvasHeight;
        const srcData = this.sourceImageData!;
        const fn = this.currentFunction();
        const res = this.resolution();

        const params = this.getParams();

        // Create output image
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);

        if (this.showAxes()) {
            this.drawGrid(ctx);
        }

        const resultImageData = ctx.getImageData(0, 0, w, h);
        const resultPixels = resultImageData.data;
        const srcPixels = srcData.data;

        const cx = w / 2;
        const cy = h / 2;
        const scale = 50; // pixels per unit in complex plane

        // Inverse mapping: for each pixel in the result, find where it came from
        for (let py = 0; py < h; py += res) {
            for (let px = 0; px < w; px += res) {
                // Convert pixel to complex number (result space)
                const wz: ComplexNumber = {
                    re: (px - cx) / scale,
                    im: -(py - cy) / scale  // flip y for standard math orientation
                };

                // We need the inverse: given w = f(z), find z
                // Then sample the source image at z's pixel position
                let z: ComplexNumber | null = null;

                try {
                    z = this.inverseTransform(fn.id, wz, params);
                } catch {
                    continue; // skip if inverse fails
                }

                if (!z || !isFinite(z.re) || !isFinite(z.im)) continue;

                // Convert z back to source pixel coordinates
                const sx = Math.round(z.re * scale + cx);
                const sy = Math.round(-z.im * scale + cy);

                if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

                const srcIdx = (sy * w + sx) * 4;
                const dstIdx = (py * w + px) * 4;

                // Copy pixel (with resolution block fill)
                for (let by = 0; by < res && py + by < h; by++) {
                    for (let bx = 0; bx < res && px + bx < w; bx++) {
                        const di = ((py + by) * w + (px + bx)) * 4;
                        resultPixels[di] = srcPixels[srcIdx];
                        resultPixels[di + 1] = srcPixels[srcIdx + 1];
                        resultPixels[di + 2] = srcPixels[srcIdx + 2];
                        resultPixels[di + 3] = srcPixels[srcIdx + 3];
                    }
                }
            }
        }

        ctx.putImageData(resultImageData, 0, 0);

        // Re-draw grid on top if enabled
        if (this.showAxes()) {
            this.drawGrid(ctx);
        }
    }

    private inverseTransform(fnId: string, w: ComplexNumber, params: TransformParams): ComplexNumber | null {
        switch (fnId) {
            case 'z2':
                return this.cSqrt(w);
            case 'z3':
                return this.cPow(w, 1 / 3);
            case 'zn':
                return this.cPow(w, 1 / params.n);
            case 'exp':
                return this.cLn(w);
            case 'ln':
                return this.cExp(w);
            case 'inv':
                return this.cInv(w); // 1/z is its own inverse
            case 'sin':
                return this.cAsin(w);
            case 'cos':
                return this.cAcos(w);
            case 'sqrt':
                return this.cMul(w, w); // inverse of sqrt is square
            case 'joukowski': {
                // Inverse of w = z + 1/z: z = (w ± sqrt(w²-4))/2
                const disc = this.cSub(this.cMul(w, w), { re: 4, im: 0 });
                const sqrtDisc = this.cSqrt(disc);
                return this.cScale(this.cAdd(w, sqrtDisc), 0.5);
            }
            case 'linear': {
                // Inverse of w = az + b: z = (w - b) / a
                return this.cDiv(this.cSub(w, params.b), params.a);
            }
            case 'mobius': {
                // Inverse of (az+b)/(cz+d): z = (dw - b) / (a - cw)
                const num = this.cSub(this.cMul(params.d, w), params.b);
                const den = this.cSub(params.a, this.cMul(params.c, w));
                return this.cDiv(num, den);
            }
            default:
                return w;
        }
    }

    private getParams(): TransformParams {
        const angle = this.paramAngle() * Math.PI / 180;
        const mag = this.paramA();
        return {
            a: { re: mag * Math.cos(angle), im: mag * Math.sin(angle) },
            b: { re: this.paramB(), im: 0 },
            n: this.paramN(),
            c: { re: 0, im: 0 },
            d: { re: 1, im: 0 }
        };
    }

    // ── Complex arithmetic ────────────────────────────────────────

    private cAdd(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
        return { re: a.re + b.re, im: a.im + b.im };
    }

    private cSub(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
        return { re: a.re - b.re, im: a.im - b.im };
    }

    private cMul(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
        return {
            re: a.re * b.re - a.im * b.im,
            im: a.re * b.im + a.im * b.re
        };
    }

    private cDiv(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
        const denom = b.re * b.re + b.im * b.im;
        if (denom < 1e-10) return { re: Infinity, im: Infinity };
        return {
            re: (a.re * b.re + a.im * b.im) / denom,
            im: (a.im * b.re - a.re * b.im) / denom
        };
    }

    private cScale(z: ComplexNumber, s: number): ComplexNumber {
        return { re: z.re * s, im: z.im * s };
    }

    private cInv(z: ComplexNumber): ComplexNumber {
        return this.cDiv({ re: 1, im: 0 }, z);
    }

    private cExp(z: ComplexNumber): ComplexNumber {
        const er = Math.exp(z.re);
        return { re: er * Math.cos(z.im), im: er * Math.sin(z.im) };
    }

    private cLn(z: ComplexNumber): ComplexNumber {
        const r = Math.sqrt(z.re * z.re + z.im * z.im);
        if (r < 1e-10) return { re: -Infinity, im: 0 };
        return { re: Math.log(r), im: Math.atan2(z.im, z.re) };
    }

    private cSqrt(z: ComplexNumber): ComplexNumber {
        const r = Math.sqrt(z.re * z.re + z.im * z.im);
        const theta = Math.atan2(z.im, z.re);
        const sqrtR = Math.sqrt(r);
        return { re: sqrtR * Math.cos(theta / 2), im: sqrtR * Math.sin(theta / 2) };
    }

    private cPow(z: ComplexNumber, n: number): ComplexNumber {
        const r = Math.sqrt(z.re * z.re + z.im * z.im);
        if (r < 1e-10) return { re: 0, im: 0 };
        const theta = Math.atan2(z.im, z.re);
        const rn = Math.pow(r, n);
        return { re: rn * Math.cos(n * theta), im: rn * Math.sin(n * theta) };
    }

    private cSin(z: ComplexNumber): ComplexNumber {
        // sin(z) = (e^(iz) - e^(-iz)) / (2i)
        const iz: ComplexNumber = { re: -z.im, im: z.re };
        const niz: ComplexNumber = { re: z.im, im: -z.re };
        const eiz = this.cExp(iz);
        const eniz = this.cExp(niz);
        const diff = this.cSub(eiz, eniz);
        // divide by 2i: (a+bi)/(2i) = (b - ai) / 2 → (a+bi) * (-i/2) = (b/2) + (-a/2)i
        return { re: diff.im / 2, im: -diff.re / 2 };
    }

    private cCos(z: ComplexNumber): ComplexNumber {
        // cos(z) = (e^(iz) + e^(-iz)) / 2
        const iz: ComplexNumber = { re: -z.im, im: z.re };
        const niz: ComplexNumber = { re: z.im, im: -z.re };
        const eiz = this.cExp(iz);
        const eniz = this.cExp(niz);
        const sum = this.cAdd(eiz, eniz);
        return this.cScale(sum, 0.5);
    }

    private cAsin(z: ComplexNumber): ComplexNumber {
        // asin(z) = -i * ln(iz + sqrt(1 - z²))
        const z2 = this.cMul(z, z);
        const oneMinusZ2 = this.cSub({ re: 1, im: 0 }, z2);
        const sqrtPart = this.cSqrt(oneMinusZ2);
        const iz: ComplexNumber = { re: -z.im, im: z.re };
        const inner = this.cAdd(iz, sqrtPart);
        const lnPart = this.cLn(inner);
        // multiply by -i: (a+bi)*(-i) = b - ai
        return { re: lnPart.im, im: -lnPart.re };
    }

    private cAcos(z: ComplexNumber): ComplexNumber {
        // acos(z) = -i * ln(z + sqrt(z² - 1))
        const z2 = this.cMul(z, z);
        const z2Minus1 = this.cSub(z2, { re: 1, im: 0 });
        const sqrtPart = this.cSqrt(z2Minus1);
        const inner = this.cAdd(z, sqrtPart);
        const lnPart = this.cLn(inner);
        return { re: lnPart.im, im: -lnPart.re };
    }
}
