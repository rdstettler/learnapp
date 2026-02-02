import { Component, signal, ElementRef, viewChild, AfterViewInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

interface Point {
    x: number;
    y: number;
}

interface Polygon {
    points: Point[];
    closed: boolean;
}

interface MirrorLine {
    start: Point;
    end: Point;
}

@Component({
    selector: 'app-symmetrien',
    standalone: true,
    templateUrl: './symmetrien.component.html',
    styleUrl: './symmetrien.component.css'
})
export class SymmetrienComponent implements AfterViewInit {
    private platformId = inject(PLATFORM_ID);

    canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
    private ctx: CanvasRenderingContext2D | null = null;

    currentTool = signal<'polygon' | 'line' | 'point' | null>(null);
    status = signal('Select a tool to start drawing');

    private polygon: Polygon | null = null;
    private mirrorLine: MirrorLine | null = null;
    private mirrorPoint: Point | null = null;

    private isDrawing = false;
    private isDragging = false;
    private dragTarget: string | null = null;
    private dragOffset: Point = { x: 0, y: 0 };

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        setTimeout(() => this.initCanvas(), 0);
    }

    private initCanvas(): void {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl) return;

        canvasEl.width = 900;
        canvasEl.height = 550;

        this.ctx = canvasEl.getContext('2d');
        this.draw();
    }

    setTool(tool: 'polygon' | 'line' | 'point'): void {
        this.currentTool.set(tool);
        if (tool === 'polygon') {
            this.status.set('Click to add polygon vertices, double-click or click near first point to close');
        } else if (tool === 'line') {
            this.status.set('Click and drag to draw mirror line');
        } else if (tool === 'point') {
            this.status.set('Click to place mirror point');
        }
    }

    clearAll(): void {
        this.polygon = null;
        this.mirrorLine = null;
        this.mirrorPoint = null;
        this.currentTool.set(null);
        this.status.set('All cleared. Select a tool to start drawing');
        this.draw();
    }

    onPointerDown(event: PointerEvent): void {
        const pos = this.getPosition(event);

        // Check for dragging existing objects first
        if (this.mirrorPoint && this.distance(pos, this.mirrorPoint) < 15) {
            this.isDragging = true;
            this.dragTarget = 'point';
            this.dragOffset = { x: pos.x - this.mirrorPoint.x, y: pos.y - this.mirrorPoint.y };
            this.status.set('Dragging mirror point');
            return;
        }

        if (this.mirrorLine) {
            if (this.distance(pos, this.mirrorLine.start) < 15) {
                this.isDragging = true;
                this.dragTarget = 'line-start';
                this.status.set('Dragging line start point');
                return;
            }
            if (this.distance(pos, this.mirrorLine.end) < 15) {
                this.isDragging = true;
                this.dragTarget = 'line-end';
                this.status.set('Dragging line end point');
                return;
            }
            if (this.pointToLineDistance(pos, this.mirrorLine.start, this.mirrorLine.end) < 10) {
                this.isDragging = true;
                this.dragTarget = 'line';
                this.dragOffset = { x: pos.x - this.mirrorLine.start.x, y: pos.y - this.mirrorLine.start.y };
                this.status.set('Dragging mirror line');
                return;
            }
        }

        if (this.polygon?.closed) {
            const center = this.getPolygonCenter();
            if (center && (this.isPointInPolygon(pos, this.polygon) || this.distance(pos, center) < 30)) {
                this.isDragging = true;
                this.dragTarget = 'polygon';
                this.dragOffset = { x: pos.x - center.x, y: pos.y - center.y };
                this.status.set('Dragging polygon');
                return;
            }
        }

        // Creating new objects based on current tool
        const tool = this.currentTool();
        if (tool === 'polygon') {
            if (!this.polygon) {
                this.polygon = { points: [pos], closed: false };
            } else if (!this.polygon.closed) {
                if (this.polygon.points.length >= 3 && this.distance(pos, this.polygon.points[0]) < 25) {
                    this.polygon.closed = true;
                    this.status.set('Polygon closed! Drag to move it.');
                    this.draw();
                    return;
                }
                this.polygon.points.push(pos);
            }
            this.status.set(`Polygon: ${this.polygon.points.length} vertices. Click near first point to close.`);
            this.draw();
        } else if (tool === 'line') {
            this.isDrawing = true;
            this.mirrorLine = { start: { ...pos }, end: { ...pos } };
            this.status.set('Drawing mirror line...');
        } else if (tool === 'point') {
            this.mirrorPoint = { ...pos };
            this.status.set('Mirror point placed. Drag to move.');
            this.draw();
        }
    }

    onPointerMove(event: PointerEvent): void {
        event.preventDefault();
        const pos = this.getPosition(event);

        if (this.isDrawing && this.currentTool() === 'line' && this.mirrorLine) {
            this.mirrorLine.end = { ...pos };
            this.draw();
            return;
        }

        if (this.isDragging) {
            if (this.dragTarget === 'point' && this.mirrorPoint) {
                this.mirrorPoint.x = pos.x - this.dragOffset.x;
                this.mirrorPoint.y = pos.y - this.dragOffset.y;
            } else if (this.dragTarget === 'line-start' && this.mirrorLine) {
                this.mirrorLine.start = { ...pos };
            } else if (this.dragTarget === 'line-end' && this.mirrorLine) {
                this.mirrorLine.end = { ...pos };
            } else if (this.dragTarget === 'line' && this.mirrorLine) {
                const dx = pos.x - this.dragOffset.x - this.mirrorLine.start.x;
                const dy = pos.y - this.dragOffset.y - this.mirrorLine.start.y;
                this.mirrorLine.start.x += dx;
                this.mirrorLine.start.y += dy;
                this.mirrorLine.end.x += dx;
                this.mirrorLine.end.y += dy;
                this.dragOffset = { x: pos.x - this.mirrorLine.start.x, y: pos.y - this.mirrorLine.start.y };
            } else if (this.dragTarget === 'polygon' && this.polygon) {
                const center = this.getPolygonCenter();
                if (center) {
                    const dx = pos.x - this.dragOffset.x - center.x;
                    const dy = pos.y - this.dragOffset.y - center.y;
                    this.polygon.points.forEach(p => {
                        p.x += dx;
                        p.y += dy;
                    });
                }
            }
            this.draw();
        }
    }

    onPointerUp(): void {
        if (this.isDrawing && this.currentTool() === 'line') {
            this.isDrawing = false;
            this.status.set('Mirror line created. Drag endpoints to adjust.');
        }
        if (this.isDragging) {
            this.isDragging = false;
            this.dragTarget = null;
            this.status.set('Object moved');
        }
        this.draw();
    }

    onDoubleClick(event: MouseEvent): void {
        if (this.currentTool() === 'polygon' && this.polygon && !this.polygon.closed && this.polygon.points.length >= 3) {
            this.polygon.closed = true;
            this.status.set('Polygon closed! Drag to move it.');
            this.draw();
        }
    }

    private getPosition(event: PointerEvent | MouseEvent): Point {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl) return { x: 0, y: 0 };

        const rect = canvasEl.getBoundingClientRect();
        const scaleX = canvasEl.width / rect.width;
        const scaleY = canvasEl.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    private distance(p1: Point, p2: Point): number {
        return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    }

    private pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        const param = lenSq !== 0 ? dot / lenSq : -1;

        let xx: number, yy: number;
        if (param < 0) {
            xx = lineStart.x; yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x; yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }

        return Math.sqrt((point.x - xx) ** 2 + (point.y - yy) ** 2);
    }

    private getPolygonCenter(): Point | null {
        if (!this.polygon || this.polygon.points.length === 0) return null;
        const sum = this.polygon.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: sum.x / this.polygon.points.length, y: sum.y / this.polygon.points.length };
    }

    private isPointInPolygon(point: Point, poly: Polygon): boolean {
        if (poly.points.length < 3) return false;
        let inside = false;
        const points = poly.points;

        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            if ((points[i].y > point.y) !== (points[j].y > point.y) &&
                point.x < (points[j].x - points[i].x) * (point.y - points[i].y) / (points[j].y - points[i].y) + points[i].x) {
                inside = !inside;
            }
        }
        return inside;
    }

    private mirrorPointAcrossLine(point: Point, lineStart: Point, lineEnd: Point): Point {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
        const closestX = lineStart.x + t * dx;
        const closestY = lineStart.y + t * dy;
        return { x: 2 * closestX - point.x, y: 2 * closestY - point.y };
    }

    private mirrorPointAcrossPoint(point: Point, center: Point): Point {
        return { x: 2 * center.x - point.x, y: 2 * center.y - point.y };
    }

    private draw(): void {
        if (!this.ctx) return;
        const canvas = this.canvas()?.nativeElement;
        if (!canvas) return;

        this.ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        this.drawGrid(canvas);

        // Draw mirrored polygons first (behind original)
        if (this.polygon?.closed && this.mirrorLine) {
            const lineMirrored = this.polygon.points.map(p =>
                this.mirrorPointAcrossLine(p, this.mirrorLine!.start, this.mirrorLine!.end));
            this.drawPolygonShape(lineMirrored, 'rgba(245, 87, 108, 0.4)', 'rgba(245, 87, 108, 0.8)', true);
        }

        if (this.polygon?.closed && this.mirrorPoint) {
            const pointMirrored = this.polygon.points.map(p =>
                this.mirrorPointAcrossPoint(p, this.mirrorPoint!));
            this.drawPolygonShape(pointMirrored, 'rgba(0, 242, 254, 0.4)', 'rgba(0, 242, 254, 0.8)', true);
        }

        // Draw mirror line
        if (this.mirrorLine) {
            this.drawMirrorLine(canvas);
        }

        // Draw mirror point
        if (this.mirrorPoint) {
            this.drawMirrorPoint();
        }

        // Draw original polygon
        if (this.polygon) {
            this.drawPolygon(canvas);
        }
    }

    private drawGrid(canvas: HTMLCanvasElement): void {
        if (!this.ctx) return;
        this.ctx.strokeStyle = '#e0e0e0';
        this.ctx.lineWidth = 0.5;

        for (let x = 0; x <= canvas.width; x += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, canvas.height);
            this.ctx.stroke();
        }

        for (let y = 0; y <= canvas.height; y += 50) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(canvas.width, y);
            this.ctx.stroke();
        }
    }

    private drawPolygon(canvas: HTMLCanvasElement): void {
        if (!this.ctx || !this.polygon || this.polygon.points.length === 0) return;

        if (this.polygon.closed && this.polygon.points.length >= 3) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.polygon.points[0].x, this.polygon.points[0].y);
            for (let i = 1; i < this.polygon.points.length; i++) {
                this.ctx.lineTo(this.polygon.points[i].x, this.polygon.points[i].y);
            }
            this.ctx.closePath();

            const gradient = this.ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, 'rgba(102, 126, 234, 0.6)');
            gradient.addColorStop(1, 'rgba(118, 75, 162, 0.6)');
            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }

        // Draw lines connecting points
        if (this.polygon.points.length > 1 && !this.polygon.closed) {
            this.ctx.beginPath();
            this.ctx.moveTo(this.polygon.points[0].x, this.polygon.points[0].y);
            for (let i = 1; i < this.polygon.points.length; i++) {
                this.ctx.lineTo(this.polygon.points[i].x, this.polygon.points[i].y);
            }
            this.ctx.strokeStyle = '#667eea';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw vertices
        this.polygon.points.forEach(p => {
            this.ctx!.beginPath();
            this.ctx!.arc(p.x, p.y, 6, 0, Math.PI * 2);
            this.ctx!.fillStyle = '#667eea';
            this.ctx!.fill();
            this.ctx!.strokeStyle = '#fff';
            this.ctx!.lineWidth = 2;
            this.ctx!.stroke();
        });
    }

    private drawPolygonShape(points: Point[], fillColor: string, strokeColor: string, dashed = false): void {
        if (!this.ctx || points.length < 3) return;

        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            this.ctx.lineTo(points[i].x, points[i].y);
        }
        this.ctx.closePath();

        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        if (dashed) this.ctx.setLineDash([5, 5]);
        this.ctx.strokeStyle = strokeColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        points.forEach(p => {
            this.ctx!.beginPath();
            this.ctx!.arc(p.x, p.y, 4, 0, Math.PI * 2);
            this.ctx!.fillStyle = strokeColor;
            this.ctx!.fill();
        });
    }

    private drawMirrorLine(canvas: HTMLCanvasElement): void {
        if (!this.ctx || !this.mirrorLine) return;

        const dx = this.mirrorLine.end.x - this.mirrorLine.start.x;
        const dy = this.mirrorLine.end.y - this.mirrorLine.start.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        if (len > 0) {
            const extendFactor = 2000;
            const extStart = {
                x: this.mirrorLine.start.x - (dx / len) * extendFactor,
                y: this.mirrorLine.start.y - (dy / len) * extendFactor
            };
            const extEnd = {
                x: this.mirrorLine.end.x + (dx / len) * extendFactor,
                y: this.mirrorLine.end.y + (dy / len) * extendFactor
            };

            this.ctx.beginPath();
            this.ctx.moveTo(extStart.x, extStart.y);
            this.ctx.lineTo(extEnd.x, extEnd.y);
            this.ctx.strokeStyle = 'rgba(245, 87, 108, 0.3)';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([10, 10]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw main line
        this.ctx.beginPath();
        this.ctx.moveTo(this.mirrorLine.start.x, this.mirrorLine.start.y);
        this.ctx.lineTo(this.mirrorLine.end.x, this.mirrorLine.end.y);
        this.ctx.strokeStyle = '#f5576c';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();

        // Draw endpoints
        [this.mirrorLine.start, this.mirrorLine.end].forEach(p => {
            this.ctx!.beginPath();
            this.ctx!.arc(p.x, p.y, 8, 0, Math.PI * 2);
            this.ctx!.fillStyle = '#f5576c';
            this.ctx!.fill();
            this.ctx!.strokeStyle = '#fff';
            this.ctx!.lineWidth = 2;
            this.ctx!.stroke();
        });
    }

    private drawMirrorPoint(): void {
        if (!this.ctx || !this.mirrorPoint) return;

        // Draw radiating circles
        for (let r = 20; r <= 60; r += 20) {
            this.ctx.beginPath();
            this.ctx.arc(this.mirrorPoint.x, this.mirrorPoint.y, r, 0, Math.PI * 2);
            this.ctx.strokeStyle = `rgba(0, 242, 254, ${0.3 - r * 0.003})`;
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw main point
        this.ctx.beginPath();
        this.ctx.arc(this.mirrorPoint.x, this.mirrorPoint.y, 10, 0, Math.PI * 2);
        const gradient = this.ctx.createRadialGradient(
            this.mirrorPoint.x, this.mirrorPoint.y, 0,
            this.mirrorPoint.x, this.mirrorPoint.y, 10
        );
        gradient.addColorStop(0, '#00f2fe');
        gradient.addColorStop(1, '#4facfe');
        this.ctx.fillStyle = gradient;
        this.ctx.fill();
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw crosshair
        this.ctx.beginPath();
        this.ctx.moveTo(this.mirrorPoint.x - 15, this.mirrorPoint.y);
        this.ctx.lineTo(this.mirrorPoint.x + 15, this.mirrorPoint.y);
        this.ctx.moveTo(this.mirrorPoint.x, this.mirrorPoint.y - 15);
        this.ctx.lineTo(this.mirrorPoint.x, this.mirrorPoint.y + 15);
        this.ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }
}
