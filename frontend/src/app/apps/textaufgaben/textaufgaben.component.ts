import { Component, signal, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';

interface TextaufgabeItem {
    id: string;
    topics: string[];
    question: string;
    answers: string[];
    explanation: string;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

@Component({
    selector: 'app-textaufgaben',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './textaufgaben.component.html',
    styleUrl: './textaufgaben.component.css'
})
export class TextaufgabenComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    items = signal<TextaufgabeItem[]>([]);
    rounds = signal<TextaufgabeItem[]>([]);
    currentRound = signal(0);

    userAnswer = signal('');
    answered = signal(false);
    isCorrect = signal(false);
    feedbackText = signal('');
    showExplanation = signal(false);

    totalCorrect = signal(0);
    totalQuestions = signal(5);

    progress = computed(() => (this.currentRound() / 5) * 100);
    percentage = computed(() => Math.round((this.totalCorrect() / this.totalQuestions()) * 100));

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadData<TextaufgabeItem[]>('textaufgaben.json').subscribe({
            next: (data) => this.items.set(data),
            error: (err) => console.error('Error loading textaufgaben data:', err)
        });
    }

    private shuffle<T>(array: T[]): T[] {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    startQuiz(): void {
        this.rounds.set(this.shuffle(this.items()).slice(0, 5));
        this.currentRound.set(0);
        this.totalCorrect.set(0);
        this.screen.set('quiz');
        this.showRound();
    }

    private showRound(): void {
        this.userAnswer.set('');
        this.answered.set(false);
        this.feedbackText.set('');
        this.showExplanation.set(false);
    }

    getCurrentProblem(): TextaufgabeItem | null {
        return this.rounds()[this.currentRound()] || null;
    }

    updateAnswer(value: string): void {
        this.userAnswer.set(value);
    }

    checkAnswer(): void {
        const problem = this.getCurrentProblem();
        if (!problem) return;

        const userAnswerNormalized = this.userAnswer().trim().toLowerCase().replace(',', '.');
        const correct = problem.answers.some(ans =>
            ans.toLowerCase().replace(',', '.') === userAnswerNormalized
        );

        this.isCorrect.set(correct);
        this.answered.set(true);

        if (correct) {
            this.totalCorrect.update(c => c + 1);
            this.feedbackText.set('✓ Richtig!');
        } else {
            this.feedbackText.set(`✗ Falsch! Richtige Antwort: ${problem.answers[0]}`);

            // Telemetry: Track error
            const content = JSON.stringify({
                questionId: problem.id,
                question: problem.question,
                actual: this.userAnswer()
            });
            this.telemetryService.trackError('textaufgaben', content, this.sessionId);
        }
    }

    toggleExplanation(): void {
        this.showExplanation.update(v => !v);
    }

    nextRound(): void {
        if (this.currentRound() >= 4) {
            this.screen.set('results');
        } else {
            this.currentRound.update(r => r + 1);
            this.showRound();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
