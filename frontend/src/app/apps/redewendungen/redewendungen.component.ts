import { Component, signal, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';
import { shuffle } from '../../shared/utils/array.utils';
import { normalizeGermanText } from '../../shared/utils/text.utils';

interface Redewendung {
    idiom: string;
    options: string[];
}

type QuizMode = 'bedeutung' | 'ergaenze';

import { AppTelemetryService } from '../../services/app-telemetry.service';

import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

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


    readonly QUESTIONS_PER_ROUND = 10;
    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'bedeutung', label: 'Bedeutung', icon: '🎯', description: 'Was bedeutet die Redewendung?' },
        { id: 'ergaenze', label: 'Ergänze', icon: '✏️', description: 'Vervollständige die Redewendung!' }
    ];

    mode = signal<QuizMode>('bedeutung');
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    redewendungen = signal<Redewendung[]>([]);
    questions = signal<Redewendung[]>([]);
    currentQuestion = signal(0);
    correctCount = signal(0);
    wrongCount = signal(0);

    // Mode: bedeutung
    currentOptions = signal<{ text: string; isCorrect: boolean; selected: boolean; disabled: boolean }[]>([]);

    // Mode: ergaenze
    idiomPrefix = signal('');
    missingWord = signal('');
    userInput = signal('');

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

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        const seen = new Set<string>();
        let pool = this.redewendungen().filter(r => {
            if (seen.has(r.idiom)) return false;
            seen.add(r.idiom);
            return true;
        });

        // For ergaenze mode, only use idioms with 3+ words (so we can remove the last word)
        if (this.mode() === 'ergaenze') {
            pool = pool.filter(r => r.idiom.trim().split(/\s+/).length >= 3);
        }

        this.questions.set(shuffle(pool).slice(0, this.QUESTIONS_PER_ROUND));
        this.currentQuestion.set(0);
        this.correctCount.set(0);
        this.wrongCount.set(0);
        this.screen.set('quiz');
        this.showQuestion();
    }

    private showQuestion(): void {
        const q = this.questions()[this.currentQuestion()];
        this.feedbackText.set('');
        this.answered.set(false);

        if (this.mode() === 'bedeutung') {
            const correctAnswer = q.options[0];
            const shuffledOptions = shuffle(q.options);
            this.currentOptions.set(shuffledOptions.map(opt => ({
                text: opt,
                isCorrect: opt === correctAnswer,
                selected: false,
                disabled: false
            })));
        } else {
            // Ergänze mode: split idiom, remove last word
            const words = q.idiom.trim().split(/\s+/);
            const missing = words.pop()!;
            this.idiomPrefix.set(words.join(' '));
            this.missingWord.set(missing);
            this.userInput.set('');
        }
    }

    // Mode: bedeutung
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

        const correct = selected.isCorrect;
        if (correct) {
            this.correctCount.update(c => c + 1);
            this.feedbackText.set('✓ Richtig!');
            this.isCorrect.set(true);
        } else {
            this.wrongCount.update(c => c + 1);
            this.feedbackText.set('✗ Leider falsch!');
            this.isCorrect.set(false);
        }

        // Track per-question progress
        const q = this.questions()[this.currentQuestion()] as any;
        if (q?._contentId) {
            this.telemetryService.trackProgress('redewendungen', q._contentId, correct, this.mode());
        }
    }

    // Mode: ergaenze
    updateInput(value: string): void {
        this.userInput.set(value);
    }

    checkErgaenze(): void {
        if (this.answered()) return;

        const userStr = normalizeGermanText(this.userInput().trim());
        const correctStr = normalizeGermanText(this.missingWord());
        const correct = userStr === correctStr;

        this.answered.set(true);
        this.isCorrect.set(correct);

        if (correct) {
            this.correctCount.update(c => c + 1);
            this.feedbackText.set('✓ Richtig!');
        } else {
            this.wrongCount.update(c => c + 1);
            this.feedbackText.set(`✗ Richtig wäre: ${this.missingWord()}`);
        }

        // Track per-question progress
        const q = this.questions()[this.currentQuestion()] as any;
        if (q?._contentId) {
            this.telemetryService.trackProgress('redewendungen', q._contentId, correct, this.mode());
        }
    }

    nextQuestion(): void {
        if (this.currentQuestion() >= this.QUESTIONS_PER_ROUND - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
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

    handleEnter(): void {
        if (this.mode() !== 'ergaenze') return;
        if (this.answered()) {
            this.nextQuestion();
        } else if (this.userInput().trim().length > 0) {
            this.checkErgaenze();
        }
    }
}
