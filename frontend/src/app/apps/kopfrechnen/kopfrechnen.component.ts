import { Component, signal, computed, Input, OnInit, inject, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface DifficultySettings {
    addMax: number;
    subMax: number;
    mulMax: number;
    divMax: number;
    divDivisorMax: number;
    sqrtMax: number;
    powBaseMax: number;
    powExpMax: number;
}

interface AppConfig {
    addMax?: number;
    divMax?: number;
    divDivisorMax?: number;
    operations?: ('add' | 'sub' | 'mul' | 'div' | 'sqrt' | 'pow')[];
    // Add other config props as needed
}

interface Question {
    operation: 'add' | 'sub' | 'mul' | 'div' | 'sqrt' | 'pow';
    a: number | string;
    b: number | string;
    result: number;
    blankPosition: 0 | 1 | 2;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

@Component({
    selector: 'app-kopfrechnen',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './kopfrechnen.component.html',
    styleUrl: './kopfrechnen.component.css',
    host: {
        '(document:keydown.enter)': 'onEnterKey()'
    }
})
export class KopfrechnenComponent implements OnInit {
    private http = inject(HttpClient);
    private telemetryService = inject(AppTelemetryService);

    @ViewChildren('inputField') inputFields!: QueryList<ElementRef<HTMLInputElement>>;

    readonly QUESTIONS_PER_ROUND = 10;

    @Input() curriculum_node_id?: string;

    // Loaded config from API
    private curriculumConfig = signal<AppConfig | null>(null);

    readonly difficultySettings: Record<string, DifficultySettings> = {
        easy: { addMax: 20, subMax: 20, mulMax: 10, divMax: 50, divDivisorMax: 10, sqrtMax: 10, powBaseMax: 10, powExpMax: 2 },
        medium: { addMax: 100, subMax: 100, mulMax: 20, divMax: 100, divDivisorMax: 12, sqrtMax: 20, powBaseMax: 15, powExpMax: 3 },
        hard: { addMax: 10000, subMax: 10000, mulMax: 100, divMax: 1000, divDivisorMax: 100, sqrtMax: 100, powBaseMax: 20, powExpMax: 5 }
    };

    // State signals
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    difficulty = signal<'easy' | 'medium' | 'hard'>('easy');
    operations = signal<('add' | 'sub' | 'mul' | 'div' | 'sqrt' | 'pow')[]>(['add', 'div']);

    currentQuestion = signal<number>(0);
    question = signal<Question | null>(null);
    correctAnswer = signal<number>(0);
    userAnswer = signal<string>('');

    correctCount = signal<number>(0);
    wrongCount = signal<number>(0);
    streak = signal<number>(0);
    maxStreak = signal<number>(0);

    answered = signal<boolean>(false);
    feedbackText = signal<string>('');
    isCorrect = signal<boolean>(false);

    // Computed values
    progress = computed(() => (this.currentQuestion() / this.QUESTIONS_PER_ROUND) * 100);
    percentage = computed(() => {
        const total = this.correctCount() + this.wrongCount();
        return total > 0 ? Math.round((this.correctCount() / total) * 100) : 0;
    });

    // Check if we are in strict curriculum mode
    isCurriculumMode = computed(() => !!this.curriculumConfig());

    async ngOnInit() {
        if (this.curriculum_node_id) {
            await this.loadCurriculumConfig();
        }
    }

    async loadCurriculumConfig() {
        try {
            const res: any = await firstValueFrom(
                this.http.get(`/api/apps?app_id=kopfrechnen&curriculum_node_id=${this.curriculum_node_id}`)
            );
            if (res.config) {
                this.curriculumConfig.set(res.config);
                // Override operations if specified
                if (res.config.operations && Array.isArray(res.config.operations)) {
                    this.operations.set(res.config.operations);
                }
                // Auto-start or just prepare? Let's stay on welcome screen but show "Curriculum Mode"
            }
        } catch (e) {
            console.error('Error loading config:', e);
        }
    }

    setDifficulty(level: 'easy' | 'medium' | 'hard'): void {
        if (this.isCurriculumMode()) return;
        this.difficulty.set(level);
    }

    toggleOperation(op: 'add' | 'sub' | 'mul' | 'div' | 'sqrt' | 'pow'): void {
        if (this.isCurriculumMode()) return;

        const current = this.operations();
        if (current.includes(op)) {
            if (current.length > 1) {
                this.operations.set(current.filter(o => o !== op));
            }
        } else {
            this.operations.set([...current, op]);
        }
    }

    isOperationActive(op: 'add' | 'sub' | 'mul' | 'div' | 'sqrt' | 'pow'): boolean {
        return this.operations().includes(op);
    }

    startQuiz(): void {
        this.currentQuestion.set(0);
        this.correctCount.set(0);
        this.wrongCount.set(0);
        this.streak.set(0);
        this.maxStreak.set(0);
        this.screen.set('quiz');
        this.showQuestion();
    }

    private randInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    private countDecimals(n: number): number {
        if (Math.floor(n) === n) return 0;
        return n.toString().split('.')[1]?.length || 0;
    }

    private generateQuestion(): Question {
        const config = this.curriculumConfig();
        const settings = this.difficultySettings[this.difficulty()];

        const addMax = config?.addMax ?? settings.addMax;
        const subMax = (settings as any).subMax;
        const mulMax = (settings as any).mulMax;
        const divMax = config?.divMax ?? settings.divMax;
        const divDivisorMax = config?.divDivisorMax ?? settings.divDivisorMax;
        const sqrtMax = (settings as any).sqrtMax;
        const powBaseMax = (settings as any).powBaseMax;
        const powExpMax = (settings as any).powExpMax;

        const ops = this.operations();
        const operation = ops[this.randInt(0, ops.length - 1)];

        let a: number | string = 0, b: number | string = 0, result: number = 0;
        let blankPosition = this.randInt(0, 2) as 0 | 1 | 2;

        if (operation === 'add') {
            a = this.randInt(1, addMax);
            b = this.randInt(1, addMax);
            result = a + b;
        } else if (operation === 'sub') {
            a = this.randInt(1, subMax);
            b = this.randInt(1, subMax);
            if (this.difficulty() !== 'hard' && b > a) {
                const temp = a; a = b; b = temp as number;
            }
            result = (a as number) - (b as number);
        } else if (operation === 'mul') {
            a = this.randInt(1, mulMax);
            b = this.randInt(2, 12);
            result = (a as number) * (b as number);
        } else if (operation === 'div') {
            if (this.difficulty() !== 'hard') {
                b = this.randInt(2, divDivisorMax);
                result = this.randInt(1, Math.floor(divMax / b));
                a = b * result;
            } else {
                let attempts = 0;
                let validFound = false;
                do {
                    b = this.randInt(2, divDivisorMax);
                    a = this.randInt(1, divMax);
                    result = Math.round(((a as number) / (b as number)) * 100) / 100;
                    attempts++;
                    // Specifically enforce 2 decimals exactly to make it division with floats as requested.
                    // Oh wait, requested: "up to 2 floating point" e.g., 2.5 is allowed
                    if (this.countDecimals(result) <= 2 && this.countDecimals(result) > 0) {
                        // Check if a = b * result exactly! We have rounded result, so recalculate a!
                        a = Math.round((result * (b as number)) * 100) / 100;
                        if (this.countDecimals(a as number) === 0) {  // keep 'a' an integer if possible? 
                            validFound = true;
                        } else {
                            // If we also allow a to be float, that's fine. Let's just allow it!
                            validFound = true;
                        }
                    }
                } while (!validFound && attempts < 150);

                if (!validFound) {
                    // Fallback generating integer result if float search failed
                    b = this.randInt(2, 20);
                    result = this.randInt(1, 100);
                    a = b * result;
                }
            }
        } else if (operation === 'sqrt') {
            result = this.randInt(1, sqrtMax);
            b = result * result;
            a = ''; // Unused for sqrt
            if (blankPosition === 0) blankPosition = 1; // 0 doesn't make sense for visual format `√ b = result`
        } else if (operation === 'pow') {
            a = this.randInt(2, powBaseMax);
            b = this.randInt(2, powExpMax);
            result = Math.pow(a as number, b as number);
        }

        return { operation, a, b, result, blankPosition };
    }

    private showQuestion(): void {
        const q = this.generateQuestion();
        this.question.set(q);

        const answer = q.blankPosition === 0 ? q.a : q.blankPosition === 1 ? q.b : q.result;
        this.correctAnswer.set(answer as number);

        this.userAnswer.set('');
        this.answered.set(false);
        this.feedbackText.set('');

        setTimeout(() => {
            const inputs = this.inputFields?.toArray();
            if (inputs && inputs.length > 0) {
                inputs[0].nativeElement.focus();
            }
        }, 50);
    }

    onInputChange(value: string): void {
        this.userAnswer.set(value);
    }

    checkAnswer(): void {
        if (this.answered()) {
            this.nextQuestion();
            return;
        }

        const input = this.userAnswer().trim().replace(',', '.');
        const userNum = parseFloat(input);

        if (isNaN(userNum)) {
            this.feedbackText.set('Bitte gib eine Zahl ein.');
            this.isCorrect.set(false);
            return;
        }

        const correct = Math.abs(userNum - this.correctAnswer()) < 0.001;
        this.isCorrect.set(correct);

        if (correct) {
            this.feedbackText.set('✓ Richtig!');
            this.correctCount.update(c => c + 1);
            this.streak.update(s => s + 1);
            if (this.streak() > this.maxStreak()) {
                this.maxStreak.set(this.streak());
            }
        } else {
            this.feedbackText.set(`✗ Falsch. Die Antwort war: ${this.correctAnswer()}`);
            this.wrongCount.update(w => w + 1);
            this.streak.set(0);
        }

        // Track per-question progress
        // In curriculum mode, category = curriculum_node_id
        // In manual mode, category = operation-difficulty
        const q = this.question();
        if (q) {
            const category = this.curriculum_node_id
                ? `curriculum-${this.curriculum_node_id}`
                : `${q.operation}-${this.difficulty()}`;
            this.telemetryService.trackCategoryProgress('kopfrechnen', category, correct);
        }

        this.answered.set(true);
    }

    private nextQuestion(): void {
        this.currentQuestion.update(q => q + 1);
        if (this.currentQuestion() >= this.QUESTIONS_PER_ROUND) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.showQuestion();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    getOperatorSymbol(question: Question | null = null): string {
        const q = question || this.question();
        switch (q?.operation) {
            case 'add': return '+';
            case 'sub': return '-';
            case 'mul': return '×';
            case 'div': return '÷';
            case 'sqrt': return '√';
            case 'pow': return '^';
            default: return '+';
        }
    }



    onEnterKey(): void {
        if (this.screen() === 'quiz') {
            this.checkAnswer();
        }
    }
}
