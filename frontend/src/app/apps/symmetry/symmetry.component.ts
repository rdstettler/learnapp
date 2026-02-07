import { Component, signal, ElementRef, viewChild, AfterViewInit, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

@Component({
    selector: 'app-symmetry',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './symmetry.component.html',
    styleUrl: './symmetry.component.css'
})
export class SymmetryComponent implements AfterViewInit, OnDestroy {
    private platformId = inject(PLATFORM_ID);

    canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
    private ctx: CanvasRenderingContext2D | null = null;
    private isDrawing = false;
    private lastX = 0;
    private lastY = 0;

    symmetryCount = signal(4);
    brushSize = signal(4);
    brushColor = signal('#6366f1');
    showGuides = signal(true);

    readonly colors = [
        '#6366f1', '#8b5cf6', '#d946ef', '#ec4899',
        '#f43f5e', '#f97316', '#facc15', '#22c55e',
        '#06b6d4', '#3b82f6', '#ffffff', '#000000'
    ];

    private resizeObserver: ResizeObserver | null = null;

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl) return;

        this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
        if (this.ctx) {
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
        }

        this.resizeObserver = new ResizeObserver(() => {
            this.handleResize();
        });

        this.resizeObserver.observe(canvasEl);
    }

    ngOnDestroy(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }

    private handleResize(): void {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl || !this.ctx) return;

        // Save current content
        let imageData: ImageData | null = null;
        if (canvasEl.width > 0 && canvasEl.height > 0) {
            try {
                imageData = this.ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            } catch (e) {
                console.warn('Could not save canvas content', e);
            }
        }

        // Update size to match display size
        const rect = canvasEl.getBoundingClientRect();
        canvasEl.width = rect.width;
        canvasEl.height = rect.height;

        // Restore context settings lost on resize
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = this.brushColor();
        this.ctx.lineWidth = this.brushSize();

        // Draw guides first (background)
        this.drawGuides();

        // Restore content
        if (imageData) {
            this.ctx.putImageData(imageData, 0, 0);
        }
    }

    private initCanvas(): void {
        // Deprecated, logic moved to handleResize via Observer
    }

    private drawGuides(): void {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl || !this.ctx || !this.showGuides()) return;

        const centerX = canvasEl.width / 2;
        const centerY = canvasEl.height / 2;
        const count = this.symmetryCount();

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
        this.ctx.lineWidth = 1;

        for (let i = 0; i < count; i++) {
            const angle = (i * 2 * Math.PI) / count;
            this.ctx.beginPath();
            this.ctx.moveTo(centerX, centerY);
            this.ctx.lineTo(
                centerX + Math.cos(angle) * Math.max(canvasEl.width, canvasEl.height),
                centerY + Math.sin(angle) * Math.max(canvasEl.width, canvasEl.height)
            );
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    onPointerDown(event: PointerEvent): void {
        this.isDrawing = true;
        const pos = this.getPosition(event);
        this.lastX = pos.x;
        this.lastY = pos.y;
    }

    onPointerMove(event: PointerEvent): void {
        if (!this.isDrawing || !this.ctx) return;

        event.preventDefault();
        const pos = this.getPosition(event);
        this.drawSymmetric(this.lastX, this.lastY, pos.x, pos.y);
        this.lastX = pos.x;
        this.lastY = pos.y;
    }

    onPointerUp(): void {
        this.isDrawing = false;
    }

    private getPosition(event: PointerEvent): { x: number; y: number } {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl) return { x: 0, y: 0 };

        const rect = canvasEl.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    private drawSymmetric(x1: number, y1: number, x2: number, y2: number): void {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl || !this.ctx) return;

        const centerX = canvasEl.width / 2;
        const centerY = canvasEl.height / 2;
        const count = this.symmetryCount();

        this.ctx.strokeStyle = this.brushColor();
        this.ctx.lineWidth = this.brushSize();

        for (let i = 0; i < count; i++) {
            const angle = (i * 2 * Math.PI) / count;

            // Rotate points around center
            const rx1 = centerX + (x1 - centerX) * Math.cos(angle) - (y1 - centerY) * Math.sin(angle);
            const ry1 = centerY + (x1 - centerX) * Math.sin(angle) + (y1 - centerY) * Math.cos(angle);
            const rx2 = centerX + (x2 - centerX) * Math.cos(angle) - (y2 - centerY) * Math.sin(angle);
            const ry2 = centerY + (x2 - centerX) * Math.sin(angle) + (y2 - centerY) * Math.cos(angle);

            this.ctx.beginPath();
            this.ctx.moveTo(rx1, ry1);
            this.ctx.lineTo(rx2, ry2);
            this.ctx.stroke();
        }
    }

    setSymmetry(count: number): void {
        this.symmetryCount.set(count);
        this.clearCanvas();
    }

    setColor(color: string): void {
        this.brushColor.set(color);
    }

    setBrushSize(size: number): void {
        this.brushSize.set(size);
    }

    toggleGuides(): void {
        this.showGuides.update(v => !v);
        this.clearCanvas();
    }

    clearCanvas(): void {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl || !this.ctx) return;

        this.ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        this.drawGuides();
    }
}
