import { Component, signal, computed } from '@angular/core';

interface DifficultySettings {
    addMax: number;
    divMax: number;
    divDivisorMax: number;
}

interface Question {
    operation: 'add' | 'div';
    a: number;
    b: number;
    result: number;
    blankPosition: 0 | 1 | 2;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { inject } from '@angular/core';

import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

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
export class KopfrechnenComponent {
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();
    readonly QUESTIONS_PER_ROUND = 10;

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

    setDifficulty(level: 'easy' | 'medium' | 'hard'): void {
        this.difficulty.set(level);
    }

    toggleOperation(op: 'add' | 'div'): void {
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
        const settings = this.difficultySettings[this.difficulty()];
        const ops = this.operations();
        const operation = ops[this.randInt(0, ops.length - 1)];

        let a: number, b: number, result: number;
        const blankPosition = this.randInt(0, 2) as 0 | 1 | 2;

        if (operation === 'add') {
            a = this.randInt(1, settings.addMax);
            b = this.randInt(1, settings.addMax);
            result = a + b;
        } else {
            b = this.randInt(2, settings.divDivisorMax);
            result = this.randInt(1, Math.floor(settings.divMax / b));
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

        this.answered.set(true);
    }

    private nextQuestion(): void {
        this.currentQuestion.update(q => q + 1);
        if (this.currentQuestion() >= this.QUESTIONS_PER_ROUND) {
            this.screen.set('results');
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
