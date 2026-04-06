import { Component, Input, Output, EventEmitter, HostListener, signal, computed, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ChartVector {
  id?: string;
  start: [number, number];
  end: [number, number];
  color?: string;
  label?: string;
  thickness?: number;
}

export interface ChartPoint {
  id?: string;
  x: number;
  y: number;
  color?: string;
  draggable?: boolean;
  type?: 'cross' | 'circle';
}

export interface ChartFunction {
  id?: string;
  fn?: (x: number) => number;
  path?: string; // Pre-calculated svg path
  color?: string;
  thickness?: number;
}

@Component({
  selector: 'app-math-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './math-chart.html',
  styleUrl: './math-chart.css',
})
export class MathChart implements AfterViewInit {
  @Input() domainX: [number, number] = [-10, 10];
  @Input() domainY: [number, number] = [-10, 10];
  @Input() showGrid: boolean = true;
  @Input() gridStepX: number = 1;
  @Input() gridStepY: number = 1;
  
  @Input() vectors: ChartVector[] = [];
  @Input() points: ChartPoint[] = [];
  
  private _functions: ChartFunction[] = [];
  @Input() set functions(funcs: ChartFunction[]) {
    // pre-calculate paths if a function fn is provided
    this._functions = funcs.map(f => {
      if (f.fn && !f.path) {
        return { ...f, path: this.calculateFunctionPath(f.fn) };
      }
      return f;
    });
  }
  get functions(): ChartFunction[] {
    return this._functions;
  }

  @Input() interactiveMode: 'none' | 'draw-vector' | 'click-point' | 'drag-points' = 'none';
  
  // For 'draw-vector' mode, define if vectors must start at origin or anywhere
  @Input() vectorStartPoint?: [number, number]; 

  @Output() pointClicked = new EventEmitter<{x: number, y: number}>();
  @Output() vectorDrawn = new EventEmitter<{start: [number, number], end: [number, number]}>();
  @Output() pointDragged = new EventEmitter<{id: string, x: number, y: number}>();
  
  @ViewChild('svgElement') svgElement!: ElementRef<SVGSVGElement>;

  // Computed arrays for grid lines
  get gridLinesX() {
    const lines = [];
    for (let x = Math.ceil(this.domainX[0]); x <= Math.floor(this.domainX[1]); x += this.gridStepX) {
      lines.push(x);
    }
    return lines;
  }

  get gridLinesY() {
    const lines = [];
    for (let y = Math.ceil(this.domainY[0]); y <= Math.floor(this.domainY[1]); y += this.gridStepY) {
      lines.push(y);
    }
    return lines;
  }

  get width(): number {
    return this.domainX[1] - this.domainX[0];
  }

  get height(): number {
    return this.domainY[1] - this.domainY[0];
  }

  get viewBox(): string {
    return `${this.domainX[0]} ${this.domainY[0]} ${this.width} ${this.height}`;
  }

  // Precalculates a smooth path for the given polynomial/function matching the viewBox resolution
  calculateFunctionPath(fn: (x: number) => number): string {
    const step = this.width / 200; // 200 segments for smoothness
    let path = '';
    for (let x = this.domainX[0]; x <= this.domainX[1]; x += step) {
      const y = fn(x);
      // Skip if out of bounds (optional: just let it clip via svg)
      if (path === '') {
        path += `M ${x} ${y} `;
      } else {
        path += `L ${x} ${y} `;
      }
    }
    return path;
  }

  // Interactivity State
  private isDragging = false;
  private dragType: 'vector' | 'point' | null = null;
  private draggedPointId: string | null = null;
  activeVectorStart: [number, number] | null = null;
  activeVectorEnd: [number, number] | null = null;
  
  ngAfterViewInit() {}

  // Convert MouseEvent coordinates to mathematical SVG coordinates
  private getMathCoords(ev: MouseEvent | TouchEvent): {x: number, y: number} {
    if (!this.svgElement) return {x: 0, y: 0};
    
    const svg = this.svgElement.nativeElement;
    let pt = svg.createSVGPoint();
    
    if (ev instanceof MouseEvent) {
      pt.x = ev.clientX;
      pt.y = ev.clientY;
    } else if (ev instanceof TouchEvent && ev.touches.length > 0) {
      pt.x = ev.touches[0].clientX;
      pt.y = ev.touches[0].clientY;
    }
    
    // Convert to SVG coordinates
    const ctm = svg.getScreenCTM();
    if (ctm) {
      pt = pt.matrixTransform(ctm.inverse());
    }
    
    // Because we use scale(1, -1), the actual y in the math coordinate system is -pt.y
    return { x: pt.x, y: -pt.y };
  }

  // Snap to integer or nearest grid intersection
  private snapCoords(x: number, y: number): {x: number, y: number} {
    // Snap x
    const snX = Math.round(x / this.gridStepX) * this.gridStepX;
    // Snap y
    const snY = Math.round(y / this.gridStepY) * this.gridStepY;
    
    // check distance to see if we should snap (snap within 0.3 * step size)
    const dX = Math.abs(x - snX);
    const dY = Math.abs(y - snY);
    
    return {
      x: dX < this.gridStepX * 0.35 ? snX : x,
      y: dY < this.gridStepY * 0.35 ? snY : y
    };
  }

  @HostListener('mousedown', ['$event'])
  @HostListener('touchstart', ['$event'])
  onPointerDown(ev: MouseEvent | TouchEvent) {
    if (this.interactiveMode === 'none') return;
    
    ev.preventDefault(); // prevent scrolling
    const rawCoords = this.getMathCoords(ev);
    const snapped = this.snapCoords(rawCoords.x, rawCoords.y);

    if (this.interactiveMode === 'draw-vector') {
      this.isDragging = true;
      this.dragType = 'vector';
      this.activeVectorStart = this.vectorStartPoint ? [...this.vectorStartPoint] : [snapped.x, snapped.y];
      this.activeVectorEnd = [rawCoords.x, rawCoords.y]; // Initially unsnapped to show movement immediately
    } else if (this.interactiveMode === 'click-point') {
      this.pointClicked.emit(snapped); // emit immediately for click points
    }
  }

  @HostListener('window:mousemove', ['$event'])
  @HostListener('window:touchmove', ['$event'])
  onPointerMove(ev: MouseEvent | TouchEvent) {
    if (!this.isDragging) return;
    
    const rawCoords = this.getMathCoords(ev);
    
    if (this.dragType === 'vector') {
       this.activeVectorEnd = [rawCoords.x, rawCoords.y];
    } else if (this.dragType === 'point' && this.draggedPointId) {
       const snapped = this.snapCoords(rawCoords.x, rawCoords.y);
       // emit change
       this.pointDragged.emit({id: this.draggedPointId, x: snapped.x, y: snapped.y});
    }
  }

  @HostListener('window:mouseup', ['$event'])
  @HostListener('window:touchend', ['$event'])
  onPointerUp(ev: MouseEvent | TouchEvent) {
    if (!this.isDragging) return;

    if (this.dragType === 'vector' && this.activeVectorStart && this.activeVectorEnd) {
      // finalize vector snap
      const snapped = this.snapCoords(this.activeVectorEnd[0], this.activeVectorEnd[1]);
      
      // if distance is very small, user just clicked
      const dist = Math.hypot(snapped.x - this.activeVectorStart[0], snapped.y - this.activeVectorStart[1]);
      if (dist > 0) {
        this.vectorDrawn.emit({
          start: this.activeVectorStart,
          end: [snapped.x, snapped.y]
        });
      }
    }
    
    this.isDragging = false;
    this.dragType = null;
    this.activeVectorStart = null;
    this.activeVectorEnd = null;
    this.draggedPointId = null;
  }

  onPointMouseDown(ev: MouseEvent | TouchEvent, point: ChartPoint) {
    if (this.interactiveMode === 'drag-points' && point.draggable) {
      ev.stopPropagation(); // prevent window/svg default mousedown
      ev.preventDefault();
      this.isDragging = true;
      this.dragType = 'point';
      this.draggedPointId = point.id || '';
    }
  }
}
