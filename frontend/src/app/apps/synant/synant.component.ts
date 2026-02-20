import { Component, signal, computed, inject } from '@angular/core';
import { shuffle } from '../../shared/utils/array.utils';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

interface SynAntGroup {
    strong: string[];
    weak: string[];
}

interface SynAntPair {
    firstGroup: SynAntGroup;
    secondGroup: SynAntGroup;
}

type QuizMode = 'spion' | 'schwach' | 'syn-paare' | 'ant-paare';

interface PairMatchItem {
    id: number;
    left: string;
    right: string;
}

interface QuizRound {
    /** All words displayed (shuffled mix of synonyms + spies or strong + weak) */
    words: string[];
    /** The "spy" / "wrong" words the user must find */
    targets: string[];
    /** Content ID for telemetry */
    contentId?: number;
}

@Component({
    selector: 'app-synant',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './synant.component.html',
    styleUrl: './synant.component.css',
    host: {
        '(window:keydown.enter)': 'handleEnter()'
    }
})
export class SynantComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);


    readonly ROUNDS_PER_GAME = 10;

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'spion', label: 'Spion finden', icon: '🕵️', description: 'Finde die Antonyme unter den Synonymen!' },
        { id: 'schwach', label: 'Schwächstes Synonym', icon: '🎯', description: 'Welches Wort passt am wenigsten?' },
        { id: 'syn-paare', label: 'Synonym-Paare', icon: '🔗', description: 'Verbinde Synonyme aus der gleichen Gruppe.' },
        { id: 'ant-paare', label: 'Antonym-Paare', icon: '⚡', description: 'Verbinde Wörter mit ihren Gegenteilen.' }
    ];

    mode = signal<QuizMode>('spion');
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');

    allPairs = signal<(SynAntPair & { _contentId?: number })[]>([]);
    rounds = signal<QuizRound[]>([]);
    currentIndex = signal(0);

    /** Words the user has marked as "spy" in the current round */
    markedWords = signal<Set<string>>(new Set());
    answered = signal(false);

    // Pair-matching mode
    pairItems = signal<PairMatchItem[]>([]);
    leftColumn = signal<{ word: string; pairId: number }[]>([]);
    rightColumn = signal<{ word: string; pairId: number }[]>([]);
    selectedLeft = signal<number | null>(null);
    selectedRight = signal<number | null>(null);
    matchedPairs = signal<Set<number>>(new Set());
    wrongPair = signal(false);
    private wrongTimeout: any = null;

    totalCorrect = signal(0);
    totalWrong = signal(0);

    progress = computed(() => {
        if (this.mode() === 'syn-paare' || this.mode() === 'ant-paare') {
            const total = this.pairItems().length;
            return total > 0 ? (this.matchedPairs().size / total) * 100 : 0;
        }
        return (this.currentIndex() / this.ROUNDS_PER_GAME) * 100;
    });
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentRound = computed(() => this.rounds()[this.currentIndex()]);
    dataLoaded = computed(() => this.allPairs().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<SynAntPair>('synant').subscribe({
            next: (data) => this.allPairs.set(data),
            error: (err) => console.error('Error loading synant data:', err)
        });
    }

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');

        if (this.mode() === 'syn-paare' || this.mode() === 'ant-paare') {
            this.startPairMatching();
            return;
        }

        const pairs = shuffle(this.allPairs());
        const selected = pairs.slice(0, this.ROUNDS_PER_GAME);

        const rounds: QuizRound[] = selected.map(pair => {
            if (this.mode() === 'spion') {
                return this.buildSpionRound(pair);
            } else {
                return this.buildSchwachRound(pair);
            }
        });

        this.rounds.set(rounds);
        this.currentIndex.set(0);
        this.resetRound();
    }

    private buildSpionRound(pair: SynAntPair & { _contentId?: number }): QuizRound {
        // Pick 3 strong synonyms from firstGroup
        const synonyms = shuffle(pair.firstGroup.strong).slice(0, 3);

        // Pick 1–2 antonyms (spies) from secondGroup strong
        const spyCount = Math.random() < 0.5 ? 1 : 2;
        const spies = shuffle(pair.secondGroup.strong).slice(0, spyCount);

        return {
            words: shuffle([...synonyms, ...spies]),
            targets: spies,
            contentId: pair._contentId
        };
    }

    private buildSchwachRound(pair: SynAntPair & { _contentId?: number }): QuizRound {
        // Pick 3 strong words from firstGroup
        const strongWords = shuffle(pair.firstGroup.strong).slice(0, 3);

        // Pick 1 weak word from firstGroup
        const weakWord = shuffle(pair.firstGroup.weak)[0];

        return {
            words: shuffle([...strongWords, weakWord]),
            targets: [weakWord],
            contentId: pair._contentId
        };
    }

    private resetRound(): void {
        this.markedWords.set(new Set());
        this.answered.set(false);
    }

    toggleWord(word: string): void {
        if (this.answered()) return;

        const current = new Set(this.markedWords());
        if (current.has(word)) {
            current.delete(word);
        } else {
            current.add(word);
        }
        this.markedWords.set(current);
    }

    isMarked(word: string): boolean {
        return this.markedWords().has(word);
    }

    get hasSelection(): boolean {
        return this.markedWords().size > 0;
    }

    checkAnswer(): void {
        const round = this.currentRound();
        if (!round) return;

        const marked = this.markedWords();
        const targets = new Set(round.targets);

        // Correct if: marked exactly the target words
        const allTargetsMarked = round.targets.every(t => marked.has(t));
        const noExtrasMarked = [...marked].every(m => targets.has(m));
        const isCorrect = allTargetsMarked && noExtrasMarked;

        if (isCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(w => w + 1);
        }

        this.answered.set(true);

        // Telemetry
        if (round.contentId) {
            this.telemetryService.trackProgress('synant', round.contentId, isCorrect, this.mode());
        }
    }

    getWordClass(word: string): string {
        if (!this.answered()) {
            return this.isMarked(word) ? 'marked' : '';
        }

        const round = this.currentRound();
        if (!round) return '';

        const isTarget = round.targets.includes(word);
        const wasMarked = this.isMarked(word);

        if (isTarget && wasMarked) return 'correct-target';   // Correctly identified spy
        if (isTarget && !wasMarked) return 'missed-target';   // Missed spy
        if (!isTarget && wasMarked) return 'wrong-mark';      // Incorrectly marked a friend
        return 'safe-friend';                                  // Correctly left alone
    }

    isRoundCorrect(): boolean {
        const round = this.currentRound();
        if (!round) return false;
        const marked = this.markedWords();
        const targets = new Set(round.targets);
        return round.targets.every(t => marked.has(t)) && [...marked].every(m => targets.has(m));
    }

    nextRound(): void {
        const nextIndex = this.currentIndex() + 1;

        if (nextIndex >= this.ROUNDS_PER_GAME) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentIndex.set(nextIndex);
            this.resetRound();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    playAgain(): void {
        this.startQuiz();
    }

    handleEnter(): void {
        if (this.screen() !== 'quiz') return;
        if (this.mode() === 'syn-paare' || this.mode() === 'ant-paare') return;
        if (this.answered()) {
            this.nextRound();
        } else if (this.hasSelection) {
            this.checkAnswer();
        }
    }

    getModeLabel(): string {
        return this.mode() === 'spion'
            ? 'Finde die Spione (Antonyme)!'
            : 'Welches Wort passt am wenigsten?';
    }

    getTargetCount(): number {
        return this.currentRound()?.targets.length ?? 0;
    }

    // ═══ MODE: PAARE FINDEN ═══

    private startPairMatching(): void {
        const allData = shuffle(this.allPairs());
        const count = Math.min(allData.length, 8 + Math.floor(Math.random() * 3)); // 8-10
        const selected = allData.slice(0, count);

        const pairs: PairMatchItem[] = selected.map((pair, idx) => {
            if (this.mode() === 'syn-paare') {
                // Synonym pairs: one strong word from firstGroup, one from weak or another strong
                const leftWord = shuffle(pair.firstGroup.strong)[0];
                // Use a different strong synonym or weak synonym as the match
                const candidates = [
                    ...pair.firstGroup.strong.filter(w => w !== leftWord),
                    ...pair.firstGroup.weak
                ];
                const rightWord = shuffle(candidates)[0] || pair.firstGroup.strong[0];
                return { id: idx, left: leftWord, right: rightWord };
            } else {
                // Antonym pairs: one word from firstGroup, one from secondGroup
                const leftWord = shuffle([...pair.firstGroup.strong, ...pair.firstGroup.weak])[0];
                const rightWord = shuffle([...pair.secondGroup.strong, ...pair.secondGroup.weak])[0];
                return { id: idx, left: leftWord, right: rightWord };
            }
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
            const newMatched = new Set(this.matchedPairs());
            newMatched.add(leftItem.pairId);
            this.matchedPairs.set(newMatched);
            this.totalCorrect.update(c => c + 1);
            this.selectedLeft.set(null);
            this.selectedRight.set(null);

            if (newMatched.size >= this.pairItems().length) {
                setTimeout(() => {
                    this.screen.set('results');
                    if (this.percentage() === 100) launchConfetti();
                }, 500);
            }
        } else {
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
}
