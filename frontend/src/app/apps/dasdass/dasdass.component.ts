import { Component, signal, computed, inject, ChangeDetectorRef, SecurityContext } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DataService } from '../../services/data.service';
import { ApiService } from '../../services/api.service';

interface TextItem {
    id: number;
    sentences: string;
}

interface SlotData {
    correct: string;
    capitalize: boolean;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

@Component({
    selector: 'app-dasdass',
    standalone: true,
    imports: [RouterLink, LearningAppLayoutComponent],
    templateUrl: './dasdass.component.html',
    styleUrl: './dasdass.component.css'
})
export class DasdassComponent {
    private dataService = inject(DataService);
    private sanitizer = inject(DomSanitizer);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService); // Public so we can bind to it if needed
    private router = inject(Router);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    private quizStartTime = 0;

    readonly DEFAULT_TEXTS_PER_ROUND = 10;
    textsPerRound = this.DEFAULT_TEXTS_PER_ROUND;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    texts = signal<TextItem[]>([]);
    allTexts = signal<TextItem[]>([]);
    currentTextIndex = signal(0);
    totalCorrect = signal(0);
    totalWrong = signal(0);

    userChoices: Record<number, string> = {};
    slotData: Record<number, SlotData> = {};
    answered = signal(false);
    showPopup = signal(false);
    currentSlotIndex = signal<number | null>(null);

    // AI Session State
    isSessionMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;

    // Store all text results for AI analysis
    allTextResults: { text: string; textId: number; answers: { correct: string; userAnswer: string | null; isCorrect: boolean }[] }[] = [];

    progress = computed(() => (this.currentTextIndex() / this.textsPerRound) * 100);
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    dataLoaded = computed(() => this.allTexts().length > 0);
    currentText = computed(() => this.texts()[this.currentTextIndex()]);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        console.log('DasDass loadData: Checking for session content...');
        const state = window.history.state as any;
        console.log('Router State:', state);

        // 1. Check Router State
        if (state && state.learningContent && state.sessionId) {
            console.log("Loading AI Session Content from Router State", state.learningContent);
            this.isSessionMode = true;
            this.sessionTaskId = state.taskId;
            this.sessionTaskIds = state.taskIds; // Capture grouped IDs

            if (state.learningContent && Array.isArray(state.learningContent.sentences)) {
                const aiTexts: TextItem[] = state.learningContent.sentences.map((s: string, index: number) => ({
                    id: 1000 + index,
                    sentences: s
                }));
                this.allTexts.set(aiTexts);
                this.textsPerRound = aiTexts.length;
                this.startQuiz();
                return;
            } else if (state.learningContent && typeof state.learningContent.originalText === 'string') {
                const aiTexts: TextItem[] = [{
                    id: 1000,
                    sentences: state.learningContent.originalText
                }];
                this.allTexts.set(aiTexts);
                this.textsPerRound = aiTexts.length;
                this.startQuiz();
                return;
            }
        }

        // 2. Check for active AI session task via Service
        const sessionTask = this.apiService.getSessionTask('dasdass');

        if (sessionTask) {
            console.log("Loading AI Session Content from ApiService", sessionTask);
            this.isSessionMode = true;
            this.sessionTaskId = sessionTask.id;
            // Note: taskIds usually come from router state, but if we loaded from service, we might rely on single ID.

            let aiTexts: TextItem[] = [];

            // Case A: AI returned 'sentences' array
            if (sessionTask.content && Array.isArray(sessionTask.content.sentences)) {
                aiTexts = sessionTask.content.sentences.map((s: string, index: number) => ({
                    id: 1000 + index,
                    sentences: s
                }));
            }
            // Case B: AI returned 'originalText'
            else if (sessionTask.content && typeof sessionTask.content.originalText === 'string') {
                aiTexts = [{
                    id: 1000,
                    sentences: sessionTask.content.originalText
                }];
            }

            if (aiTexts.length > 0) {
                this.allTexts.set(aiTexts);
                this.textsPerRound = aiTexts.length;
                this.startQuiz();
                return;
            }
        }

        // 3. Fallback to Default Data
        this.dataService.loadAppContent<TextItem>('dasdass').subscribe(data => {
            this.allTexts.set(data);
            this.startQuiz();
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
        let quizTexts: TextItem[];

        if (this.isSessionMode) {
            // In session mode, use texts exactly as given (no shuffle, no slice if exact match desired)
            // But maybe shuffle is fine? User said "load the questions from the session".
            // Let's keep them in order provided by AI just to be safe, or shuffle?
            // "not arbitrary ones" implies the set is fixed. Order matters less.
            // But let's just use all of them.
            quizTexts = [...this.allTexts()];
        } else {
            const shuffled = this.shuffle(this.allTexts());
            quizTexts = shuffled.slice(0, this.textsPerRound);
        }

        this.texts.set(quizTexts);
        this.currentTextIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.allTextResults = [];
        this.quizStartTime = Date.now();
        this.screen.set('quiz');
        this.showText();
    }

    private showText(): void {
        this.userChoices = {};
        this.slotData = {};
        this.answered.set(false);
        this.parseCurrentText();
        this.cdr.markForCheck();
    }

    private parseCurrentText(): void {
        const text = this.currentText();
        if (!text) return;

        let slotIndex = 0;
        const regex = /\[(das|dass|Das|Dass)\]/gi;

        text.sentences.replace(regex, (match, word) => {
            const lowerWord = word.toLowerCase();
            const isCapitalized = word[0] === word[0].toUpperCase();

            this.slotData[slotIndex] = {
                correct: lowerWord,
                capitalize: isCapitalized
            };
            slotIndex++;
            return match;
        });
    }

    getSlotCount(): number[] {
        return Object.keys(this.slotData).map(k => parseInt(k));
    }

    getProcessedText(): { parts: { type: 'text' | 'slot'; content?: string; index?: number }[] } {
        const text = this.currentText();
        if (!text) return { parts: [] };

        const parts: { type: 'text' | 'slot'; content?: string; index?: number }[] = [];
        const regex = /\[(das|dass|Das|Dass)\]/gi;
        let lastIndex = 0;
        let slotIndex = 0;
        let match: RegExpExecArray | null;

        regex.lastIndex = 0;
        while ((match = regex.exec(text.sentences)) !== null) {
            // Add text before this match
            if (match.index > lastIndex) {
                parts.push({ type: 'text', content: text.sentences.substring(lastIndex, match.index) });
            }
            // Add slot
            parts.push({ type: 'slot', index: slotIndex });
            slotIndex++;
            lastIndex = match.index + match[0].length;
        }
        // Add remaining text
        if (lastIndex < text.sentences.length) {
            parts.push({ type: 'text', content: text.sentences.substring(lastIndex) });
        }

        return { parts };
    }

    getSlotDisplay(index: number): string {
        if (this.answered()) {
            const data = this.slotData[index];
            const userChoice = this.userChoices[index];
            const correct = data?.correct || '';
            const isCapitalized = data?.capitalize || false;

            const formatWord = (word: string) => {
                if (!word) return '';
                return isCapitalized ? word.charAt(0).toUpperCase() + word.slice(1) : word;
            };

            if (userChoice === correct) {
                return formatWord(correct);
            } else if (userChoice) {
                return `${formatWord(userChoice)} → ${formatWord(correct)}`;
            } else {
                return formatWord(correct);
            }
        }

        const choice = this.userChoices[index];
        if (choice) {
            const data = this.slotData[index];
            if (data?.capitalize) {
                return choice.charAt(0).toUpperCase() + choice.slice(1);
            }
            return choice;
        }
        return '?';
    }

    getSlotClass(index: number): string {
        if (!this.answered()) {
            return this.userChoices[index] ? 'selected' : '';
        }

        const data = this.slotData[index];
        const userChoice = this.userChoices[index];

        if (userChoice === data?.correct) {
            return 'correct';
        } else if (userChoice) {
            return 'incorrect';
        } else {
            return 'missed';
        }
    }

    openPopup(index: number): void {
        if (this.answered()) return;
        this.currentSlotIndex.set(index);
        this.showPopup.set(true);
    }

    selectChoice(choice: string): void {
        const index = this.currentSlotIndex();
        if (index !== null) {
            this.userChoices[index] = choice;
            this.closePopup();
            this.cdr.markForCheck();
        }
    }

    closePopup(): void {
        this.showPopup.set(false);
        this.currentSlotIndex.set(null);
    }

    checkAnswers(): void {
        let correctCount = 0;
        let wrongCount = 0;

        const answers: { correct: string; userAnswer: string | null; isCorrect: boolean }[] = [];

        for (const key of Object.keys(this.slotData)) {
            const index = parseInt(key);
            const data = this.slotData[index];
            const userChoice = this.userChoices[index];
            const isCorrect = userChoice === data.correct;

            if (isCorrect) {
                correctCount++;
            } else {
                wrongCount++;
            }

            answers.push({
                correct: data.correct,
                userAnswer: userChoice || null,
                isCorrect
            });
        }

        // Telemetry: Track errors
        const errors = answers.filter(a => !a.isCorrect);
        if (errors.length > 0) {
            const content = JSON.stringify({
                textId: this.currentText().id,
                originalText: this.currentText().sentences,
                errors: errors.map(e => ({
                    correct: e.correct,
                    actual: e.userAnswer
                }))
            });
            this.telemetryService.trackError('dasdass', content, this.sessionId);
        }

        // Store this text's results for AI analysis
        const currentText = this.currentText();
        if (currentText) {
            this.allTextResults.push({
                text: currentText.sentences,
                textId: currentText.id,
                answers
            });
        }

        this.totalCorrect.update(c => c + correctCount);
        this.totalWrong.update(c => c + wrongCount);
        this.answered.set(true);
    }


    nextText(): void {
        if (this.currentTextIndex() >= this.textsPerRound - 1) {
            // If in session mode, mark task as completed
            if (this.isSessionMode && this.sessionTaskId) {
                this.apiService.completeTask(this.sessionTaskId);
            }
            this.screen.set('results');
        } else {
            this.currentTextIndex.update(i => i + 1);
            this.showText();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}

