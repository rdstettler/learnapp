// geometry.ts - Mathematical logic and types for 'Flächen finden'

export interface Point {
    x: number;
    y: number;
    label?: string;
}

export interface Line {
    start: Point;
    end: Point;
    label?: string;
}

export interface Circle {
    center: Point;
    radius: number;
    label?: string;
}

export enum ConditionType {
    CLOSER_TO_A_THAN_B = 'CLOSER_TO_A_THAN_B',
    CLOSER_TO_LINE_G_THAN_H = 'CLOSER_TO_LINE_G_THAN_H',
    MAX_DISTANCE_FROM_LINE = 'MAX_DISTANCE_FROM_LINE',
    MIN_DISTANCE_FROM_LINE = 'MIN_DISTANCE_FROM_LINE',
    MAX_DISTANCE_FROM_CIRCLE = 'MAX_DISTANCE_FROM_CIRCLE',
    MIN_DISTANCE_FROM_CIRCLE = 'MIN_DISTANCE_FROM_CIRCLE'
}

export interface Condition {
    type: ConditionType;
    refPoints?: [Point, Point]; // For A/B
    refLines?: [Line, Line];    // For g/h
    refLine?: Line;             // For single line distance
    refCircle?: Circle;         // For circle distance
    distancePx?: number;        // The translated value of 1..2..3 cm
    distanceCm?: number;        // The raw cm value described
}

export class GeometryUtils {
    static distance(p1: Point, p2: Point): number {
        return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    }

    static pointToLineDistance(point: Point, line: Line): number {
        const x0 = point.x, y0 = point.y;
        const x1 = line.start.x, y1 = line.start.y;
        const x2 = line.end.x, y2 = line.end.y;

        const num = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1);
        const den = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);

        return den === 0 ? GeometryUtils.distance(point, line.start) : num / den;
    }

    static cmToPx(cm: number): number {
        return cm * 40; // Assuming 40px per cm
    }

    static getIntersection(l1: Line, l2: Line): Point | null {
        // Line 1: a1*x + b1*y = c1
        const a1 = l1.end.y - l1.start.y;
        const b1 = l1.start.x - l1.end.x;
        const c1 = a1 * l1.start.x + b1 * l1.start.y;

        // Line 2: a2*x + b2*y = c2
        const a2 = l2.end.y - l2.start.y;
        const b2 = l2.start.x - l2.end.x;
        const c2 = a2 * l2.start.x + b2 * l2.start.y;

        const det = a1 * b2 - a2 * b1;
        if (Math.abs(det) < 0.0001) {
            return null; // Lines are parallel
        }

        const x = (b2 * c1 - b1 * c2) / det;
        const y = (a1 * c2 - a2 * c1) / det;
        return { x, y };
    }

    static getLineDirectionVector(l: Line): { x: number, y: number } {
        const dx = l.end.x - l.start.x;
        const dy = l.end.y - l.start.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        return { x: dx / len, y: dy / len };
    }

    static checkCondition(p: Point, condition: Condition): boolean {
        switch (condition.type) {
            case ConditionType.CLOSER_TO_A_THAN_B:
                if (!condition.refPoints) return false;
                return this.distance(p, condition.refPoints[0]) < this.distance(p, condition.refPoints[1]);
            case ConditionType.CLOSER_TO_LINE_G_THAN_H:
                if (!condition.refLines) return false;
                return this.pointToLineDistance(p, condition.refLines[0]) < this.pointToLineDistance(p, condition.refLines[1]);
            case ConditionType.MAX_DISTANCE_FROM_LINE:
                if (!condition.refLine || condition.distancePx === undefined) return false;
                return this.pointToLineDistance(p, condition.refLine) <= condition.distancePx;
            case ConditionType.MIN_DISTANCE_FROM_LINE:
                if (!condition.refLine || condition.distancePx === undefined) return false;
                return this.pointToLineDistance(p, condition.refLine) >= condition.distancePx;
            case ConditionType.MAX_DISTANCE_FROM_CIRCLE:
                if (!condition.refCircle || condition.distancePx === undefined) return false;
                // Distance to the circle boundary: abs(distance(p, center) - radius)
                const distToC1 = Math.abs(this.distance(p, condition.refCircle.center) - condition.refCircle.radius);
                return distToC1 <= condition.distancePx;
            case ConditionType.MIN_DISTANCE_FROM_CIRCLE:
                if (!condition.refCircle || condition.distancePx === undefined) return false;
                const distToC2 = Math.abs(this.distance(p, condition.refCircle.center) - condition.refCircle.radius);
                return distToC2 >= condition.distancePx;
            default:
                return false;
        }
    }
}
