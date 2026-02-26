import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { DataService } from '../../services/data.service';
import { ApiService } from '../../services/api.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { ModeSelectorComponent } from "../../shared/components/mode-btn";
import { launchConfetti } from '../../shared/confetti';
import { shuffle } from '../../shared/utils/array.utils';

type QuizMode = 'luecken' | 'zuordnen';

interface LueckenContent {
    text: string;
    rule: string;
    // Internal parsing properties
    _contentId?: number;
    parsedParts?: { type: 'text' | 'slot', content?: string, options?: string[], correctIndex?: number }[];
}

interface ZuordnenContent {
    word: string;
    options: string[];
    correct: string;
    rule: string;
    _contentId?: number;
}

@Component({
    selector: 'app-rechtschreibung',
    standalone: true,
    imports: [LearningAppLayoutComponent, ModeSelectorComponent],
    templateUrl: './rechtschreibung.component.html',
    styleUrl: './rechtschreibung.component.css'
})
export class RechtschreibungComponent {
    private dataService = inject(DataService);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService);
    private telemetryService = inject(AppTelemetryService);

    readonly DEFAULT_ITEMS_PER_ROUND = 10;
    itemsPerRound = this.DEFAULT_ITEMS_PER_ROUND;

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'luecken', label: 'Lückentext', icon: '📝', description: 'Wähle die richtige Rechtschreibung im Satz.' },
        { id: 'zuordnen', label: 'Zuordnen', icon: '🧩', description: 'Welche Buchstaben fehlen im Wort?' }
    ];
    mode = signal<QuizMode>('luecken');

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');

    // Content signals
    allLuecken = signal<LueckenContent[]>([]);
    allZuordnen = signal<ZuordnenContent[]>([]);

    currentItems = signal<(LueckenContent | ZuordnenContent)[]>([]);
    currentIndex = signal(0);

    totalCorrect = signal(0);
    totalWrong = signal(0);

    // AI Session State
    isSessionMode = false;
    isPlanMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;
    planTaskIds: number[] | null = null;

    // Active Quiz State
    answered = signal(false);
    showPopup = signal(false);

    // state for luecken mode
    userChoiceLuecken = signal<string | null>(null);
    correctChoiceLuecken = signal<string | null>(null);
    lueckenOptions = signal<string[]>([]);

    // state for zuordnen mode
    userChoiceZuordnen = signal<string | null>(null);
    zuordnenOptions = signal<string[]>([]);

    progress = computed(() => (this.currentIndex() / this.itemsPerRound) * 100);
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    dataLoaded = computed(() => {
        if (this.mode() === 'luecken') return this.allLuecken().length > 0;
        if (this.mode() === 'zuordnen') return this.allZuordnen().length > 0;
        return false;
    });

    currentItem = computed(() => this.currentItems()[this.currentIndex()]);
    currentRule = computed(() => {
        const item = this.currentItem();
        return item ? item.rule : '';
    });

    getCurrentLuecken(): LueckenContent {
        return this.currentItem() as LueckenContent;
    }

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        const state = window.history.state as any;

        // 1. Check Router State (AI Session)
        if (state && state.learningContent && (state.sessionId || state.fromPlan)) {
            this.handleAISessionData(state);
            return;
        }

        // 2. Check for active AI session task via Service
        const sessionTask = this.apiService.getSessionTask('rechtschreibung');
        if (sessionTask) {
            this.handleAISessionData(sessionTask);
            return;
        }

        // 3. Fallback to Default Data
        this.loadDefaultData();
    }

    private handleAISessionData(taskData: any): void {
        this.isSessionMode = true;
        this.isPlanMode = !!taskData.fromPlan || !!taskData.planId;
        this.sessionTaskId = taskData.taskId || taskData.id;
        this.sessionTaskIds = taskData.taskIds;
        this.planTaskIds = taskData.planTaskIds;

        const content = taskData.learningContent || taskData.content;

        let loadedItems: any[] = [];
        if (Array.isArray(content)) {
            loadedItems = content;
        } else if (content && content.items) {
            loadedItems = content.items;
        } else if (content) {
            loadedItems = [content];
        }

        if (loadedItems.length > 0) {
            // Determine mode from the first item if provided, else use default mode of the task
            const sample = loadedItems[0];
            if (sample.options && sample.word) {
                this.mode.set('zuordnen');
                this.allZuordnen.set(loadedItems);
                this.itemsPerRound = loadedItems.length;
            } else {
                this.mode.set('luecken');
                this.allLuecken.set(this.parseLueckenItems(loadedItems));
                this.itemsPerRound = loadedItems.length;
            }
            this.startQuiz();
            return;
        }
    }

    private loadDefaultData(): void {
        this.dataService.loadAppContent<LueckenContent>('rechtschreibung', 'luecken').subscribe(data => {
            if (data) this.allLuecken.set(this.parseLueckenItems(data));
        });
        this.dataService.loadAppContent<ZuordnenContent>('rechtschreibung', 'zuordnen').subscribe(data => {
            if (data) this.allZuordnen.set(data);
        });
    }

    private parseLueckenItems(items: any[]): LueckenContent[] {
        return items.map(item => {
            const parsedParts = [];
            const text = item.text || '';
            const regex = /\[([^\]\/]+)\/([^\]]+)\]/g;
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            regex.lastIndex = 0;
            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    parsedParts.push({ type: 'text' as const, content: text.substring(lastIndex, match.index) });
                }

                let opt1 = match[1];
                let opt2 = match[2];
                let correctIndex = 0; // Default to first

                // Check for asterisk marking the correct option
                if (opt1.startsWith('*')) {
                    opt1 = opt1.substring(1);
                    correctIndex = 0;
                } else if (opt2.startsWith('*')) {
                    opt2 = opt2.substring(1);
                    correctIndex = 1;
                }

                parsedParts.push({
                    type: 'slot' as const,
                    options: [opt1, opt2],
                    correctIndex: correctIndex
                });
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < text.length) {
                parsedParts.push({ type: 'text' as const, content: text.substring(lastIndex) });
            }

            return { ...item, parsedParts };
        });
    }

    startQuiz(): void {
        let quizItems: any[];

        if (this.mode() === 'luecken') {
            quizItems = this.isSessionMode ? [...this.allLuecken()] : shuffle(this.allLuecken()).slice(0, this.itemsPerRound);
        } else {
            quizItems = this.isSessionMode ? [...this.allZuordnen()] : shuffle(this.allZuordnen()).slice(0, this.itemsPerRound);
        }

        this.itemsPerRound = quizItems.length;
        this.currentItems.set(quizItems);
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
        this.showItem();
    }

    private showItem(): void {
        this.answered.set(false);
        this.showPopup.set(false);

        const item = this.currentItem();

        if (this.mode() === 'luecken') {
            this.userChoiceLuecken.set(null);
            this.correctChoiceLuecken.set(null);
        } else if (this.mode() === 'zuordnen') {
            this.userChoiceZuordnen.set(null);
            const zItem = item as ZuordnenContent;
            this.zuordnenOptions.set(shuffle([...zItem.options]));
        }

        this.cdr.markForCheck();
    }

    // --- Lückentext Mode Logic ---

    openLueckenPopup(options: string[], correctIndex: number): void {
        if (this.answered()) return;
        this.lueckenOptions.set(shuffle([...options]));
        this.correctChoiceLuecken.set(options[correctIndex]);
        this.showPopup.set(true);
    }

    selectLueckenChoice(choice: string): void {
        this.userChoiceLuecken.set(choice);
        this.showPopup.set(false);
        this.checkLueckenAnswer();
    }

    private checkLueckenAnswer(): void {
        const userChoice = this.userChoiceLuecken();
        const correctChoice = this.correctChoiceLuecken();
        const isCorrect = userChoice === correctChoice;

        if (isCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);
        }

        this.answered.set(true);
        this.trackProgress(isCorrect);
    }

    getSlotDisplay(part: any): string {
        if (this.answered() && this.userChoiceLuecken()) {
            const isCorrect = this.userChoiceLuecken() === this.correctChoiceLuecken();
            if (isCorrect) return this.userChoiceLuecken() as string;
            return `${this.userChoiceLuecken()} → ${this.correctChoiceLuecken()}`;
        }
        return this.userChoiceLuecken() || '?';
    }

    getSlotClass(part: any): string {
        if (!this.answered()) return this.userChoiceLuecken() ? 'selected' : '';
        const isCorrect = this.userChoiceLuecken() === this.correctChoiceLuecken();
        return isCorrect ? 'correct' : 'incorrect';
    }

    // --- Zuordnen Mode Logic ---

    selectZuordnenChoice(choice: string): void {
        if (this.answered()) return;
        this.userChoiceZuordnen.set(choice);
        this.checkZuordnenAnswer();
    }

    private checkZuordnenAnswer(): void {
        const item = this.currentItem() as ZuordnenContent;
        const isCorrect = this.userChoiceZuordnen() === item.correct;

        if (isCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);
        }

        this.answered.set(true);
        this.trackProgress(isCorrect);
    }

    getZuordnenOptionClass(option: string): string {
        if (!this.answered()) return '';

        const item = this.currentItem() as ZuordnenContent;
        const isSelected = option === this.userChoiceZuordnen();
        const isCorrectOption = option === item.correct;

        if (isCorrectOption) return 'correct';
        if (isSelected && !isCorrectOption) return 'incorrect';
        return 'missed'; // For dimming the ones that weren't selected
    }

    getZuordnenWordDisplay(): string {
        const item = this.currentItem() as ZuordnenContent;
        const choice = this.userChoiceZuordnen();
        if (this.answered() && choice) {
            return item.word.replace('__', `<span class="${choice === item.correct ? 'word-slot correct' : 'word-slot incorrect'}">${choice}</span>`);
        }
        return item.word.replace('__', '<span class="word-slot empty">_</span>');
    }

    // --- Shared Nav ---

    private trackProgress(isCorrect: boolean): void {
        const item = this.currentItem() as any;
        if (item && item._contentId) {
            this.telemetryService.trackProgress('rechtschreibung', item._contentId, isCorrect, this.mode());
        }
    }

    nextItem(): void {
        if (this.currentIndex() >= this.itemsPerRound - 1) {
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
            this.currentIndex.update(i => i + 1);
            this.showItem();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
