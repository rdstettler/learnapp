import { Component, signal, computed, inject, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';

interface Exercise {
    text: string;
}

interface WordPart {
    text: string;
    kasus: string | null;
    selected?: string;
    isCorrect?: boolean;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

@Component({
    selector: 'app-kasus',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './kasus.component.html',
    styleUrl: './kasus.component.css'
})
export class KasusComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly kasusOptions = ['Nominativ', 'Akkusativ', 'Dativ', 'Genitiv'];
    readonly kasusMap: Record<string, string> = {
        'N': 'Nominativ', 'A': 'Akkusativ', 'D': 'Dativ', 'G': 'Genitiv'
    };

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    exercises = signal<Exercise[]>([]);
    rounds = signal<Exercise[]>([]);
    currentRound = signal(0);

    parts = signal<WordPart[]>([]);
    showPopup = signal(false);
    popupWord = signal('');
    popupIndex = signal(-1);

    answered = signal(false);
    totalCorrect = signal(0);
    totalQuestions = signal(0);

    progress = computed(() => (this.currentRound() / 5) * 100);
    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadData<{ exercises: Exercise[] }>('kasus.json').subscribe({
            next: (data) => this.exercises.set(data.exercises),
            error: (err) => console.error('Error loading kasus data:', err)
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

    private parseText(text: string): WordPart[] {
        const parts: WordPart[] = [];
        const regex = /\[([NADG])\](.*?)\[\/\1\]/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ text: text.slice(lastIndex, match.index), kasus: null });
            }
            parts.push({ text: match[2], kasus: this.kasusMap[match[1]] });
            lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
            parts.push({ text: text.slice(lastIndex), kasus: null });
        }

        return parts;
    }

    startQuiz(): void {
        this.rounds.set(this.shuffle(this.exercises()).slice(0, 5));
        this.currentRound.set(0);
        this.totalCorrect.set(0);
        this.totalQuestions.set(0);
        this.screen.set('quiz');
        this.showRound();
    }

    private showRound(): void {
        const exercise = this.rounds()[this.currentRound()];
        const parsedParts = this.parseText(exercise.text);
        this.parts.set(parsedParts);
        this.totalQuestions.update(t => t + parsedParts.filter(p => p.kasus).length);
        this.answered.set(false);
    }

    openPopup(index: number): void {
        const part = this.parts()[index];
        if (!part.kasus || this.answered()) return;

        this.popupIndex.set(index);
        this.popupWord.set(part.text);
        this.showPopup.set(true);
    }

    selectKasus(kasus: string): void {
        const parts = [...this.parts()];
        const idx = this.popupIndex();
        if (idx >= 0) {
            parts[idx] = { ...parts[idx], selected: kasus };
            this.parts.set(parts);
        }
        this.showPopup.set(false);
    }

    closePopup(): void {
        this.showPopup.set(false);
    }

    canCheck(): boolean {
        return this.parts().filter(p => p.kasus).every(p => p.selected);
    }

    checkAnswers(): void {
        let correct = 0;
        const updatedParts = this.parts().map(p => {
            if (p.kasus) {
                const isCorrect = p.selected === p.kasus;
                if (isCorrect) correct++;
                return { ...p, isCorrect };
            }
            return p;
        });

        this.parts.set(updatedParts);
        this.totalCorrect.update(c => c + correct);
        this.answered.set(true);

        // Telemetry: Track errors
        const errors = updatedParts.filter(p => p.kasus && !p.isCorrect);
        if (errors.length > 0) {
            const content = JSON.stringify({
                round: this.currentRound(),
                originalText: this.rounds()[this.currentRound()].text,
                errors: errors.map(p => ({
                    text: p.text,
                    expected: p.kasus,
                    actual: p.selected
                }))
            });
            this.telemetryService.trackError('kasus', content, this.sessionId);
        }
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

    getKasusClass(kasus: string): string {
        const classes: Record<string, string> = {
            'Nominativ': 'nominativ', 'Akkusativ': 'akkusativ',
            'Dativ': 'dativ', 'Genitiv': 'genitiv'
        };
        return classes[kasus] || '';
    }
    @HostListener('window:keydown.enter', ['$event'])
    handleEnter(event: Event) {
        if (this.showPopup()) return; // Don't interfere if popup is open

        if (this.answered()) {
            this.nextRound();
        } else if (this.canCheck()) {
            this.checkAnswers();
        }
    }
}
