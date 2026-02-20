import { Component, signal, computed, inject, ChangeDetectorRef, SecurityContext } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DataService } from '../../services/data.service';
import { ApiService } from '../../services/api.service';
import { shuffle } from '../../shared/utils/array.utils';

interface TextItem {
    id: number;
    sentences: string;
}

interface SlotData {
    correct: string;
    capitalize: boolean;
}

type QuizMode = 'standard' | 'fehlerjagd';

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

@Component({
    selector: 'app-dasdass',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './dasdass.component.html',
    styleUrl: './dasdass.component.css'
})
export class DasdassComponent {
    private dataService = inject(DataService);
    private sanitizer = inject(DomSanitizer);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService); // Public so we can bind to it if needed
    private telemetryService = inject(AppTelemetryService);


    private quizStartTime = 0;

    readonly DEFAULT_TEXTS_PER_ROUND = 10;
    textsPerRound = this.DEFAULT_TEXTS_PER_ROUND;

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'standard', label: 'Standard', icon: '📝', description: 'Wähle "das" oder "dass" für jede Lücke.' },
        { id: 'fehlerjagd', label: 'Fehlerjagd', icon: '🔎', description: 'Text ist ausgefüllt – finde die Fehler!' }
    ];
    mode = signal<QuizMode>('standard');

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

    // Hunt mode
    huntFills = signal<Record<number, string>>({});
    huntToggled = signal<Set<number>>(new Set());
    huntChecked = signal(false);

    // AI Session / Plan State
    isSessionMode = false;
    isPlanMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;
    planTaskIds: number[] | null = null;

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
        const state = window.history.state as any;

        // 1. Check Router State
        if (state && state.learningContent && (state.sessionId || state.fromPlan)) {
            this.isSessionMode = true;
            this.isPlanMode = !!state.fromPlan;
            this.sessionTaskId = state.taskId;
            this.sessionTaskIds = state.taskIds; // Capture grouped IDs
            this.planTaskIds = state.planTaskIds;

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
            this.isSessionMode = true;
            this.sessionTaskId = sessionTask.id;
            // Note: taskIds usually come from router state, but if we loaded from service, we might rely on single ID.

            let aiTexts: TextItem[] = [];

            // Case A: AI returned 'sentences' array
            if (sessionTask.content && Array.isArray(sessionTask.content['sentences'])) {
                aiTexts = (sessionTask.content['sentences'] as string[]).map((s: string, index: number) => ({
                    id: 1000 + index,
                    sentences: s
                }));
            }
            // Case B: AI returned 'originalText'
            else if (sessionTask.content && typeof sessionTask.content['originalText'] === 'string') {
                aiTexts = [{
                    id: 1000,
                    sentences: sessionTask.content['originalText'] as string
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

    setMode(m: QuizMode): void {
        this.mode.set(m);
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
            const shuffled = shuffle(this.allTexts());
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
        if (this.mode() === 'fehlerjagd') {
            this.setupHunt();
        }
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

        // Track per-content progress
        if (currentText && (currentText as any)._contentId) {
            this.telemetryService.trackProgress('dasdass', (currentText as any)._contentId, wrongCount === 0, this.mode());
        }
    }


    nextText(): void {
        if (this.currentTextIndex() >= this.textsPerRound - 1) {
            // If in session/plan mode, mark task(s) as completed
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
            this.currentTextIndex.update(i => i + 1);
            this.showText();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    // ═══ MODE: FEHLERJAGD ═══

    private setupHunt(): void {
        const fills: Record<number, string> = {};
        for (const key of Object.keys(this.slotData)) {
            const index = parseInt(key);
            const data = this.slotData[index];
            if (Math.random() < 0.4) {
                fills[index] = data.correct === 'das' ? 'dass' : 'das';
            } else {
                fills[index] = data.correct;
            }
        }
        this.huntFills.set(fills);
        this.huntToggled.set(new Set());
        this.huntChecked.set(false);
    }

    toggleHuntSlot(index: number): void {
        if (this.huntChecked()) return;
        const toggled = new Set(this.huntToggled());
        if (toggled.has(index)) toggled.delete(index);
        else toggled.add(index);
        this.huntToggled.set(toggled);
    }

    getHuntSlotDisplay(index: number): string {
        const fills = this.huntFills();
        const word = fills[index] || '?';
        const data = this.slotData[index];
        if (data?.capitalize) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
    }

    getHuntSlotClass(index: number): string {
        const toggled = this.huntToggled().has(index);
        if (!this.huntChecked()) {
            return toggled ? 'hunt-flagged' : '';
        }
        const fills = this.huntFills();
        const data = this.slotData[index];
        const isActuallyWrong = fills[index] !== data.correct;
        if (isActuallyWrong && toggled) return 'correct';
        if (isActuallyWrong && !toggled) return 'missed';
        if (!isActuallyWrong && toggled) return 'incorrect';
        return '';
    }

    checkHunt(): void {
        let correct = 0;
        let wrong = 0;
        const fills = this.huntFills();
        const toggled = this.huntToggled();

        for (const key of Object.keys(this.slotData)) {
            const index = parseInt(key);
            const isActuallyWrong = fills[index] !== this.slotData[index].correct;
            const userFlagged = toggled.has(index);

            if (isActuallyWrong) {
                if (userFlagged) correct++;
                else wrong++;
            } else {
                if (userFlagged) wrong++;
            }
        }

        this.totalCorrect.update(c => c + correct);
        this.totalWrong.update(w => w + wrong);
        this.huntChecked.set(true);
        this.answered.set(true);

        const currentText = this.currentText() as any;
        if (currentText?._contentId) {
            this.telemetryService.trackProgress('dasdass', currentText._contentId, wrong === 0, this.mode());
        }
    }
}

