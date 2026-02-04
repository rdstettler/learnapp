import { Component, signal, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';

interface Composite {
    word: string;
    exists: boolean;
}

interface MeaningOption {
    option: string;
    correct: boolean;
}

interface Stem {
    stem: string;
    composites: Composite[];
    meanings: Record<string, MeaningOption[]>;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

@Component({
    selector: 'app-wortstaemme',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './wortstaemme.component.html',
    styleUrl: './wortstaemme.component.css'
})
export class WortstaemmeComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    screen = signal<'welcome' | 'stage1' | 'results1' | 'stage2' | 'results2' | 'final'>('welcome');
    stems = signal<Stem[]>([]);
    currentStem = signal<Stem | null>(null);
    selectedStemValue = signal('');

    stage1Selections = signal<Set<string>>(new Set());
    stage1Results = signal<{ word: string; type: string }[]>([]);

    existingWords = signal<string[]>([]);
    currentWordIndex = signal(0);
    stage2Selections = signal<Set<number>>(new Set());
    stage2Results = signal<{ option: string; type: string }[]>([]);

    totalCorrect = signal(0);
    totalQuestions = signal(0);

    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentMeaningWord = computed(() => this.existingWords()[this.currentWordIndex()] || '');
    currentMeanings = computed(() => {
        const stem = this.currentStem();
        const word = this.currentMeaningWord();
        return stem?.meanings[word] || [];
    });

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<Stem>('wortstaemme').subscribe({
            next: (data) => this.stems.set(data),
            error: (err) => console.error('Error loading wortstaemme data:', err)
        });
    }

    selectStem(event: Event): void {
        this.selectedStemValue.set((event.target as HTMLSelectElement).value);
    }

    startQuiz(): void {
        const stem = this.stems().find(s => s.stem === this.selectedStemValue());
        if (!stem) return;

        this.currentStem.set(stem);
        this.stage1Selections.set(new Set());
        this.totalCorrect.set(0);
        this.totalQuestions.set(0);
        this.screen.set('stage1');
    }

    toggleStage1Selection(word: string): void {
        const selections = new Set(this.stage1Selections());
        if (selections.has(word)) {
            selections.delete(word);
        } else {
            selections.add(word);
        }
        this.stage1Selections.set(selections);
    }

    checkStage1(): void {
        const stem = this.currentStem();
        if (!stem) return;

        const selections = this.stage1Selections();
        const results: { word: string; type: string }[] = [];
        let correct = 0;

        stem.composites.forEach(c => {
            const selected = selections.has(c.word);
            let type: string;

            if (selected && c.exists) {
                type = 'true-positive';
                correct++;
            } else if (selected && !c.exists) {
                type = 'false-positive';
            } else if (!selected && c.exists) {
                type = 'false-negative';
            } else {
                type = 'true-negative';
                correct++;
            }

            results.push({ word: c.word, type });
        });

        this.stage1Results.set(results);
        this.totalCorrect.update(c => c + correct);
        this.totalQuestions.update(t => t + stem.composites.length);

        // Telemetry: Track errors (Stage 1)
        const errors = results.filter(r => r.type === 'false-positive' || r.type === 'false-negative');
        if (errors.length > 0) {
            const content = JSON.stringify({
                stage: 1,
                stem: stem.stem,
                errors: errors
            });
            this.telemetryService.trackError('wortstaemme', content, this.sessionId);
        }

        // Find existing words that have meanings
        const existing = stem.composites
            .filter(c => c.exists)
            .map(c => c.word.replace(/-/g, ''))
            .filter(word => stem.meanings[word]);

        this.existingWords.set(existing);
        this.screen.set('results1');
    }

    continueToStage2(): void {
        this.currentWordIndex.set(0);
        this.stage2Selections.set(new Set());
        this.screen.set('stage2');
    }

    toggleStage2Selection(index: number): void {
        const selections = new Set(this.stage2Selections());
        if (selections.has(index)) {
            selections.delete(index);
        } else {
            selections.add(index);
        }
        this.stage2Selections.set(selections);
    }

    checkStage2(): void {
        const meanings = this.currentMeanings();
        const selections = this.stage2Selections();
        const results: { option: string; type: string }[] = [];
        let correct = 0;

        meanings.forEach((m, i) => {
            const selected = selections.has(i);
            let type: string;

            if (selected && m.correct) {
                type = 'true-positive';
                correct++;
            } else if (selected && !m.correct) {
                type = 'false-positive';
            } else if (!selected && m.correct) {
                type = 'false-negative';
            } else {
                type = 'true-negative';
                correct++;
            }

            results.push({ option: m.option, type });
        });

        this.stage2Results.set(results);
        this.totalCorrect.update(c => c + correct);
        this.totalQuestions.update(t => t + meanings.length);

        // Telemetry: Track errors (Stage 2)
        const errors = results.filter(r => r.type === 'false-positive' || r.type === 'false-negative');
        if (errors.length > 0) {
            const content = JSON.stringify({
                stage: 2,
                stem: this.currentStem()?.stem,
                word: this.currentMeaningWord(),
                errors: errors
            });
            this.telemetryService.trackError('wortstaemme', content, this.sessionId);
        }
        this.screen.set('results2');
    }

    continueAfterResults2(): void {
        if (this.currentWordIndex() >= this.existingWords().length - 1) {
            this.screen.set('final');
        } else {
            this.currentWordIndex.update(i => i + 1);
            this.stage2Selections.set(new Set());
            this.screen.set('stage2');
        }
    }

    restartQuiz(): void {
        this.selectedStemValue.set('');
        this.screen.set('welcome');
    }

    getResultIcon(type: string): string {
        switch (type) {
            case 'true-positive': return '✓';
            case 'false-positive': return '✗';
            case 'false-negative': return '!';
            default: return '–';
        }
    }

    getResultLabel(type: string): string {
        switch (type) {
            case 'true-positive': return 'Richtig';
            case 'false-positive': return 'Falsch';
            case 'false-negative': return 'Übersehen';
            default: return 'Korrekt';
        }
    }
}
