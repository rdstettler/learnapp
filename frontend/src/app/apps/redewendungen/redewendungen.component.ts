import { Component, signal, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';
import { shuffle } from '../../shared/utils/array.utils';

interface Redewendung {
    idiom: string;
    options: string[];
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

@Component({
    selector: 'app-redewendungen',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './redewendungen.component.html',
    styleUrl: './redewendungen.component.css'
})
export class RedewendungenComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly QUESTIONS_PER_ROUND = 10;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    redewendungen = signal<Redewendung[]>([]);
    questions = signal<Redewendung[]>([]);
    currentQuestion = signal(0);
    correctCount = signal(0);
    wrongCount = signal(0);

    currentOptions = signal<{ text: string; isCorrect: boolean; selected: boolean; disabled: boolean }[]>([]);
    feedbackText = signal('');
    isCorrect = signal(false);
    answered = signal(false);

    progress = computed(() => (this.currentQuestion() / this.QUESTIONS_PER_ROUND) * 100);
    percentage = computed(() => {
        const total = this.correctCount() + this.wrongCount();
        return total > 0 ? Math.round((this.correctCount() / total) * 100) : 0;
    });

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<Redewendung>('redewendungen').subscribe({
            next: (data) => this.redewendungen.set(data),
            error: (err) => console.error('Error loading redewendungen data:', err)
        });
    }

    startQuiz(): void {
        const seen = new Set<string>();
        const unique = this.redewendungen().filter(r => {
            if (seen.has(r.idiom)) return false;
            seen.add(r.idiom);
            return true;
        });

        this.questions.set(shuffle(unique).slice(0, this.QUESTIONS_PER_ROUND));
        this.currentQuestion.set(0);
        this.correctCount.set(0);
        this.wrongCount.set(0);
        this.screen.set('quiz');
        this.showQuestion();
    }

    private showQuestion(): void {
        const q = this.questions()[this.currentQuestion()];
        const correctAnswer = q.options[0];
        const shuffledOptions = shuffle(q.options);

        this.currentOptions.set(shuffledOptions.map(opt => ({
            text: opt,
            isCorrect: opt === correctAnswer,
            selected: false,
            disabled: false
        })));

        this.feedbackText.set('');
        this.answered.set(false);
    }

    selectOption(index: number): void {
        if (this.answered()) return;

        const options = this.currentOptions();
        const selected = options[index];

        const updatedOptions = options.map((opt, i) => ({
            ...opt,
            selected: i === index,
            disabled: true
        }));

        this.currentOptions.set(updatedOptions);
        this.answered.set(true);

        if (selected.isCorrect) {
            this.correctCount.update(c => c + 1);
            this.feedbackText.set('✓ Richtig!');
            this.isCorrect.set(true);
        } else {
            this.wrongCount.update(c => c + 1);
            this.feedbackText.set('✗ Leider falsch!');
            this.isCorrect.set(false);

            // Telemetry: Track error
            const content = JSON.stringify({
                idiom: this.questions()[this.currentQuestion()].idiom,
                correct: this.questions()[this.currentQuestion()].options[0],
                actual: selected.text
            });
            this.telemetryService.trackError('redewendungen', content, this.sessionId);
        }
    }

    nextQuestion(): void {
        if (this.currentQuestion() >= this.QUESTIONS_PER_ROUND - 1) {
            this.screen.set('results');
        } else {
            this.currentQuestion.update(q => q + 1);
            this.showQuestion();
        }
    }

    getCurrentIdiom(): string {
        const q = this.questions()[this.currentQuestion()];
        return q?.idiom || '';
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
