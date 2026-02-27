import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

// ─── Math Helpers ────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b > 0) { [a, b] = [b, a % b]; }
    return a;
}

function simplify(n: number, d: number): { n: number; d: number } {
    const g = gcd(n, d);
    return { n: n / g, d: d / g };
}

/**
 * Format a decimal using long division, producing an exact representation.
 * Returns e.g. "0.5", "0.3333..." for 1/3, "0.142857..." for 1/7
 */
function fractionToDecimalString(n: number, d: number): string {
    const { n: sn, d: sd } = simplify(n, d);
    const intPart = Math.floor(sn / sd);
    let remainder = sn % sd;

    if (remainder === 0) return `${intPart}`;

    let decimalDigits = '';
    const remainderMap = new Map<number, number>();

    while (remainder !== 0) {
        if (remainderMap.has(remainder)) {
            // Repeating starts here
            const repeatStart = remainderMap.get(remainder)!;
            const nonRepeat = decimalDigits.slice(0, repeatStart);
            const repeat = decimalDigits.slice(repeatStart);
            // Show up to 4 repeating digits and add ...
            return `${intPart}.${nonRepeat}${repeat.slice(0, 4)}...`;
        }
        remainderMap.set(remainder, decimalDigits.length);
        remainder *= 10;
        decimalDigits += Math.floor(remainder / sd).toString();
        remainder = remainder % sd;
    }

    return `${intPart}.${decimalDigits}`;
}

/**
 * Check if two fractions are equal (as rationals).
 */
function fractionsEqual(n1: number, d1: number, n2: number, d2: number): boolean {
    return n1 * d2 === n2 * d1;
}

/**
 * Returns true if n/d has a terminating decimal representation.
 * A fraction in lowest terms terminates iff its denominator has only factors of 2 and 5.
 */
function isTerminating(n: number, d: number): boolean {
    let { d: sd } = simplify(n, d);
    while (sd % 2 === 0) sd /= 2;
    while (sd % 5 === 0) sd /= 5;
    return sd === 1;
}

/**
 * Count the decimal places in a terminating decimal string (e.g. "0.45" → 2).
 */
function countDecimalPlaces(decimalStr: string): number {
    const dot = decimalStr.indexOf('.');
    return dot === -1 ? 0 : decimalStr.length - dot - 1;
}

/**
 * Format a distractor decimal rounded to `places` decimal places.
 * Used when the correct answer is a terminating decimal.
 */
function formatDecimalRounded(n: number, d: number, places: number): string {
    const { n: sn, d: sd } = simplify(n, d);
    const value = sn / sd;
    // Use toFixed but strip trailing zeros for clean display
    return parseFloat(value.toFixed(places)).toString();
}

// ─── Types ───────────────────────────────────────────────────────────────────

type DisplayMode = 'fraction-to-decimal' | 'decimal-to-fraction';

interface Fraction {
    n: number;
    d: number;
}

interface Question {
    /** The correct fraction */
    fraction: Fraction;
    /** Pre-computed decimal string for the correct answer */
    decimalStr: string;
    /** All 4 fractions (correct + 3 distractors), shuffled */
    options: Fraction[];
    /** All 4 decimals (correct + 3 distractors), shuffled */
    decimalOptions: string[];
    /** Display mode for this question */
    displayMode: DisplayMode;
    /** Index of the correct option */
    correctOptionIndex: number;
}

/**
 * Denominators whose fractions produce short, recognizable repeating decimals
 * that Swiss school children are expected to know:
 * 3 → 0.333..., 2/3 → 0.666...
 * 6 → 1/6 = 0.1666..., 5/6 = 0.8333...
 * 9 → 1/9 = 0.111..., 2/9 = 0.222... etc.
 * 12 → 1/12 = 0.0833..., 5/12 = 0.4166...
 */
const WELL_KNOWN_REPEATING_DENOMS = new Set([3, 6, 9, 12]);

function isWellKnownRepeating(n: number, d: number): boolean {
    const { d: sd } = simplify(n, d);
    return WELL_KNOWN_REPEATING_DENOMS.has(sd);
}

const POOL = [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 8, 8, 9, 10, 10, 12, 15, 20, 20, 25, 40, 50];

function pickFromPool(): number {
    return POOL[Math.floor(Math.random() * POOL.length)];
}

function shuffleArray<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ─── Question Generator ──────────────────────────────────────────────────────

function generateQuestion(): Question {
    let d: number, n: number;
    let attempts = 0;

    // Retry loop to ensure we get 4 distinct options
    while (true) {
        attempts++;
        if (attempts > 50) {
            // Fallback
            d = 4; n = 1;
        } else {
            d = pickFromPool();
            // Numerator from pool + 1 so it can be ≥ denominator sometimes (improper)
            n = pickFromPool() + 1;
            // Clamp so we don't get huge fractions > 3
            if (n > d * 3) n = Math.ceil(d * 1.5);
            // Ensure n >= 1
            if (n < 1) n = 1;
        }

        // Generate 3 distractors
        const candidates: Fraction[] = [
            { n: n + 1, d },               // numerator +1
            { n: n - 1 > 0 ? n - 1 : n + 2, d },  // numerator -1 (clamped)
            { n, d: d + 1 },               // denominator +1
            { n, d: d - 1 > 1 ? d - 1 : d + 2 }, // denominator -1 (clamped)
            { n: n + 1, d: d + 1 },        // both +1
            { n: n - 1 > 0 ? n - 1 : n + 1, d: d + 1 }, // n-1, d+1
        ];

        // Pick 3 unique distractors (different from correct AND from each other)
        const distractors: Fraction[] = [];
        const unused = shuffleArray(candidates);

        for (const cand of unused) {
            if (cand.n < 1 || cand.d < 2) continue;
            if (fractionsEqual(cand.n, cand.d, n, d)) continue;
            if (distractors.some(x => fractionsEqual(x.n, x.d, cand.n, cand.d))) continue;
            distractors.push(cand);
            if (distractors.length === 3) break;
        }

        if (distractors.length < 3) continue; // retry

        // Simplify ALL fractions before building the question
        const correctFrac = simplify(n, d);
        const simplifiedDistractors = distractors.map(f => simplify(f.n, f.d));

        // Determine decimal display strategy based on whether correct answer terminates
        const correctTerminates = isTerminating(correctFrac.n, correctFrac.d);
        const decimalStr = fractionToDecimalString(correctFrac.n, correctFrac.d);
        const decimalPlaces = correctTerminates ? countDecimalPlaces(decimalStr) : 0;

        const formatOption = (fn: number, fd: number): string => {
            if (correctTerminates) {
                // Exception: well-known repeating decimals (1/3, 2/3, 1/6, 1/9 …) keep their
                // exact form IF they are numerically close to the correct answer (within 0.3),
                // because students are expected to recognise those.
                const correctValue = correctFrac.n / correctFrac.d;
                const optionValue = fn / fd;
                if (isWellKnownRepeating(fn, fd) && Math.abs(correctValue - optionValue) < 0.3) {
                    return fractionToDecimalString(fn, fd);
                }
                // Otherwise round to the same number of decimal places as the correct answer
                return formatDecimalRounded(fn, fd, Math.max(decimalPlaces, 1));
            }
            // Correct is repeating — use exact long-division notation for all options
            return fractionToDecimalString(fn, fd);
        };

        // Build shuffled option arrays (already simplified)
        const allFractions = shuffleArray([correctFrac, ...simplifiedDistractors]);
        const allDecimals = shuffleArray([
            correctTerminates ? decimalStr : decimalStr, // keep as-is
            formatOption(simplifiedDistractors[0].n, simplifiedDistractors[0].d),
            formatOption(simplifiedDistractors[1].n, simplifiedDistractors[1].d),
            formatOption(simplifiedDistractors[2].n, simplifiedDistractors[2].d),
        ]);

        const displayMode: DisplayMode = Math.random() < 0.5 ? 'fraction-to-decimal' : 'decimal-to-fraction';
        const correctOptionIndex = displayMode === 'fraction-to-decimal'
            ? allDecimals.indexOf(decimalStr)
            : allFractions.findIndex(f => f.n === correctFrac.n && f.d === correctFrac.d);

        return {
            fraction: correctFrac,
            decimalStr,
            options: allFractions,
            decimalOptions: allDecimals,
            displayMode,
            correctOptionIndex,
        };
    }
}

// ─── Component ───────────────────────────────────────────────────────────────

const ITEMS_PER_ROUND = 10;

@Component({
    selector: 'app-brueche',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './brueche.component.html',
    styleUrl: './brueche.component.css'
})
export class BruecheComponent {
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService);
    private telemetryService = inject(AppTelemetryService);

    readonly itemsPerRound = ITEMS_PER_ROUND;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    questions = signal<Question[]>([]);
    currentIndex = signal(0);
    answered = signal(false);
    userChoice = signal<number | null>(null);  // index into the current options
    totalCorrect = signal(0);
    totalWrong = signal(0);

    // AI session support
    isSessionMode = false;
    isPlanMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;
    planTaskIds: number[] | null = null;

    progress = computed(() => (this.currentIndex() / this.itemsPerRound) * 100);
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentQuestion = computed(() => this.questions()[this.currentIndex()]);

    constructor() {
        const state = window.history.state as any;
        if (state && state.learningContent && (state.sessionId || state.fromPlan)) {
            this.isSessionMode = true;
            this.isPlanMode = !!state.fromPlan || !!state.planId;
            this.sessionTaskId = state.taskId || state.id || null;
            this.sessionTaskIds = state.taskIds || null;
            this.planTaskIds = state.planTaskIds || null;
        }
        const sessionTask = this.apiService.getSessionTask('brueche');
        if (sessionTask) {
            this.isSessionMode = true;
            this.sessionTaskId = sessionTask.id;
        }
    }

    startQuiz(): void {
        const qs: Question[] = [];
        for (let i = 0; i < ITEMS_PER_ROUND; i++) {
            qs.push(generateQuestion());
        }
        this.questions.set(qs);
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.answered.set(false);
        this.userChoice.set(null);
        this.screen.set('quiz');
        this.cdr.markForCheck();
    }

    selectOption(index: number): void {
        if (this.answered()) return;
        this.userChoice.set(index);
        const q = this.currentQuestion();
        const isCorrect = index === q.correctOptionIndex;
        if (isCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);
        }
        this.answered.set(true);
        // Telemetry: since this is algorithmic, we don't have a content_id.
        // We track overall session.
    }

    getOptionClass(index: number): string {
        if (!this.answered()) return '';
        const q = this.currentQuestion();
        const isSelected = index === this.userChoice();
        const isCorrect = index === q.correctOptionIndex;
        if (isCorrect) return 'correct';
        if (isSelected && !isCorrect) return 'incorrect';
        return 'missed';
    }

    isCorrectAnswer(): boolean {
        const q = this.currentQuestion();
        return this.userChoice() === q.correctOptionIndex;
    }

    /** Format a fraction for display: simplified n/d */
    formatFraction(f: { n: number; d: number }): string {
        const { n, d } = simplify(f.n, f.d);
        return `${n}/${d}`;
    }

    nextItem(): void {
        if (this.currentIndex() >= this.itemsPerRound - 1) {
            if (this.isSessionMode) {
                if (this.isPlanMode && this.planTaskIds && this.planTaskIds.length > 0) {
                    this.apiService.completePlanTask(this.planTaskIds);
                } else if (this.sessionTaskIds && this.sessionTaskIds.length > 0) {
                    this.apiService.completeTask(this.sessionTaskIds);
                } else if (this.sessionTaskId) {
                    this.apiService.completeTask(this.sessionTaskId);
                }
            }
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentIndex.update(i => i + 1);
            this.answered.set(false);
            this.userChoice.set(null);
            this.cdr.markForCheck();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
