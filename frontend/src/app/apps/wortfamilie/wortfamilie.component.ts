import { Component, signal, computed, inject } from '@angular/core';
import { normalizeGermanText } from '../../shared/utils/text.utils';
import { shuffle } from '../../shared/utils/array.utils';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';


interface WortfamilieItem {
    id: number;
    nomen: string;    // Kommagetrennte mögliche Antworten
    verb: string;     // Kommagetrennte mögliche Antworten
    adjektiv: string; // Kommagetrennte mögliche Antworten
}

type WordType = 'nomen' | 'verb' | 'adjektiv';
type QuizMode = 'tippen' | 'zuordnen' | 'paare';

interface PairItem {
    id: number;
    left: string;
    right: string;
    leftType: WordType;
    rightType: WordType;
}

interface Problem {
    item: WortfamilieItem;
    givenType: WordType;
    givenWord: string;
    missingTypes: WordType[];
}

@Component({
    selector: 'app-wortfamilie',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './wortfamilie.component.html',
    styleUrl: './wortfamilie.component.css',
    host: {
        '(window:keydown.enter)': 'handleEnter($event)'
    }
})
export class WortfamilieComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);


    readonly PROBLEMS_PER_ROUND = 10;

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'tippen', label: 'Tippen', icon: '✍️', description: 'Ergänze die fehlenden Wortformen.' },
        { id: 'zuordnen', label: 'Zuordnen', icon: '🏷️', description: 'Ordne Wörter als Nomen, Verb oder Adjektiv zu.' },
        { id: 'paare', label: 'Paare finden', icon: '🔗', description: 'Verbinde Wörter aus der gleichen Wortfamilie.' }
    ];
    mode = signal<QuizMode>('tippen');
    readonly ARTICLES = ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines'];

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    allItems = signal<WortfamilieItem[]>([]);
    problems = signal<Problem[]>([]);
    currentIndex = signal(0);

    userAnswers = signal<Record<WordType, string>>({ nomen: '', verb: '', adjektiv: '' });
    answered = signal(false);
    results = signal<Record<WordType, { correct: boolean; partial: boolean; matched: string }>>({
        nomen: { correct: false, partial: false, matched: '' },
        verb: { correct: false, partial: false, matched: '' },
        adjektiv: { correct: false, partial: false, matched: '' }
    });

    totalCorrect = signal(0);
    totalWrong = signal(0);

    // Classification mode
    classWords = signal<{ word: string; type: WordType }[]>([]);
    classIndex = signal(0);
    classAnswered = signal(false);
    classSelected = signal('');
    classIsCorrect = signal(false);

    // Pair-matching mode
    pairItems = signal<PairItem[]>([]);
    leftColumn = signal<{ word: string; pairId: number }[]>([]);
    rightColumn = signal<{ word: string; pairId: number }[]>([]);
    selectedLeft = signal<number | null>(null);
    selectedRight = signal<number | null>(null);
    matchedPairs = signal<Set<number>>(new Set());
    wrongPair = signal(false);
    private wrongTimeout: any = null;

    progress = computed(() => {
        if (this.mode() === 'zuordnen') {
            const total = this.classWords().length;
            return total > 0 ? (this.classIndex() / total) * 100 : 0;
        }
        if (this.mode() === 'paare') {
            const total = this.pairItems().length;
            return total > 0 ? (this.matchedPairs().size / total) * 100 : 0;
        }
        return (this.currentIndex() / this.PROBLEMS_PER_ROUND) * 100;
    });
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentProblem = computed(() => this.problems()[this.currentIndex()]);
    dataLoaded = computed(() => this.allItems().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<WortfamilieItem>('wortfamilie').subscribe({
            next: (data) => this.allItems.set(data),
            error: (err) => console.error('Error loading wortfamilie data:', err)
        });
    }

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');

        if (this.mode() === 'zuordnen') {
            this.startClassification();
            return;
        }

        if (this.mode() === 'paare') {
            this.startPairMatching();
            return;
        }

        const shuffled = shuffle(this.allItems());
        const selected = shuffled.slice(0, this.PROBLEMS_PER_ROUND);

        const problems: Problem[] = selected.map(item => {
            const types: WordType[] = ['nomen', 'verb', 'adjektiv'];
            const givenType = types[Math.floor(Math.random() * types.length)];
            const words = item[givenType].split(',').map(w => w.trim());
            const givenWord = words[Math.floor(Math.random() * words.length)];
            const missingTypes = types.filter(t => t !== givenType);
            return { item, givenType, givenWord, missingTypes };
        });

        this.problems.set(problems);
        this.currentIndex.set(0);
        this.showProblem();
    }

    private showProblem(): void {
        this.userAnswers.set({ nomen: '', verb: '', adjektiv: '' });
        this.answered.set(false);
        this.results.set({
            nomen: { correct: false, partial: false, matched: '' },
            verb: { correct: false, partial: false, matched: '' },
            adjektiv: { correct: false, partial: false, matched: '' }
        });
    }

    updateAnswer(type: WordType, value: string): void {
        const answers = { ...this.userAnswers() };
        answers[type] = value;
        this.userAnswers.set(answers);
    }

    getResult(type: WordType): { correct: boolean; partial: boolean; matched: string } {
        return this.results()[type];
    }

    getTypeLabel(type: WordType): string {
        switch (type) {
            case 'nomen': return 'Nomen';
            case 'verb': return 'Verb';
            case 'adjektiv': return 'Adjektiv';
        }
    }

    getTypeIcon(type: WordType): string {
        switch (type) {
            case 'nomen': return '📦';
            case 'verb': return '🏃';
            case 'adjektiv': return '🎨';
        }
    }

    checkAnswers(): void {
        const problem = this.currentProblem();
        if (!problem) return;

        const newResults: Record<WordType, { correct: boolean; partial: boolean; matched: string }> = {
            nomen: { correct: false, partial: false, matched: '' },
            verb: { correct: false, partial: false, matched: '' },
            adjektiv: { correct: false, partial: false, matched: '' }
        };

        let correctCount = 0;
        let wrongCount = 0;

        for (const type of problem.missingTypes) {
            const userAnswer = this.userAnswers()[type];
            const acceptedAnswers = problem.item[type].split(',').map(a => a.trim());

            // Prüfe Antwort (ohne Artikel)
            const matched = acceptedAnswers.find(ans =>
                this.normalizeAnswer(ans) === this.normalizeAnswer(userAnswer)
            );

            if (matched) {
                // Check if exact match (case-sensitive) or just case-insensitive
                const isExact = matched === userAnswer.trim();
                newResults[type] = { correct: true, partial: !isExact, matched };
                correctCount++;
            } else {
                newResults[type] = { correct: false, partial: false, matched: acceptedAnswers[0] };
                wrongCount++;
            }
        }

        this.results.set(newResults);
        this.totalCorrect.update(c => c + correctCount);
        this.totalWrong.update(w => w + wrongCount);
        this.answered.set(true);

        // Track per-content progress
        const contentId = (problem.item as any)._contentId;
        if (contentId) {
            this.telemetryService.trackProgress('wortfamilie', contentId, wrongCount === 0, this.mode());
        }
    }

    private normalizeAnswer(answer: string): string {
        let normalized = answer.toLowerCase().trim();

        // Entferne Artikel am Anfang
        for (const article of this.ARTICLES) {
            if (normalized.startsWith(article + ' ')) {
                normalized = normalized.substring(article.length + 1).trim();
                break;
            }
        }

        // Normalisiere Umlaute und ß
        return normalizeGermanText(normalized);
    }

    canCheck(): boolean {
        const problem = this.currentProblem();
        if (!problem) return false;

        return problem.missingTypes.every(type =>
            this.userAnswers()[type].trim().length > 0
        );
    }

    nextProblem(): void {
        const nextIndex = this.currentIndex() + 1;

        if (nextIndex >= this.PROBLEMS_PER_ROUND) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentIndex.set(nextIndex);
            this.showProblem();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    playAgain(): void {
        this.startQuiz();
    }

    handleEnter(event: Event) {
        if (this.mode() === 'paare') return; // click-only mode
        if (this.mode() === 'zuordnen') {
            if (this.classAnswered()) this.nextClassWord();
            return;
        }
        if (this.answered()) {
            this.nextProblem();
        } else if (this.canCheck()) {
            this.checkAnswers();
        }
    }

    // ═══ MODE: ZUORDNEN ═══

    private startClassification(): void {
        const items = shuffle(this.allItems());
        const words: { word: string; type: WordType }[] = [];
        const types: WordType[] = ['nomen', 'verb', 'adjektiv'];

        for (const item of items) {
            const type = types[Math.floor(Math.random() * types.length)];
            const allWords = item[type].split(',').map(w => w.trim());
            const word = allWords[Math.floor(Math.random() * allWords.length)];
            words.push({ word, type });
            if (words.length >= this.PROBLEMS_PER_ROUND) break;
        }

        this.classWords.set(shuffle(words));
        this.classIndex.set(0);
        this.classAnswered.set(false);
        this.classSelected.set('');
    }

    currentClassWord = computed(() => this.classWords()[this.classIndex()]);

    selectClassType(type: string): void {
        if (this.classAnswered()) return;
        const current = this.currentClassWord();
        if (!current) return;

        const isCorrect = type === current.type;
        this.classSelected.set(type);
        this.classIsCorrect.set(isCorrect);
        this.classAnswered.set(true);

        if (isCorrect) this.totalCorrect.update(c => c + 1);
        else this.totalWrong.update(w => w + 1);
    }

    getClassOptionClass(type: string): string {
        if (!this.classAnswered()) return '';
        const current = this.currentClassWord();
        if (!current) return '';
        if (type === current.type) return 'correct';
        if (type === this.classSelected()) return 'incorrect';
        return '';
    }

    nextClassWord(): void {
        if (this.classIndex() >= this.classWords().length - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.classIndex.update(i => i + 1);
            this.classAnswered.set(false);
            this.classSelected.set('');
        }
    }

    // ═══ MODE: PAARE FINDEN ═══

    private startPairMatching(): void {
        const items = shuffle(this.allItems());
        const count = Math.min(items.length, 8 + Math.floor(Math.random() * 3)); // 8-10
        const selected = items.slice(0, count);
        const types: WordType[] = ['nomen', 'verb', 'adjektiv'];

        const pairs: PairItem[] = selected.map(item => {
            // Pick 2 random types for the pair
            const shuffledTypes = shuffle([...types]);
            const leftType = shuffledTypes[0];
            const rightType = shuffledTypes[1];

            const leftWords = item[leftType].split(',').map(w => w.trim());
            const rightWords = item[rightType].split(',').map(w => w.trim());

            return {
                id: item.id,
                left: leftWords[Math.floor(Math.random() * leftWords.length)],
                right: rightWords[Math.floor(Math.random() * rightWords.length)],
                leftType,
                rightType
            };
        });

        this.pairItems.set(pairs);
        this.leftColumn.set(shuffle(pairs.map(p => ({ word: p.left, pairId: p.id }))));
        this.rightColumn.set(shuffle(pairs.map(p => ({ word: p.right, pairId: p.id }))));
        this.selectedLeft.set(null);
        this.selectedRight.set(null);
        this.matchedPairs.set(new Set());
        this.wrongPair.set(false);
    }

    selectPairLeft(index: number): void {
        if (this.matchedPairs().has(this.leftColumn()[index].pairId)) return;
        this.selectedLeft.set(index);
        this.tryMatchPair();
    }

    selectPairRight(index: number): void {
        if (this.matchedPairs().has(this.rightColumn()[index].pairId)) return;
        this.selectedRight.set(index);
        this.tryMatchPair();
    }

    private tryMatchPair(): void {
        const leftIdx = this.selectedLeft();
        const rightIdx = this.selectedRight();
        if (leftIdx === null || rightIdx === null) return;

        const leftItem = this.leftColumn()[leftIdx];
        const rightItem = this.rightColumn()[rightIdx];

        if (leftItem.pairId === rightItem.pairId) {
            // Correct match
            const newMatched = new Set(this.matchedPairs());
            newMatched.add(leftItem.pairId);
            this.matchedPairs.set(newMatched);
            this.totalCorrect.update(c => c + 1);
            this.selectedLeft.set(null);
            this.selectedRight.set(null);

            // Check if all pairs matched
            if (newMatched.size >= this.pairItems().length) {
                // Small delay to show last match animation
                setTimeout(() => {
                    this.screen.set('results');
                    if (this.percentage() === 100) launchConfetti();
                }, 500);
            }
        } else {
            // Wrong match
            this.totalWrong.update(w => w + 1);
            this.wrongPair.set(true);
            if (this.wrongTimeout) clearTimeout(this.wrongTimeout);
            this.wrongTimeout = setTimeout(() => {
                this.wrongPair.set(false);
                this.selectedLeft.set(null);
                this.selectedRight.set(null);
            }, 600);
        }
    }

    getPairWordClass(column: 'left' | 'right', index: number): string {
        const item = column === 'left' ? this.leftColumn()[index] : this.rightColumn()[index];
        if (!item) return '';

        if (this.matchedPairs().has(item.pairId)) return 'matched';

        const isSelected = column === 'left'
            ? this.selectedLeft() === index
            : this.selectedRight() === index;

        if (isSelected && this.wrongPair()) return 'selected wrong';
        if (isSelected) return 'selected';
        return '';
    }

    getPairTypeLabel(column: 'left' | 'right'): string {
        if (this.pairItems().length === 0) return '';
        // All items in a column share the same type logic, but types vary per item.
        // Show a generic column label instead.
        return column === 'left' ? 'Wort A' : 'Wort B';
    }
}
