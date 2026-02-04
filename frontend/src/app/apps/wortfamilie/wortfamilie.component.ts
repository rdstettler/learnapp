import { Component, signal, computed, inject, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';

interface WortfamilieItem {
    id: number;
    nomen: string;    // Kommagetrennte mögliche Antworten
    verb: string;     // Kommagetrennte mögliche Antworten
    adjektiv: string; // Kommagetrennte mögliche Antworten
}

type WordType = 'nomen' | 'verb' | 'adjektiv';

interface Problem {
    item: WortfamilieItem;
    givenType: WordType;
    givenWord: string;
    missingTypes: WordType[];
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

@Component({
    selector: 'app-wortfamilie',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './wortfamilie.component.html',
    styleUrl: './wortfamilie.component.css'
})
export class WortfamilieComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly PROBLEMS_PER_ROUND = 10;
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

    progress = computed(() => (this.currentIndex() / this.PROBLEMS_PER_ROUND) * 100);
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
        this.dataService.loadData<{ items: WortfamilieItem[] }>('wortfamilie.json').subscribe({
            next: (data) => this.allItems.set(data.items),
            error: (err) => console.error('Error loading wortfamilie data:', err)
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
        const shuffled = this.shuffle(this.allItems());
        const selected = shuffled.slice(0, this.PROBLEMS_PER_ROUND);

        // Erstelle Probleme mit zufällig gegebenem Worttyp
        const problems: Problem[] = selected.map(item => {
            const types: WordType[] = ['nomen', 'verb', 'adjektiv'];
            const givenType = types[Math.floor(Math.random() * types.length)];

            // Wähle ein zufälliges Wort aus dem gegebenen Typ
            const words = item[givenType].split(',').map(w => w.trim());
            const givenWord = words[Math.floor(Math.random() * words.length)];

            const missingTypes = types.filter(t => t !== givenType);

            return { item, givenType, givenWord, missingTypes };
        });

        this.problems.set(problems);
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
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

        // Telemetry: Track errors
        const errors = Object.keys(newResults).filter(type => {
            const t = type as WordType;
            return !newResults[t].correct && problem.missingTypes.includes(t);
        }).map(type => {
            const t = type as WordType;
            return {
                type: t,
                expected: newResults[t].matched, // This holds the expected word for wrong answers
                actual: this.userAnswers()[t]
            };
        });

        if (errors.length > 0) {
            const content = JSON.stringify({
                itemId: problem.item.id,
                errors: errors
            });
            this.telemetryService.trackError('wortfamilie', content, this.sessionId);
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

        // Normalisiere Umlaute
        return normalized
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss');
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

    @HostListener('window:keydown.enter', ['$event'])
    handleEnter(event: Event) {
        if (this.answered()) {
            this.nextProblem();
        } else if (this.canCheck()) {
            this.checkAnswers();
        }
    }
}
