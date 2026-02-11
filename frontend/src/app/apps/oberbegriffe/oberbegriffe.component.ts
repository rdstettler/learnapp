import { Component, signal, computed, inject } from '@angular/core';
import { normalizeGermanText } from '../../shared/utils/text.utils';
import { shuffle } from '../../shared/utils/array.utils';
import { DataService } from '../../services/data.service';

interface OberbegriffItem {
    id: number;
    words: string[];
    answers: string;
}

type QuizMode = 'tippen' | 'auswahl' | 'eindringling';

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

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

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'tippen', label: 'Tippen', icon: '✍️', description: 'Tippe den Oberbegriff ein.' },
        { id: 'auswahl', label: 'Auswahl', icon: '🎯', description: 'Wähle den richtigen Oberbegriff.' },
        { id: 'eindringling', label: 'Eindringling', icon: '🔍', description: 'Finde das Wort, das nicht passt.' }
    ];

    mode = signal<QuizMode>('tippen');
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    allItems = signal<OberbegriffItem[]>([]);
    items = signal<OberbegriffItem[]>([]);
    currentIndex = signal(0);

    userAnswer = signal('');
    answered = signal(false);
    isCorrect = signal(false);
    matchedAnswer = signal('');

    // Auswahl (MC) mode
    mcOptions = signal<string[]>([]);
    mcAnswered = signal(false);
    mcSelected = signal('');
    mcIsCorrect = signal(false);
    mcCorrectAnswer = signal('');

    // Eindringling (OOO) mode
    oooWords = signal<string[]>([]);
    oooIntruder = signal('');
    oooIntruderCategory = signal('');
    oooAnswered = signal(false);
    oooSelected = signal('');
    oooIsCorrect = signal(false);

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

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        const shuffled = shuffle(this.allItems());
        this.items.set(shuffled.slice(0, this.PROBLEMS_PER_ROUND));
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
        this.setupItem();
    }

    private setupItem(): void {
        this.userAnswer.set('');
        this.answered.set(false);
        this.matchedAnswer.set('');
        if (this.mode() === 'auswahl') this.setupMCItem();
        if (this.mode() === 'eindringling') this.setupOOOItem();
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

    // ═══ MODE: AUSWAHL (MC) ═══

    private setupMCItem(): void {
        const item = this.currentItem();
        if (!item) return;
        const correctAnswer = item.answers.split(',')[0].trim();
        const otherItems = this.allItems().filter(i => i.id !== item.id);
        const distractors = shuffle(otherItems)
            .map(i => i.answers.split(',')[0].trim())
            .filter(a => this.normalizeAnswer(a) !== this.normalizeAnswer(correctAnswer))
            .slice(0, 3);
        this.mcOptions.set(shuffle([correctAnswer, ...distractors]));
        this.mcSelected.set('');
        this.mcAnswered.set(false);
        this.mcCorrectAnswer.set(correctAnswer);
    }

    selectMCOption(option: string): void {
        if (this.mcAnswered()) return;
        const item = this.currentItem();
        if (!item) return;
        const acceptedAnswers = item.answers.split(',').map(a => this.normalizeAnswer(a.trim()));
        const isCorrect = acceptedAnswers.includes(this.normalizeAnswer(option));
        this.mcSelected.set(option);
        this.mcIsCorrect.set(isCorrect);
        this.mcAnswered.set(true);
        if (isCorrect) this.totalCorrect.update(c => c + 1);
        else this.totalWrong.update(w => w + 1);
        const contentId = (item as any)._contentId;
        if (contentId) this.telemetryService.trackProgress('oberbegriffe', contentId, isCorrect);
    }

    getMCOptionClass(option: string): string {
        if (!this.mcAnswered()) return '';
        const item = this.currentItem();
        if (!item) return '';
        const acceptedAnswers = item.answers.split(',').map(a => this.normalizeAnswer(a.trim()));
        const isThis = acceptedAnswers.includes(this.normalizeAnswer(option));
        if (option === this.mcSelected()) return isThis ? 'correct' : 'incorrect';
        return isThis ? 'correct' : '';
    }

    // ═══ MODE: EINDRINGLING (OOO) ═══

    private setupOOOItem(): void {
        const item = this.currentItem();
        if (!item) return;
        const otherItems = this.allItems().filter(i => i.id !== item.id);
        const otherItem = otherItems[Math.floor(Math.random() * otherItems.length)];
        const intruder = otherItem.words[Math.floor(Math.random() * otherItem.words.length)];
        const intruderCategory = otherItem.answers.split(',')[0].trim();
        this.oooIntruder.set(intruder);
        this.oooIntruderCategory.set(intruderCategory);
        this.oooWords.set(shuffle([...item.words, intruder]));
        this.oooSelected.set('');
        this.oooAnswered.set(false);
    }

    selectOOOWord(word: string): void {
        if (this.oooAnswered()) return;
        const item = this.currentItem();
        if (!item) return;
        const isCorrect = word === this.oooIntruder();
        this.oooSelected.set(word);
        this.oooIsCorrect.set(isCorrect);
        this.oooAnswered.set(true);
        if (isCorrect) this.totalCorrect.update(c => c + 1);
        else this.totalWrong.update(w => w + 1);
        const contentId = (item as any)._contentId;
        if (contentId) this.telemetryService.trackProgress('oberbegriffe', contentId, isCorrect);
    }

    getOOOWordClass(word: string): string {
        if (!this.oooAnswered()) return '';
        if (word === this.oooIntruder()) return 'intruder-correct';
        if (word === this.oooSelected() && word !== this.oooIntruder()) return 'intruder-wrong';
        return '';
    }

    // ═══ SHARED ═══

    nextItem(): void {
        const nextIndex = this.currentIndex() + 1;
        if (nextIndex >= this.PROBLEMS_PER_ROUND) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentIndex.set(nextIndex);
            this.setupItem();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    playAgain(): void {
        this.startQuiz();
    }

    handleEnter(): void {
        const m = this.mode();
        if (m === 'tippen') {
            if (this.answered()) this.nextItem();
            else if (this.userAnswer().trim().length > 0) this.checkAnswer();
        } else if (m === 'auswahl') {
            if (this.mcAnswered()) this.nextItem();
        } else if (m === 'eindringling') {
            if (this.oooAnswered()) this.nextItem();
        }
    }
}
