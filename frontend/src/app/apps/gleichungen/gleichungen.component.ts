import { Component, signal, computed } from '@angular/core';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { FeedbackPanelComponent } from '../../shared/components/feedback-panel/feedback-panel.component';
import { ModeSelectorComponent } from '../../shared/components/mode-btn';
import { launchConfetti } from '../../shared/confetti';

// ─── Types ───────────────────────────────────────────────────────────────────

type QuizMode = 'luecke' | 'loesen' | 'schritte';
type Difficulty = 'easy' | 'medium';

interface EquationParts {
    /** e.g. "2x + 5 = 13" */
    display: string;
    /** The correct answer(s) */
    answers: number[];
    /** Human-readable solution hint */
    solutionHint: string;
    /** Whether this is a quadratic equation (2 solutions possible) */
    isQuadratic?: boolean;
}

interface StepQuestion {
    equation: string;
    correctSteps: string[];
    shuffledSteps: string[];
    userOrder: string[];
    answers: number[];
    isQuadratic?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function formatCoeff(a: number, withX: string = 'x'): string {
    if (a === 1) return withX;
    if (a === -1) return `-${withX}`;
    return `${a}${withX}`;
}

function formatTerm(value: number, leading: boolean = false): string {
    if (value === 0) return '';
    if (leading) return `${value}`;
    return value > 0 ? ` + ${value}` : ` - ${Math.abs(value)}`;
}

// ─── EINFACH: Lineare Gleichungen ────────────────────────────────────────────
// Covers: ax+b=c, ax+b=cx+d, a(bx+c)=d — all linear

function generateLinearSimple(): EquationParts {
    // ax + b = c
    const x = randInt(-10, 10);
    const a = randInt(1, 5) * (Math.random() < 0.3 ? -1 : 1);
    const b = randInt(-15, 15);
    const c = a * x + b;

    return {
        display: `${formatCoeff(a)} ${b >= 0 ? '+' : '-'} ${Math.abs(b)} = ${c}`,
        answers: [x],
        solutionHint: `x = ${x}`
    };
}

function generateLinearBothSides(): EquationParts {
    // ax + b = cx + d
    const x = randInt(-8, 8);
    let a = randInt(1, 6) * (Math.random() < 0.3 ? -1 : 1);
    let c = randInt(1, 6) * (Math.random() < 0.3 ? -1 : 1);
    while (a === c) c = randInt(1, 6);
    const b = randInt(-12, 12);
    const d = a * x + b - c * x;

    return {
        display: `${formatCoeff(a)} ${b >= 0 ? '+' : '-'} ${Math.abs(b)} = ${formatCoeff(c)} ${d >= 0 ? '+' : '-'} ${Math.abs(d)}`,
        answers: [x],
        solutionHint: `x = ${x}`
    };
}

function generateLinearBrackets(): EquationParts {
    // a(bx + c) = result
    const x = randInt(-6, 6);
    const a = randInt(2, 5) * (Math.random() < 0.3 ? -1 : 1);
    const b = randInt(1, 4) * (Math.random() < 0.3 ? -1 : 1);
    const c = randInt(-8, 8);
    const result = a * (b * x + c);

    const inner = `${formatCoeff(b)}${formatTerm(c)}`;

    return {
        display: `${a}(${inner}) = ${result}`,
        answers: [x],
        solutionHint: `x = ${x}`
    };
}

function generateLinearEquation(): EquationParts {
    const r = Math.random();
    if (r < 0.4) return generateLinearSimple();
    if (r < 0.7) return generateLinearBothSides();
    return generateLinearBrackets();
}

// ─── MITTEL: Quadratische Gleichungen ────────────────────────────────────────
// Generate from roots to ensure integer solutions

function generateQuadratic(): EquationParts {
    // Pick two integer roots
    const x1 = randInt(-8, 8);
    const x2 = randInt(-8, 8);

    // (x - x1)(x - x2) = x² - (x1+x2)x + x1*x2
    // which is: x² + bx + c = 0  where b = -(x1+x2), c = x1*x2
    const b = -(x1 + x2);
    const c = x1 * x2;

    // Sometimes multiply by a coefficient for variety: ax² + ab·x + ac = 0
    const useCoeff = Math.random() < 0.3;
    const a = useCoeff ? randInt(2, 3) : 1;

    const aCoeff = a === 1 ? '' : `${a}`;
    const bCoeff = a * b;
    const cCoeff = a * c;

    let display = `${aCoeff}x²`;
    if (bCoeff !== 0) {
        display += bCoeff > 0 ? ` + ${bCoeff === 1 ? '' : bCoeff}x` : ` - ${Math.abs(bCoeff) === 1 ? '' : Math.abs(bCoeff)}x`;
    }
    if (cCoeff !== 0) {
        display += cCoeff > 0 ? ` + ${cCoeff}` : ` - ${Math.abs(cCoeff)}`;
    }
    display += ' = 0';

    // Deduplicate and sort answers
    const answers = x1 === x2 ? [x1] : [Math.min(x1, x2), Math.max(x1, x2)];

    const hintParts = answers.length === 1
        ? `x = ${answers[0]} (Doppellösung)`
        : `x₁ = ${answers[0]}, x₂ = ${answers[1]}`;

    return {
        display,
        answers,
        solutionHint: hintParts,
        isQuadratic: true
    };
}

function generateQuadraticFactored(): EquationParts {
    // Present as product: (x + a)(x + b) = 0
    const x1 = randInt(-7, 7);
    const x2 = randInt(-7, 7);

    const a = -x1;
    const b = -x2;

    const leftPart = a >= 0 ? `(x + ${a})` : `(x - ${Math.abs(a)})`;
    const rightPart = b >= 0 ? `(x + ${b})` : `(x - ${Math.abs(b)})`;

    const answers = x1 === x2 ? [x1] : [Math.min(x1, x2), Math.max(x1, x2)];
    const hintParts = answers.length === 1
        ? `x = ${answers[0]} (Doppellösung)`
        : `x₁ = ${answers[0]}, x₂ = ${answers[1]}`;

    return {
        display: `${leftPart}${rightPart} = 0`,
        answers,
        solutionHint: hintParts,
        isQuadratic: true
    };
}

function generateQuadraticPureSq(): EquationParts {
    // x² = c  or  ax² = c
    const x = randInt(1, 10);
    const a = Math.random() < 0.5 ? 1 : randInt(2, 4);
    const c = a * x * x;

    const display = a === 1 ? `x² = ${c}` : `${a}x² = ${c}`;
    // Pure square has ±x as solutions (unless x=0)
    const answers = x === 0 ? [0] : [-x, x];

    return {
        display,
        answers,
        solutionHint: x === 0 ? 'x = 0' : `x₁ = -${x}, x₂ = ${x}`,
        isQuadratic: true
    };
}

function generateQuadraticEquation(): EquationParts {
    const r = Math.random();
    if (r < 0.35) return generateQuadratic();
    if (r < 0.65) return generateQuadraticFactored();
    return generateQuadraticPureSq();
}

// ─── Dispatchers ─────────────────────────────────────────────────────────────

function generateEquation(difficulty: Difficulty): EquationParts {
    return difficulty === 'easy' ? generateLinearEquation() : generateQuadraticEquation();
}

function generateGapEquation(difficulty: Difficulty): EquationParts {
    if (difficulty === 'medium') {
        // Quadratic gap: x² + ?x + c = 0 with known roots
        const x1 = randInt(-6, 6);
        const x2 = randInt(-6, 6);
        const b = -(x1 + x2); // this is the gap
        const c = x1 * x2;
        return {
            display: `x² + ?·x${formatTerm(c)} = 0`,
            answers: [b],
            solutionHint: `? = ${b} (Nullstellen: ${x1}, ${x2})`,
            isQuadratic: true
        };
    }

    // Linear gap
    const x = randInt(-8, 8);
    const a = randInt(1, 5);
    const gap = randInt(-12, 12);
    const c = a * x + gap;

    if (Math.random() < 0.5) {
        return {
            display: `${formatCoeff(a)}${formatTerm(gap, true).replace(gap.toString(), '?')} = ${c}`,
            answers: [gap],
            solutionHint: `? = ${gap} (für x = ${x})`
        };
    } else {
        const coeff = randInt(2, 6);
        const b = randInt(-10, 10);
        const result = coeff * x + b;
        return {
            display: `?·x${formatTerm(b)} = ${result}`,
            answers: [coeff],
            solutionHint: `? = ${coeff} (für x = ${x})`
        };
    }
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function generateLinearSteps(): StepQuestion {
    const x = randInt(-6, 6);
    const a = randInt(2, 5);
    const b = randInt(1, 12) * (Math.random() < 0.4 ? -1 : 1);
    const c = a * x + b;

    const equation = `${formatCoeff(a)} ${b >= 0 ? '+' : '-'} ${Math.abs(b)} = ${c}`;

    const steps = [
        `${formatCoeff(a)} = ${c} ${b >= 0 ? '-' : '+'} ${Math.abs(b)}`,
        `${formatCoeff(a)} = ${c - b}`,
    ];
    if (a !== 1) {
        steps.push(`x = ${c - b} ÷ ${a}`);
    }
    steps.push(`x = ${x}`);

    return {
        equation,
        correctSteps: steps,
        shuffledSteps: shuffle(steps),
        userOrder: [],
        answers: [x]
    };
}

function generateQuadraticSteps(): StepQuestion {
    const x1 = randInt(-6, 6);
    const x2 = randInt(-6, 6);
    const b = -(x1 + x2);
    const c = x1 * x2;

    const equation = `x²${formatTerm(b)}x${formatTerm(c)} = 0`;

    const a1 = -x1;
    const a2 = -x2;
    const leftPart = a1 >= 0 ? `(x + ${a1})` : `(x - ${Math.abs(a1)})`;
    const rightPart = a2 >= 0 ? `(x + ${a2})` : `(x - ${Math.abs(a2)})`;

    const answers = x1 === x2 ? [x1] : [Math.min(x1, x2), Math.max(x1, x2)];
    const solutionLine = answers.length === 1
        ? `x = ${answers[0]}`
        : `x₁ = ${answers[0]}, x₂ = ${answers[1]}`;

    const steps = [
        `Faktorisieren: ${leftPart}${rightPart} = 0`,
        `Nullprodukt: ${leftPart} = 0 oder ${rightPart} = 0`,
        solutionLine
    ];

    return {
        equation,
        correctSteps: steps,
        shuffledSteps: shuffle(steps),
        userOrder: [],
        answers,
        isQuadratic: true
    };
}

function generateStepsQuestion(difficulty: Difficulty): StepQuestion {
    return difficulty === 'easy' ? generateLinearSteps() : generateQuadraticSteps();
}

// ─── Component ───────────────────────────────────────────────────────────────

const QUESTIONS_PER_ROUND = 10;

@Component({
    selector: 'app-gleichungen',
    standalone: true,
    imports: [LearningAppLayoutComponent, FeedbackPanelComponent, ModeSelectorComponent],
    templateUrl: './gleichungen.component.html',
    styleUrl: './gleichungen.component.css'
})
export class GleichungenComponent {
    readonly QUESTIONS_PER_ROUND = QUESTIONS_PER_ROUND;

    readonly modes: { id: string; icon: string; label: string; description: string }[] = [
        { id: 'loesen', label: 'Lösen', icon: '🧩', description: 'Löse die Gleichung nach x auf.' },
        { id: 'luecke', label: 'Lücke füllen', icon: '❓', description: 'Finde den fehlenden Wert in der Gleichung.' },
        { id: 'schritte', label: 'Schritte ordnen', icon: '📋', description: 'Bringe die Lösungsschritte in die richtige Reihenfolge.' }
    ];

    readonly difficulties: { id: Difficulty; label: string; description: string }[] = [
        { id: 'easy', label: 'Linear', description: 'ax + b = c, Klammern, x auf beiden Seiten' },
        { id: 'medium', label: 'Quadratisch', description: 'x² + bx + c = 0, Faktorisierung' }
    ];

    mode = signal<string>('loesen');
    difficulty = signal<Difficulty>('easy');
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');

    // Quiz state
    currentIndex = signal(0);
    totalCorrect = signal(0);
    totalWrong = signal(0);
    answered = signal(false);
    isCorrectAnswer = signal(false);
    feedbackMsg = signal('');

    // Solve mode
    currentEquation = signal<EquationParts | null>(null);
    userInput = signal('');

    // Steps mode
    currentSteps = signal<StepQuestion | null>(null);

    // Options for solve/gap mode (multiple choice)
    options = signal<number[]>([]);
    selectedOption = signal<number | null>(null);

    progress = computed(() => (this.currentIndex() / QUESTIONS_PER_ROUND) * 100);
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    setDifficulty(d: Difficulty): void {
        this.difficulty.set(d);
    }

    startQuiz(): void {
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.answered.set(false);
        this.screen.set('quiz');
        this.generateQuestion();
    }

    private generateQuestion(): void {
        this.answered.set(false);
        this.userInput.set('');
        this.selectedOption.set(null);
        this.isCorrectAnswer.set(false);
        this.feedbackMsg.set('');

        const m = this.mode();
        const d = this.difficulty();

        if (m === 'schritte') {
            this.currentSteps.set(generateStepsQuestion(d));
            this.currentEquation.set(null);
        } else if (m === 'luecke') {
            const eq = generateGapEquation(d);
            this.currentEquation.set(eq);
            this.currentSteps.set(null);
            this.generateOptions(eq.answers[0]);
        } else {
            const eq = generateEquation(d);
            this.currentEquation.set(eq);
            this.currentSteps.set(null);
            // For quadratic with 2 solutions, show all solutions as options
            if (eq.isQuadratic && eq.answers.length === 2) {
                this.generateQuadraticOptions(eq.answers);
            } else {
                this.generateOptions(eq.answers[0]);
            }
        }
    }

    private generateOptions(correctAnswer: number): void {
        const distractors = new Set<number>();
        distractors.add(correctAnswer);

        while (distractors.size < 4) {
            const offset = randInt(1, 5) * (Math.random() < 0.5 ? -1 : 1);
            distractors.add(correctAnswer + offset);
        }

        this.options.set(shuffle([...distractors]));
    }

    /** For quadratic equations: show answer-pairs as options */
    private generateQuadraticOptions(correctAnswers: number[]): void {
        // We show the first answer for selection (simplification)
        // The user needs to pick x₁ (the smaller one)
        const target = correctAnswers[0]; // already sorted: min first
        const distractors = new Set<number>();
        distractors.add(target);

        while (distractors.size < 4) {
            const offset = randInt(1, 4) * (Math.random() < 0.5 ? -1 : 1);
            distractors.add(target + offset);
        }

        this.options.set(shuffle([...distractors]));
    }

    selectOption(value: number): void {
        if (this.answered()) return;

        this.selectedOption.set(value);
        const eq = this.currentEquation();
        if (!eq) return;

        const correct = eq.answers.includes(value);
        this.isCorrectAnswer.set(correct);
        this.feedbackMsg.set(correct ? 'Richtig!' : `Falsch! ${eq.solutionHint}`);
        this.answered.set(true);

        if (correct) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);
        }
    }

    // Steps mode
    selectStep(step: string): void {
        const sq = this.currentSteps();
        if (!sq || this.answered()) return;
        if (sq.userOrder.includes(step)) return;

        sq.userOrder.push(step);
        this.currentSteps.set({ ...sq });

        if (sq.userOrder.length === sq.correctSteps.length) {
            const correct = sq.userOrder.every((s, i) => s === sq.correctSteps[i]);
            this.isCorrectAnswer.set(correct);
            const hint = sq.answers.length === 1
                ? `x = ${sq.answers[0]}`
                : `x₁ = ${sq.answers[0]}, x₂ = ${sq.answers[1]}`;
            this.feedbackMsg.set(correct ? 'Richtig!' : `Falsch! ${hint}`);
            this.answered.set(true);

            if (correct) {
                this.totalCorrect.update(c => c + 1);
            } else {
                this.totalWrong.update(c => c + 1);
            }
        }
    }

    removeStep(index: number): void {
        const sq = this.currentSteps();
        if (!sq || this.answered()) return;
        sq.userOrder.splice(index);
        this.currentSteps.set({ ...sq });
    }

    isStepUsed(step: string): boolean {
        return this.currentSteps()?.userOrder.includes(step) ?? false;
    }

    isStepCorrect(index: number): boolean {
        const sq = this.currentSteps();
        if (!sq || !this.answered()) return false;
        return sq.userOrder[index] === sq.correctSteps[index];
    }

    nextQuestion(): void {
        if (this.currentIndex() >= QUESTIONS_PER_ROUND - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentIndex.update(i => i + 1);
            this.generateQuestion();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    getOptionClass(value: number): string {
        if (!this.answered()) {
            return this.selectedOption() === value ? 'selected' : '';
        }
        const eq = this.currentEquation();
        if (!eq) return '';
        if (eq.answers.includes(value)) return 'correct';
        if (value === this.selectedOption()) return 'incorrect';
        return 'missed';
    }

    getDifficultyLabel(): string {
        const eq = this.currentEquation();
        const sq = this.currentSteps();
        if (eq?.isQuadratic || sq?.isQuadratic) return 'Quadratisch';
        return 'Linear';
    }
}
