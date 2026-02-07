import { Component, signal, computed, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { ApiService } from '../../services/api.service';
import { shuffle } from '../../shared/utils/array.utils';

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
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

@Component({
    selector: 'app-kasus',
    standalone: true,
    imports: [RouterLink, LearningAppLayoutComponent],
    templateUrl: './kasus.component.html',
    styleUrl: './kasus.component.css',
    host: {
        '(window:keydown.enter)': 'handleEnter($event)'
    }
})
export class KasusComponent {
    private dataService = inject(DataService);
    private apiService = inject(ApiService);
    private router = inject(Router);
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

    // AI Session State
    isSessionMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;

    parts = signal<WordPart[]>([]);
    showPopup = signal(false);
    popupWord = signal('');
    popupIndex = signal(-1);

    answered = signal(false);
    totalCorrect = signal(0);
    totalQuestions = signal(0);

    progress = computed(() => (this.currentRound() / this.rounds().length) * 100);
    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    constructor() {
        this.loadData();
    }

    // ...

    private loadData(): void {
        console.log('Kasus loadData: Checking for session content...');
        // 1. Check Router State
        const state = window.history.state as any;
        if (state && state.learningContent && state.sessionId) {
            console.log("Loading AI Session Content from Router State", state.learningContent);
            this.isSessionMode = true;
            this.sessionTaskId = state.taskId;
            this.sessionTaskIds = state.taskIds;

            // ...

            let content: Exercise[] = [];
            if (Array.isArray(state.learningContent.sentences)) {
                content = state.learningContent.sentences.map((s: string) => ({ text: s }));
            } else if (typeof state.learningContent.originalText === 'string') {
                content = [{ text: state.learningContent.originalText }];
            }

            if (content.length > 0) {
                this.exercises.set(content);
                // Auto-start or wait? Let's verify data loaded
                return;
            }
        }

        // 2. Fallback ApiService
        const sessionTask = this.apiService.getSessionTask('kasus');
        if (sessionTask) {
            console.log("Loading AI Session Content from ApiService", sessionTask);
            this.isSessionMode = true;
            this.sessionTaskId = sessionTask.id;

            let content: Exercise[] = [];
            if (sessionTask.content && Array.isArray(sessionTask.content.sentences)) {
                content = sessionTask.content.sentences.map((s: string) => ({ text: s }));
            }
            if (content.length > 0) {
                this.exercises.set(content);
                return;
            }
        }

        // 3. Default
        this.dataService.loadAppContent<Exercise>('kasus').subscribe({
            next: (data) => this.exercises.set(data),
            error: (err) => console.error('Error loading kasus data:', err)
        });
    }

    // ... shuffle ...
    private shuffle<T>(array: T[]): T[] {
        return shuffle(array);
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
        let quizRounds: Exercise[];
        if (this.isSessionMode) {
            quizRounds = [...this.exercises()];
        } else {
            quizRounds = this.shuffle(this.exercises()).slice(0, 5);
        }
        this.rounds.set(quizRounds);
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
        if (this.currentRound() >= this.rounds().length - 1) {
            if (this.isSessionMode) {
                if (this.sessionTaskIds && this.sessionTaskIds.length > 0) {
                    this.apiService.completeTask(this.sessionTaskIds);
                } else if (this.sessionTaskId) {
                    this.apiService.completeTask(this.sessionTaskId);
                }
            }
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
    handleEnter(event: Event) {
        if (this.showPopup()) return; // Don't interfere if popup is open

        if (this.answered()) {
            this.nextRound();
        } else if (this.canCheck()) {
            this.checkAnswers();
        }
    }
}
