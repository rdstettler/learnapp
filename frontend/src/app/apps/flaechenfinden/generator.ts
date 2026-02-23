import { Point, Line, Circle, Condition, ConditionType, GeometryUtils } from './geometry';

export interface PuzzleDef {
    points: Point[];
    lines: Line[];
    circles: Circle[];
    conditions: Condition[];
}

export class PuzzleGenerator {
    private static randomInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private static pickN<T>(array: T[], n: number): T[] {
        const shuffled = array.slice().sort(() => 0.5 - Math.random());
        return shuffled.slice(0, n);
    }

    static generate(width: number, height: number): PuzzleDef {
        // Safe boundaries so elements don't spawn exactly on the edge
        const margin = 100;
        const safeW = width - 2 * margin;
        const safeH = height - 2 * margin;

        // Generate A and B
        const A: Point = { x: margin + this.randomInt(0, safeW), y: margin + this.randomInt(0, safeH), label: 'A' };
        const B: Point = { x: margin + this.randomInt(0, safeW), y: margin + this.randomInt(0, safeH), label: 'B' };

        // Generate lines (g and h). Make sure they are not perfectly parallel nor perfectly vertical/horizontal to be interesting
        const g: Line = {
            start: { x: margin, y: margin + this.randomInt(0, safeH) },
            end: { x: width - margin, y: margin + this.randomInt(0, safeH) },
            label: 'g'
        };
        const h: Line = {
            start: { x: margin + this.randomInt(0, safeW), y: margin },
            end: { x: margin + this.randomInt(0, safeW), y: height - margin },
            label: 'h'
        };

        // Generate M and circle
        const M: Point = { x: margin + this.randomInt(0, safeW), y: margin + this.randomInt(0, safeH), label: 'M' };
        const radiusCm = this.randomInt(1, 4);
        const r: Circle = { center: M, radius: GeometryUtils.cmToPx(radiusCm), label: 'r' };

        // We have: A, B, g, h, r
        const possibleConditions = [
            { type: ConditionType.CLOSER_TO_A_THAN_B, refPoints: [A, B] as [Point, Point] },
            { type: ConditionType.CLOSER_TO_A_THAN_B, refPoints: [B, A] as [Point, Point] },

            { type: ConditionType.MIN_DISTANCE_FROM_LINE, refLine: g, distanceCm: this.randomInt(1, 3) },
            { type: ConditionType.MAX_DISTANCE_FROM_LINE, refLine: g, distanceCm: this.randomInt(1, 3) },
            { type: ConditionType.MIN_DISTANCE_FROM_LINE, refLine: h, distanceCm: this.randomInt(1, 3) },
            { type: ConditionType.MAX_DISTANCE_FROM_LINE, refLine: h, distanceCm: this.randomInt(1, 3) },

            { type: ConditionType.CLOSER_TO_LINE_G_THAN_H, refLines: [g, h] as [Line, Line] },
            { type: ConditionType.CLOSER_TO_LINE_G_THAN_H, refLines: [h, g] as [Line, Line] },

            { type: ConditionType.MIN_DISTANCE_FROM_CIRCLE, refCircle: r, distanceCm: this.randomInt(1, 2) },
            { type: ConditionType.MAX_DISTANCE_FROM_CIRCLE, refCircle: r, distanceCm: this.randomInt(1, 2) },
        ];

        // Pick 2-4 rules
        const numRules = this.randomInt(2, 4);

        let conditions = [];
        // Prevent contradictory or highly unlikely combinations by just picking randomly with some conflict resolution:
        // Ex: if we pick "closer to A than B", we shouldn't pick "closer to B than A".
        const pool = [...possibleConditions];
        for (let i = 0; i < numRules && pool.length > 0; i++) {
            const idx = this.randomInt(0, pool.length - 1);
            const cond = pool.splice(idx, 1)[0] as Condition;

            cond.distancePx = cond.distanceCm ? GeometryUtils.cmToPx(cond.distanceCm) : undefined;
            conditions.push(cond);

            // Filter opposites
            if (cond.type === ConditionType.CLOSER_TO_A_THAN_B) {
                const inverseIndex = pool.findIndex(c => c.type === ConditionType.CLOSER_TO_A_THAN_B && c.refPoints![0].label !== cond.refPoints![0].label);
                if (inverseIndex > -1) pool.splice(inverseIndex, 1);
            }
            if (cond.type === ConditionType.MAX_DISTANCE_FROM_LINE || cond.type === ConditionType.MIN_DISTANCE_FROM_LINE) {
                // To avoid "min 2cm from g" AND "max 1cm from g"
                const lineLabel = cond.refLine!.label;
                for (let j = pool.length - 1; j >= 0; j--) {
                    if ((pool[j].type === ConditionType.MAX_DISTANCE_FROM_LINE || pool[j].type === ConditionType.MIN_DISTANCE_FROM_LINE) && pool[j].refLine!.label === lineLabel) {
                        pool.splice(j, 1);
                    }
                }
            }
            if (cond.type === ConditionType.CLOSER_TO_LINE_G_THAN_H) {
                const inverseIndex = pool.findIndex(c => c.type === ConditionType.CLOSER_TO_LINE_G_THAN_H && c.refLines![0].label !== cond.refLines![0].label);
                if (inverseIndex > -1) pool.splice(inverseIndex, 1);
            }
            if (cond.type === ConditionType.MAX_DISTANCE_FROM_CIRCLE || cond.type === ConditionType.MIN_DISTANCE_FROM_CIRCLE) {
                for (let j = pool.length - 1; j >= 0; j--) {
                    if ((pool[j].type === ConditionType.MAX_DISTANCE_FROM_CIRCLE || pool[j].type === ConditionType.MIN_DISTANCE_FROM_CIRCLE)) {
                        pool.splice(j, 1);
                    }
                }
            }
        }

        // It is theoretically possible that these conditions have NO valid solution area on screen. 
        // For a perfectly robust generator, we'd sample 1000 points and ensure at least N points satisfy it.
        // If not, we regenerate.
        let validPoints = 0;
        for (let x = 0; x < width; x += 20) {
            for (let y = 0; y < height; y += 20) {
                let ok = true;
                for (let c of conditions) {
                    if (!GeometryUtils.checkCondition({ x, y }, c)) {
                        ok = false;
                        break;
                    }
                }
                if (ok) validPoints++;
            }
        }

        if (validPoints < 5) {
            // Not enough valid points, just regenerate!
            return this.generate(width, height);
        }

        return {
            points: [A, B],
            lines: [g, h],
            circles: [r],
            conditions: conditions
        };
    }

    static getConditionText(cond: Condition): string {
        switch (cond.type) {
            case ConditionType.CLOSER_TO_A_THAN_B:
                return `Näher zu ${cond.refPoints![0].label} als ${cond.refPoints![1].label}`;
            case ConditionType.CLOSER_TO_LINE_G_THAN_H:
                return `Näher zu ${cond.refLines![0].label} als ${cond.refLines![1].label}`;
            case ConditionType.MAX_DISTANCE_FROM_LINE:
                return `Höchstens ${cond.distanceCm} cm von ${cond.refLine!.label}`;
            case ConditionType.MIN_DISTANCE_FROM_LINE:
                return `Mindestens ${cond.distanceCm} cm von ${cond.refLine!.label}`;
            case ConditionType.MAX_DISTANCE_FROM_CIRCLE:
                return `Höchstens ${cond.distanceCm} cm von ${cond.refCircle!.label}`;
            case ConditionType.MIN_DISTANCE_FROM_CIRCLE:
                return `Mindestens ${cond.distanceCm} cm von ${cond.refCircle!.label}`;
            default:
                return '';
        }
    }
}
