import { Component, signal, ElementRef, viewChild, AfterViewInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { Point, Line, Circle, GeometryUtils, Condition } from './geometry';
import { PuzzleGenerator, PuzzleDef } from './generator';

interface DrawnLine {
    start: Point;
    end: Point;
    type: 'mittelsenkrechte' | 'parallele' | 'winkelhalbierende';
}

interface DrawnCircle {
    center: Point;
    radius: number;
}

@Component({
    selector: 'app-flaechenfinden',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './flaechenfinden.component.html',
    styleUrl: './flaechenfinden.component.css'
})
export class FlaechenfindenComponent implements AfterViewInit {
    private platformId = inject(PLATFORM_ID);

    canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
    private ctx: CanvasRenderingContext2D | null = null;

    currentTool = signal<'mittelsenkrechte' | 'parallele' | 'winkelhalbierende' | 'kreis' | 'fuellen' | null>(null);
    status = signal('Wähle ein Werkzeug, um zu beginnen');

    puzzle = signal<PuzzleDef | null>(null);
    conditionsText = signal<string[]>([]);

    // User drawn elements
    drawnLines: DrawnLine[] = [];
    drawnCircles: DrawnCircle[] = [];

    // Interaction state
    private activePoints: Point[] = [];
    private activeLine: Line | null = null;
    private isDragging = false;
    private dragStart: Point | null = null;
    private currentDragPos: Point | null = null;

    private filledPoints: Point[] = [];
    private isChecked = false;

    private correctPixels = 0;
    private wrongPixels = 0;
    private missingPixels = 0;

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        setTimeout(() => this.initCanvas(), 0);
    }

    private initCanvas(): void {
        const canvasEl = this.canvas()?.nativeElement;
        if (!canvasEl) return;

        canvasEl.width = 900;
        canvasEl.height = 550;

        this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });

        // Generate initial puzzle
        this.generateNewPuzzle();
    }

    generateNewPuzzle(): void {
        const p = PuzzleGenerator.generate(900, 550);
        this.puzzle.set(p);
        this.conditionsText.set(p.conditions.map(c => PuzzleGenerator.getConditionText(c)));
        this.clearAll();
    }

    setTool(tool: 'mittelsenkrechte' | 'parallele' | 'winkelhalbierende' | 'kreis' | 'fuellen'): void {
        this.isChecked = false;
        this.currentTool.set(tool);
        this.activePoints = [];
        this.activeLine = null;
        this.activeLine = null;

        // Detailed instructions based on tool
        switch (tool) {
            case 'mittelsenkrechte':
                this.status.set('Markiere zwei Punkte, um die Mittelsenkrechte zu zeichnen.');
                break;
            case 'parallele':
                this.status.set('Markiere eine Linie (g oder h) und ziehe, um die Parallele zu zeichnen.');
                break;
            case 'winkelhalbierende':
                this.status.set('Konstruktion der Winkelhalbierenden (vereinfacht), markiere den Schnittpunkt g und h.');
                break;
            case 'kreis':
                this.status.set('Markiere den Mittelpunkt M und ziehe einen Kreis.');
                break;
            case 'fuellen':
                this.status.set('Klicke in einen Bereich, um ihn zu markieren. Erneutes Klicken entfernt die Markierung.');
                break;
        }

        this.draw();
    }

    clearAll(): void {
        this.isChecked = false;
        this.drawnLines = [];
        this.drawnCircles = [];
        this.activePoints = [];
        this.activeLine = null;
        this.isDragging = false;
        this.filledPoints = [];
        this.status.set('Alles gelöscht');
        this.draw();
    }

    checkSolution(): void {
        const pz = this.puzzle();
        if (!pz) return;

        this.isChecked = true;
        this.draw(); // Forces the pixel-perfect mathematical shader evaluation

        // To generate text feedback, we use the pixel counts collected during the shader phase
        // Thresholds prevent anti-aliasing artifacts on boundaries from flagging as missing/wrong areas
        const hasWrong = this.wrongPixels > 1500;
        const hasMissing = this.missingPixels > 1500;
        const hasCorrect = this.correctPixels > 1500;

        if (!hasWrong && !hasMissing && hasCorrect) {
            this.status.set('Perfekt! Du hast alle richtigen Flächen gefunden.');
            setTimeout(() => this.generateNewPuzzle(), 4000);
        } else if (!hasWrong && hasMissing && hasCorrect) {
            this.status.set('Gut, aber da fehlen noch richtige Flächen! (in Gelb markiert)');
        } else if (hasWrong && !hasMissing && hasCorrect) {
            this.status.set('Fast! Du hast die richtigen Flächen gefunden, aber auch falsche markiert.');
        } else if (hasWrong && hasMissing && hasCorrect) {
            this.status.set('Ein paar sind richtig, aber es fehlen welche und einige sind falsch.');
        } else if (!hasCorrect && hasWrong) {
            this.status.set('Leider sind alle markierten Flächen falsch.');
        } else if (!hasCorrect && !hasWrong) {
            this.status.set('Du musst zuerst Flächen markieren, um die Lösung zu prüfen!');
            this.isChecked = false;
            this.draw();
        } else {
            this.status.set('Fehler bei der Auswertung.');
        }
    }

    private getPosition(event: PointerEvent): Point {
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

    private getSnappablePoints(): Point[] {
        const pz = this.puzzle();
        if (!pz) return [];
        let pts = [...pz.points];
        for (const c of pz.circles) pts.push(c.center);
        return pts;
    }

    private getClosestPoint(p: Point, maxDist: number = 20): Point | null {
        const snappable = this.getSnappablePoints();
        let closest: Point | null = null;
        let minDist = maxDist;
        for (const sp of snappable) {
            const d = GeometryUtils.distance(p, sp);
            if (d < minDist) {
                minDist = d;
                closest = sp;
            }
        }
        return closest;
    }

    private getClosestLine(p: Point, maxDist: number = 20): Line | null {
        const pz = this.puzzle();
        if (!pz) return null;
        let closest: Line | null = null;
        let minDist = maxDist;
        for (const l of pz.lines) {
            const d = GeometryUtils.pointToLineDistance(p, l);
            if (d < minDist) {
                minDist = d;
                closest = l;
            }
        }
        return closest;
    }

    onPointerDown(event: PointerEvent): void {
        if (this.isChecked) {
            this.isChecked = false;
            this.draw(); // revert to editable state
        }

        const pos = this.getPosition(event);
        const tool = this.currentTool();

        if (tool === 'mittelsenkrechte') {
            const snapped = this.getClosestPoint(pos);
            if (snapped) {
                if (this.activePoints.length === 1 && this.activePoints[0].x === snapped.x && this.activePoints[0].y === snapped.y) {
                    this.status.set('Bitte wähle einen ZWEITEN, anderen Punkt aus.');
                    return;
                }
                this.activePoints.push(snapped);
                if (this.activePoints.length === 2) {
                    // Draw Mittelsenkrechte
                    const p1 = this.activePoints[0];
                    const p2 = this.activePoints[1];
                    const mx = (p1.x + p2.x) / 2;
                    const my = (p1.y + p2.y) / 2;

                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    const nx = -dy / len;
                    const ny = dx / len;

                    const factor = 2000;

                    this.drawnLines.push({
                        start: { x: mx - nx * factor, y: my - ny * factor },
                        end: { x: mx + nx * factor, y: my + ny * factor },
                        type: 'mittelsenkrechte'
                    });
                    this.filledPoints = [];
                    this.status.set('Mittelsenkrechte gezeichnet.');
                    this.activePoints = [];
                } else {
                    this.status.set(`Punkt ${snapped.label} markiert. Klicke auf den zweiten Punkt.`);
                }
            }
        } else if (tool === 'parallele') {
            const snappedL = this.getClosestLine(pos);
            if (snappedL) {
                this.activeLine = snappedL;
                this.isDragging = true;
                this.dragStart = pos;
                this.status.set(`Parallele zu ${snappedL.label} wird gezeichnet... Ziehe, um den Abstand zu bestimmen.`);
            }
        } else if (tool === 'winkelhalbierende') {
            // Find intersection of g and h, and generate the two bisector lines
            const pz = this.puzzle();
            if (pz && pz.lines.length >= 2) {
                const l1 = pz.lines[0];
                const l2 = pz.lines[1];
                const intersection = GeometryUtils.getIntersection(l1, l2);

                if (intersection) {
                    // Get normalized direction vectors for both lines
                    const d1 = GeometryUtils.getLineDirectionVector(l1);
                    const d2 = GeometryUtils.getLineDirectionVector(l2);

                    // The two bisecting vectors are the sum and difference of the normalized direction vectors
                    const b1x = d1.x + d2.x;
                    const b1y = d1.y + d2.y;

                    const b2x = d1.x - d2.x;
                    const b2y = d1.y - d2.y;

                    // Normalize bisector vectors
                    const lenB1 = Math.sqrt(b1x * b1x + b1y * b1y);
                    const nx1 = b1x / lenB1;
                    const ny1 = b1y / lenB1;

                    const lenB2 = Math.sqrt(b2x * b2x + b2y * b2y);
                    const nx2 = b2x / lenB2;
                    const ny2 = b2y / lenB2;

                    const factor = 2000;

                    this.drawnLines.push({
                        start: { x: intersection.x - nx1 * factor, y: intersection.y - ny1 * factor },
                        end: { x: intersection.x + nx1 * factor, y: intersection.y + ny1 * factor },
                        type: 'winkelhalbierende'
                    });

                    this.drawnLines.push({
                        start: { x: intersection.x - nx2 * factor, y: intersection.y - ny2 * factor },
                        end: { x: intersection.x + nx2 * factor, y: intersection.y + ny2 * factor },
                        type: 'winkelhalbierende'
                    });

                    this.filledPoints = [];
                    this.status.set('Beide Winkelhalbierenden zwischen g und h gezeichnet.');
                } else {
                    this.status.set('Fehler: Die Linien g und h sind parallel, es gibt keinen Schnittpunkt.');
                }
            }
        } else if (tool === 'kreis') {
            const snapped = this.getClosestPoint(pos);
            if (snapped) {
                this.activePoints = [snapped];
                this.isDragging = true;
                this.dragStart = pos;
                this.currentDragPos = pos;
                this.status.set(`Kreis um ${snapped.label} wird gezeichnet... Ziehe, um den Radius zu bestimmen.`);
            }
        } else if (tool === 'fuellen') {
            // Because of alpha blending and anti-aliasing, the exact RGB values are shifted.
            // Our target fill is rgba(74, 222, 128, 180/255) on white background.
            // The resulting color is roughly RGB(~127, ~231, ~165).
            // So we just check if it's very green: G channel is significantly higher than R channel.
            const pixel = this.ctx?.getImageData(pos.x, pos.y, 1, 1).data;
            if (pixel && pixel[1] > pixel[0] + 50 && pixel[1] > pixel[2] + 20) {
                // Toggling off: finding closest filledPoint to remove it
                let closestIdx = -1;
                let minDist = 99999;
                for (let i = 0; i < this.filledPoints.length; i++) {
                    const d = GeometryUtils.distance(pos, this.filledPoints[i]);
                    if (d < minDist) {
                        minDist = d;
                        closestIdx = i;
                    }
                }
                if (closestIdx !== -1) {
                    this.filledPoints.splice(closestIdx, 1);
                }
            } else {
                this.filledPoints.push(pos);
            }
            this.status.set('Bereich markiert (oder Markierung entfernt). Klicke auf "Prüfen".');
        }

        this.draw();
    }

    onPointerMove(event: PointerEvent): void {
        if (!this.isDragging) return;

        const pos = this.getPosition(event);
        this.currentDragPos = pos;

        this.draw();
    }

    onPointerUp(): void {
        if (this.isDragging) {
            const tool = this.currentTool();
            if (tool === 'parallele' && this.activeLine && this.dragStart && this.currentDragPos) {
                // Finalize parallel line
                const dist = GeometryUtils.distance(this.dragStart, this.currentDragPos);
                // Snap to cm steps (40px)
                let snappedDist = Math.round(dist / 40) * 40;
                if (snappedDist < 40) snappedDist = 40; // minimum 1 cm

                // Calculate direction normal
                const dx = this.activeLine.end.x - this.activeLine.start.x;
                const dy = this.activeLine.end.y - this.activeLine.start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const nx = -dy / len;
                const ny = dx / len;

                // Determine side based on drag vector dot product
                const dragDx = this.currentDragPos.x - this.dragStart.x;
                const dragDy = this.currentDragPos.y - this.dragStart.y;
                const dot = dragDx * nx + dragDy * ny;
                const sign = dot > 0 ? 1 : -1;

                const px1 = this.activeLine.start.x + nx * sign * snappedDist;
                const py1 = this.activeLine.start.y + ny * sign * snappedDist;
                const px2 = this.activeLine.end.x + nx * sign * snappedDist;
                const py2 = this.activeLine.end.y + ny * sign * snappedDist;

                this.drawnLines.push({
                    start: { x: px1, y: py1 },
                    end: { x: px2, y: py2 },
                    type: 'parallele'
                });
                this.filledPoints = [];

                this.status.set(`Parallele gezeichnet (Abstand: ${snappedDist / 40}cm).`);
                this.activeLine = null;
            } else if (tool === 'kreis' && this.activePoints.length === 1 && this.currentDragPos) {
                const dist = GeometryUtils.distance(this.activePoints[0], this.currentDragPos);
                let snappedDist = Math.round(dist / 40) * 40;
                if (snappedDist < 40) snappedDist = 40;

                this.drawnCircles.push({
                    center: this.activePoints[0],
                    radius: snappedDist
                });
                this.filledPoints = [];
                this.status.set(`Kreis gezeichnet (Radius: ${snappedDist / 40}cm).`);
                this.activePoints = [];
            }

            this.isDragging = false;
            this.dragStart = null;
            this.currentDragPos = null;
            this.draw();
        }
    }

    private draw(): void {
        if (!this.ctx) return;
        const canvas = this.canvas()?.nativeElement;
        if (!canvas) return;

        this.ctx.clearRect(0, 0, canvas.width, canvas.height);

        const pz = this.puzzle();

        // --- STEP 1: Draw solid boundaries for flood fill ---
        if (pz) {
            for (const c of pz.circles) {
                this.ctx.beginPath();
                this.ctx.arc(c.center.x, c.center.y, c.radius, 0, Math.PI * 2);
                this.ctx.strokeStyle = '#64748b';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
            for (const l of pz.lines) {
                this.drawLine(l, '#334155', false);
            }
        }
        for (const c of this.drawnCircles) {
            this.ctx.beginPath();
            this.ctx.arc(c.center.x, c.center.y, c.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#6366f1';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }
        for (const l of this.drawnLines) {
            this.drawLine(l, '#6366f1', false); // MUST be solid for flood fill boundary
        }

        // --- STEP 2: Execute visual flood fill of user clicks ---
        for (const pt of this.filledPoints) {
            this.floodFill(this.ctx, pt.x, pt.y, 74, 222, 128, 180);
        }

        // --- STEP 3: Handle mathematical evaluation shader on pixels ---
        const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        this.correctPixels = 0;
        this.wrongPixels = 0;
        this.missingPixels = 0;

        let point = { x: 0, y: 0 };
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const idx = (y * canvas.width + x) * 4;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

                // Track if user colored this pixel (our base pale green flood fill)
                const isUserMarked = (Math.abs(r - 74) < 5 && Math.abs(g - 222) < 5 && Math.abs(b - 128) < 5 && a > 50);

                if (this.isChecked && pz) {
                    point.x = x;
                    point.y = y;

                    // Filter out drawing lines from being evaluated colored
                    if (!isUserMarked && a > 150 && (Math.abs(r - 51) < 10 || Math.abs(r - 100) < 10 || Math.abs(r - 99) < 10)) {
                        continue; // Let the line exist
                    }

                    let isValid = true;
                    for (const cond of pz.conditions) {
                        if (!GeometryUtils.checkCondition(point, cond)) {
                            isValid = false;
                            break;
                        }
                    }

                    if (isUserMarked && isValid) {
                        data[idx] = 21; data[idx + 1] = 128; data[idx + 2] = 61; data[idx + 3] = 200; // Dark Green
                        this.correctPixels++;
                    } else if (isUserMarked && !isValid) {
                        data[idx] = 220; data[idx + 1] = 38; data[idx + 2] = 38; data[idx + 3] = 200; // Red
                        this.wrongPixels++;
                    } else if (!isUserMarked && isValid) {
                        data[idx] = 234; data[idx + 1] = 179; data[idx + 2] = 8; data[idx + 3] = 200; // Yellow
                        this.missingPixels++;
                    } else {
                        // Not marked, and not valid. Leave transparent.
                        if (isUserMarked) data[idx + 3] = 0;
                    }
                } else {
                    // Not checked: just clean up any non-green user flood fill pixels that leaked
                    if (!isUserMarked) {
                        // preserve lines
                        if (a > 150) continue;
                        data[idx + 3] = 0;
                    }
                }
            }
        }
        this.ctx.putImageData(imageData, 0, 0);

        // --- STEP 4: Redraw everything properly (with dashes, labels, colors) ---
        if (pz) {
            for (const c of pz.circles) {
                this.ctx.beginPath();
                this.ctx.arc(c.center.x, c.center.y, c.radius, 0, Math.PI * 2);
                this.ctx.strokeStyle = '#64748b';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
                this.drawPoint(c.center, c.center.label || 'M');
            }
            for (const l of pz.lines) {
                this.drawLine(l, '#334155');
                const mx = (l.start.x + l.end.x) / 2;
                const my = (l.start.y + l.end.y) / 2;
                this.ctx.fillStyle = '#1e293b';
                this.ctx.font = 'bold 16px Arial';
                this.ctx.fillText(l.label || '', mx + 10, my - 10);
            }
            for (const p of pz.points) {
                this.drawPoint(p, p.label || '');
            }
        }

        for (const c of this.drawnCircles) {
            this.ctx.beginPath();
            this.ctx.arc(c.center.x, c.center.y, c.radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        for (const l of this.drawnLines) {
            this.drawLine(l, 'rgba(99, 102, 241, 0.8)', true);
        }

        // Draw active interactions (dragging parallel or radius)
        if (this.isDragging && this.currentDragPos) {
            if (this.currentTool() === 'parallele' && this.activeLine && this.dragStart) {
                const dist = GeometryUtils.distance(this.dragStart, this.currentDragPos);
                let snappedDist = Math.round(dist / 40) * 40;
                if (snappedDist < 40) snappedDist = 40;

                const dx = this.activeLine.end.x - this.activeLine.start.x;
                const dy = this.activeLine.end.y - this.activeLine.start.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const nx = -dy / len;
                const ny = dx / len;
                const dragDx = this.currentDragPos.x - this.dragStart.x;
                const dragDy = this.currentDragPos.y - this.dragStart.y;
                const dot = dragDx * nx + dragDy * ny;
                const sign = dot > 0 ? 1 : -1;

                const px1 = this.activeLine.start.x + nx * sign * snappedDist;
                const py1 = this.activeLine.start.y + ny * sign * snappedDist;
                const px2 = this.activeLine.end.x + nx * sign * snappedDist;
                const py2 = this.activeLine.end.y + ny * sign * snappedDist;

                this.drawLine({ start: { x: px1, y: py1 }, end: { x: px2, y: py2 } }, 'rgba(99, 102, 241, 0.4)', true);
            } else if (this.currentTool() === 'kreis' && this.activePoints.length === 1) {
                const dist = GeometryUtils.distance(this.activePoints[0], this.currentDragPos);
                let snappedDist = Math.round(dist / 40) * 40;
                if (snappedDist < 40) snappedDist = 40;

                this.ctx.beginPath();
                this.ctx.arc(this.activePoints[0].x, this.activePoints[0].y, snappedDist, 0, Math.PI * 2);
                this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
        }

        // Draw active selected points
        for (const p of this.activePoints) {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
            this.ctx.strokeStyle = '#f43f5e';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }
    }

    private drawPoint(p: Point, label: string): void {
        if (!this.ctx) return;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        this.ctx.fillStyle = '#0f172a';
        this.ctx.fill();

        if (label) {
            this.ctx.font = 'bold 16px Arial';
            this.ctx.fillText(label, p.x + 10, p.y - 10);
        }
    }

    private drawLine(l: Line, color: string, dashed = false): void {
        if (!this.ctx) return;
        this.ctx.beginPath();
        // Draw infinite line
        const dx = l.end.x - l.start.x;
        const dy = l.end.y - l.start.y;

        this.ctx.moveTo(l.start.x - dx * 10, l.start.y - dy * 10);
        this.ctx.lineTo(l.end.x + dx * 10, l.end.y + dy * 10);

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        if (dashed) this.ctx.setLineDash([8, 8]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    private floodFill(ctx: CanvasRenderingContext2D, startX: number, startY: number, fillR: number, fillG: number, fillB: number, fillA: number): void {
        const canvas = ctx.canvas;
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        startX = Math.floor(startX);
        startY = Math.floor(startY);
        const startPos = (startY * width + startX) * 4;
        const startR = data[startPos];
        const startG = data[startPos + 1];
        const startB = data[startPos + 2];
        const startAlpha = data[startPos + 3];

        // If the start color is already the fill color, return
        if (Math.abs(startR - fillR) < 5 && Math.abs(startG - fillG) < 5 && Math.abs(startB - fillB) < 5) return;

        const stack: number[] = [startX, startY];
        const visited = new Uint8Array(width * height);

        while (stack.length > 0) {
            const y = stack.pop()!;
            const x = stack.pop()!;
            const idx = y * width + x;

            if (x < 0 || x >= width || y < 0 || y >= height || visited[idx]) continue;
            visited[idx] = 1;

            const pos = idx * 4;
            const r = data[pos];
            const g = data[pos + 1];
            const b = data[pos + 2];
            const a = data[pos + 3];

            // Boundary detection logic
            const colorDist = Math.abs(r - startR) + Math.abs(g - startG) + Math.abs(b - startB) + Math.abs(a - startAlpha);
            if (colorDist > 80) continue; // Boundary

            // Fill pixel
            data[pos] = fillR;
            data[pos + 1] = fillG;
            data[pos + 2] = fillB;
            data[pos + 3] = fillA;

            stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
        }

        ctx.putImageData(imageData, 0, 0);
    }
}
