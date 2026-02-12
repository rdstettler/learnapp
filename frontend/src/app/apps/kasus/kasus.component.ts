import { Component, signal, computed, inject } from '@angular/core';
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

type QuizMode = 'klassisch' | 'schnell';

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

@Component({
    selector: 'app-kasus',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './kasus.component.html',
    styleUrl: './kasus.component.css',
    host: {
        '(window:keydown.enter)': 'handleEnter($event)'
    }
})
export class KasusComponent {
    private dataService = inject(DataService);
    private apiService = inject(ApiService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly kasusOptions = ['Nominativ', 'Akkusativ', 'Dativ', 'Genitiv'];
    readonly kasusMap: Record<string, string> = {
        'N': 'Nominativ', 'A': 'Akkusativ', 'D': 'Dativ', 'G': 'Genitiv'
    };

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'klassisch', label: 'Klassisch', icon: '📖', description: 'Alle Wörter eines Satzes zuordnen.' },
        { id: 'schnell', label: 'Speed Drill', icon: '⚡', description: 'Ein Wort nach dem anderen – schnell entscheiden!' }
    ];

    mode = signal<QuizMode>('klassisch');
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    exercises = signal<Exercise[]>([]);
    rounds = signal<Exercise[]>([]);
    currentRound = signal(0);

    // AI Session / Plan State
    isSessionMode = false;
    isPlanMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;
    planTaskIds: number[] | null = null;

    parts = signal<WordPart[]>([]);
    showPopup = signal(false);
    popupWord = signal('');
    popupIndex = signal(-1);

    answered = signal(false);
    totalCorrect = signal(0);
    totalQuestions = signal(0);

    // Speed Drill mode
    drillParts = signal<{ text: string; kasus: string; context: string }[]>([]);
    drillIndex = signal(0);
    drillAnswered = signal(false);
    drillSelected = signal('');
    drillIsCorrect = signal(false);

    progress = computed(() => {
        if (this.mode() === 'schnell') {
            const total = this.drillParts().length;
            return total > 0 ? (this.drillIndex() / total) * 100 : 0;
        }
        return (this.currentRound() / this.rounds().length) * 100;
    });
    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    constructor() {
        this.loadData();
    }

    // ...

    private loadData(): void {
        // 1. Check Router State
        const state = window.history.state as any;
        if (state && state.learningContent && (state.sessionId || state.fromPlan)) {
            this.isSessionMode = true;
            this.isPlanMode = !!state.fromPlan;
            this.sessionTaskId = state.taskId;
            this.sessionTaskIds = state.taskIds;
            this.planTaskIds = state.planTaskIds;

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
            this.isSessionMode = true;
            this.sessionTaskId = sessionTask.id;

            let content: Exercise[] = [];
            if (sessionTask.content && Array.isArray(sessionTask.content['sentences'])) {
                content = (sessionTask.content['sentences'] as string[]).map((s: string) => ({ text: s }));
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

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        let quizRounds: Exercise[];
        if (this.isSessionMode) {
            quizRounds = [...this.exercises()];
        } else {
            quizRounds = shuffle(this.exercises()).slice(0, 5);
        }
        this.rounds.set(quizRounds);
        this.currentRound.set(0);
        this.totalCorrect.set(0);
        this.totalQuestions.set(0);
        this.screen.set('quiz');

        if (this.mode() === 'schnell' && !this.isSessionMode) {
            this.startDrill(quizRounds);
        } else {
            this.showRound();
        }
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

        // Track per-content progress
        const exercise = this.rounds()[this.currentRound()] as any;
        if (exercise?._contentId) {
            const totalSlots = this.parts().filter(p => p.kasus).length;
            this.telemetryService.trackProgress('kasus', exercise._contentId, correct === totalSlots, this.mode());
        }
    }

    nextRound(): void {
        if (this.currentRound() >= this.rounds().length - 1) {
            if (this.isSessionMode) {
                if (this.isPlanMode && this.planTaskIds && this.planTaskIds.length > 0) {
                    this.apiService.completePlanTask(this.planTaskIds);
                } else if (this.sessionTaskIds && this.sessionTaskIds.length > 0) {
                    this.apiService.completeTask(this.sessionTaskIds);
                } else if (this.sessionTaskId) {
                    this.apiService.completeTask(this.sessionTaskId);
                }
            }
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
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
        if (this.showPopup()) return;
        if (this.mode() === 'schnell') {
            if (this.drillAnswered()) this.nextDrill();
            return;
        }
        if (this.answered()) {
            this.nextRound();
        } else if (this.canCheck()) {
            this.checkAnswers();
        }
    }

    // ═══ MODE: SPEED DRILL ═══

    private startDrill(exercises: Exercise[]): void {
        const allParts: { text: string; kasus: string; context: string }[] = [];
        for (const ex of exercises) {
            const parsed = this.parseText(ex.text);
            const contextText = parsed.map(p => p.text).join('');
            for (const p of parsed) {
                if (p.kasus) {
                    allParts.push({ text: p.text, kasus: p.kasus, context: contextText });
                }
            }
        }
        this.drillParts.set(shuffle(allParts));
        this.drillIndex.set(0);
        this.totalQuestions.set(allParts.length);
        this.drillAnswered.set(false);
        this.drillSelected.set('');
    }

    currentDrillPart = computed(() => this.drillParts()[this.drillIndex()]);

    selectDrillKasus(kasus: string): void {
        if (this.drillAnswered()) return;
        const part = this.currentDrillPart();
        if (!part) return;
        const isCorrect = kasus === part.kasus;
        this.drillSelected.set(kasus);
        this.drillIsCorrect.set(isCorrect);
        this.drillAnswered.set(true);
        if (isCorrect) this.totalCorrect.update(c => c + 1);
    }

    getDrillOptionClass(kasus: string): string {
        if (!this.drillAnswered()) return '';
        const part = this.currentDrillPart();
        if (!part) return '';
        if (kasus === part.kasus) return 'correct';
        if (kasus === this.drillSelected()) return 'incorrect';
        return '';
    }

    nextDrill(): void {
        if (this.drillIndex() >= this.drillParts().length - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.drillIndex.update(i => i + 1);
            this.drillAnswered.set(false);
            this.drillSelected.set('');
        }
    }
}
