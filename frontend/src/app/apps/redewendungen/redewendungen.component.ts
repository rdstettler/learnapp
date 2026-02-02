import { Component, signal, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';

interface Redewendung {
    idiom: string;
    options: string[];
}

@Component({
    selector: 'app-redewendungen',
    standalone: true,
    templateUrl: './redewendungen.component.html',
    styleUrl: './redewendungen.component.css'
})
export class RedewendungenComponent {
    private dataService = inject(DataService);

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
        this.dataService.loadData<{ redewendungen: Redewendung[] }>('redewendungen.json').subscribe({
            next: (data) => this.redewendungen.set(data.redewendungen),
            error: (err) => console.error('Error loading redewendungen data:', err)
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
        const seen = new Set<string>();
        const unique = this.redewendungen().filter(r => {
            if (seen.has(r.idiom)) return false;
            seen.add(r.idiom);
            return true;
        });

        this.questions.set(this.shuffle(unique).slice(0, this.QUESTIONS_PER_ROUND));
        this.currentQuestion.set(0);
        this.correctCount.set(0);
        this.wrongCount.set(0);
        this.screen.set('quiz');
        this.showQuestion();
    }

    private showQuestion(): void {
        const q = this.questions()[this.currentQuestion()];
        const correctAnswer = q.options[0];
        const shuffledOptions = this.shuffle(q.options);

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
