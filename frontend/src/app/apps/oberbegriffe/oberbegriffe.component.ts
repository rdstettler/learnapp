import { Component, signal, computed, inject } from '@angular/core';
import { normalizeGermanText } from '../../shared/utils/text.utils';
import { shuffle } from '../../shared/utils/array.utils';
import { DataService } from '../../services/data.service';

interface OberbegriffItem {
    id: number;
    words: string[];
    answers: string; // Kommagetrennte mögliche Antworten
}

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

@Component({
    selector: 'app-oberbegriffe',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './oberbegriffe.component.html',
    styleUrl: './oberbegriffe.component.css',
    host: {
        '(window:keydown.enter)': 'handleEnter()'
    }
})
export class OberbegriffeComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly PROBLEMS_PER_ROUND = 10;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    allItems = signal<OberbegriffItem[]>([]);
    items = signal<OberbegriffItem[]>([]);
    currentIndex = signal(0);

    userAnswer = signal('');
    answered = signal(false);
    isCorrect = signal(false);
    matchedAnswer = signal('');

    totalCorrect = signal(0);
    totalWrong = signal(0);

    progress = computed(() => (this.currentIndex() / this.PROBLEMS_PER_ROUND) * 100);
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentItem = computed(() => this.items()[this.currentIndex()]);
    dataLoaded = computed(() => this.allItems().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<OberbegriffItem>('oberbegriffe').subscribe({
            next: (data) => this.allItems.set(data),
            error: (err) => console.error('Error loading oberbegriffe data:', err)
        });
    }

    startQuiz(): void {
        const shuffled = shuffle(this.allItems());
        this.items.set(shuffled.slice(0, this.PROBLEMS_PER_ROUND));
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
        this.showItem();
    }

    private showItem(): void {
        this.userAnswer.set('');
        this.answered.set(false);
        this.matchedAnswer.set('');
    }

    updateAnswer(value: string): void {
        this.userAnswer.set(value);
    }

    checkAnswer(): void {
        const item = this.currentItem();
        if (!item) return;

        const userStr = this.normalizeAnswer(this.userAnswer());
        const acceptedAnswers = item.answers.split(',').map(a => a.trim());

        // Finde passende Antwort
        const matched = acceptedAnswers.find(ans =>
            this.normalizeAnswer(ans) === userStr
        );

        const correct = !!matched;
        if (correct) {
            this.isCorrect.set(true);
            this.matchedAnswer.set(matched!);
            this.totalCorrect.update(c => c + 1);
        } else {
            this.isCorrect.set(false);
            this.matchedAnswer.set(acceptedAnswers[0]); // Zeige erste mögliche Antwort
            this.totalWrong.update(w => w + 1);
        }

        this.answered.set(true);

        // Track per-question progress
        const contentId = (item as any)._contentId;
        if (contentId) {
            this.telemetryService.trackProgress('oberbegriffe', contentId, correct);
        }
    }

    private normalizeAnswer(answer: string): string {
        return normalizeGermanText(answer);
    }

    getPossibleAnswers(): string {
        const item = this.currentItem();
        if (!item) return '';
        return item.answers;
    }

    nextItem(): void {
        const nextIndex = this.currentIndex() + 1;

        if (nextIndex >= this.PROBLEMS_PER_ROUND) {
            this.screen.set('results');
        } else {
            this.currentIndex.set(nextIndex);
            this.showItem();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    playAgain(): void {
        this.startQuiz();
    }

    handleEnter(): void {
        if (this.answered()) {
            this.nextItem();
        } else if (this.userAnswer().trim().length > 0) {
            this.checkAnswer();
        }
    }
}
