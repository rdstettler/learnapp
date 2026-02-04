import { Component, signal, computed, inject, ChangeDetectorRef, SecurityContext } from '@angular/core';
import { RouterLink } from '@angular/router';
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

@Component({
    selector: 'app-dasdass',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './dasdass.component.html',
    styleUrl: './dasdass.component.css'
})
export class DasdassComponent {
    private dataService = inject(DataService);
    private sanitizer = inject(DomSanitizer);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    private quizStartTime = 0;

    readonly TEXTS_PER_ROUND = 10;

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

    // Store all text results for AI analysis
    allTextResults: { text: string; textId: number; answers: { correct: string; userAnswer: string | null; isCorrect: boolean }[] }[] = [];

    progress = computed(() => (this.currentTextIndex() / this.TEXTS_PER_ROUND) * 100);
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
        this.dataService.loadAppContent<TextItem>('dasdass').subscribe({
            next: (data) => this.allTexts.set(data),
            error: (err) => console.error('Error loading dasdass data:', err)
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
        const shuffled = this.shuffle(this.allTexts());
        this.texts.set(shuffled.slice(0, this.TEXTS_PER_ROUND));
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
        if (this.currentTextIndex() >= this.TEXTS_PER_ROUND - 1) {
            this.saveResult();
            this.screen.set('results');
        } else {
            this.currentTextIndex.update(i => i + 1);
            this.showText();
        }
    }

    private saveResult(): void {
        const durationSeconds = Math.round((Date.now() - this.quizStartTime) / 1000);

        this.apiService.saveResult({
            appId: 'dasdass',
            score: this.totalCorrect(),
            maxScore: this.totalCorrect() + this.totalWrong(),
            durationSeconds,
            details: {
                textsCompleted: this.TEXTS_PER_ROUND,
                fullTextResults: this.allTextResults
            }
        });
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}

