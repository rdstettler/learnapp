import { Component, signal, computed, Input, OnInit, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface DifficultySettings {
    addMax: number;
    divMax: number;
    divDivisorMax: number;
}

interface AppConfig {
    addMax?: number;
    divMax?: number;
    divDivisorMax?: number;
    operations?: ('add' | 'div')[];
    // Add other config props as needed
}

interface Question {
    operation: 'add' | 'div';
    a: number;
    b: number;
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
    private sessionId = this.telemetryService.generateSessionId();
    readonly QUESTIONS_PER_ROUND = 10;

    @Input() curriculum_node_id?: string;

    // Loaded config from API
    private curriculumConfig = signal<AppConfig | null>(null);

    readonly difficultySettings: Record<string, DifficultySettings> = {
        easy: { addMax: 20, divMax: 50, divDivisorMax: 10 },
        medium: { addMax: 100, divMax: 100, divDivisorMax: 12 },
        hard: { addMax: 500, divMax: 200, divDivisorMax: 20 }
    };

    // State signals
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    difficulty = signal<'easy' | 'medium' | 'hard'>('easy');
    operations = signal<('add' | 'div')[]>(['add', 'div']);

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

    toggleOperation(op: 'add' | 'div'): void {
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

    isOperationActive(op: 'add' | 'div'): boolean {
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

    private generateQuestion(): Question {
        // Use config if available, fallback to manual settings
        const config = this.curriculumConfig();
        const settings = this.difficultySettings[this.difficulty()];

        // Determine limits
        const addMax = config?.addMax ?? settings.addMax;
        const divMax = config?.divMax ?? settings.divMax;
        const divDivisorMax = config?.divDivisorMax ?? settings.divDivisorMax;

        const ops = this.operations();
        const operation = ops[this.randInt(0, ops.length - 1)];

        let a: number, b: number, result: number;
        const blankPosition = this.randInt(0, 2) as 0 | 1 | 2;

        if (operation === 'add') {
            a = this.randInt(1, addMax);
            b = this.randInt(1, addMax);
            result = a + b;
        } else {
            b = this.randInt(2, divDivisorMax);
            result = this.randInt(1, Math.floor(divMax / b));
            a = b * result;
        }

        return { operation, a, b, result, blankPosition };
    }

    private showQuestion(): void {
        const q = this.generateQuestion();
        this.question.set(q);

        const answer = q.blankPosition === 0 ? q.a : q.blankPosition === 1 ? q.b : q.result;
        this.correctAnswer.set(answer);

        this.userAnswer.set('');
        this.answered.set(false);
        this.feedbackText.set('');
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

    getOperatorSymbol(): string {
        return this.question()?.operation === 'add' ? '+' : '÷';
    }

    private randInt(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    onEnterKey(): void {
        if (this.screen() === 'quiz') {
            this.checkAnswer();
        }
    }
}
