import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';

interface DisplayWord {
    text: string;
    isSpace?: boolean;
    isError: boolean;
    correct?: string;
    wordIndex: number;
}

interface ErrorItem {
    wrongWord: string;
    correctWord: string;
    userCorrection: string | null;
    wordIndex: number;
}

@Component({
    selector: 'app-fehler',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './fehler.component.html',
    styleUrl: './fehler.component.css'
})
export class FehlerComponent {
    private dataService = inject(DataService);
    private cdr = inject(ChangeDetectorRef);

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    texts = signal<string[]>([]);
    allTexts = signal<string[]>([]);
    currentTextIndex = signal(0);

    displayWords = signal<DisplayWord[]>([]);
    currentTextErrors: ErrorItem[] = [];

    totalFound = signal(0);
    totalMissed = signal(0);
    checked = signal(false);

    // Popup state
    showPopup = signal(false);
    selectedWordIndex = signal<number | null>(null);
    popupWordText = signal('');
    correctionInput = '';
    popupIsError = false;
    popupCorrect = '';

    progress = computed(() => (this.currentTextIndex() / this.texts().length) * 100);
    percentage = computed(() => {
        const total = this.totalFound() + this.totalMissed();
        return total > 0 ? Math.round((this.totalFound() / total) * 100) : 0;
    });

    dataLoaded = computed(() => this.allTexts().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadData<string[]>('fehler.json').subscribe({
            next: (data) => this.allTexts.set(data),
            error: (err) => console.error('Error loading fehler data:', err)
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
        this.texts.set(this.shuffle(this.allTexts()));
        this.currentTextIndex.set(0);
        this.totalFound.set(0);
        this.totalMissed.set(0);
        this.screen.set('quiz');
        this.renderText();
    }

    private parseText(text: string): { displayWords: DisplayWord[]; errors: ErrorItem[] } {
        const errors: ErrorItem[] = [];
        const pattern = /\[([^\/\]]+)\/([^\]]+)\]/g;
        let cleanText = text;

        // First pass: collect all errors with positions
        const matches: { fullMatch: string; correct: string; wrong: string }[] = [];
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(text)) !== null) {
            matches.push({
                fullMatch: match[0],
                correct: match[1],
                wrong: match[2]
            });
        }

        // Replace patterns with markers
        matches.forEach((m, i) => {
            cleanText = cleanText.replace(m.fullMatch, `{{ERROR_${i}}}`);
        });

        // Split into words and spaces
        const parts = cleanText.split(/(\s+)/);
        const displayWords: DisplayWord[] = [];
        let wordIndex = 0;

        parts.forEach(part => {
            if (part.match(/^\s*$/)) {
                // Space - don't add to displayWords for simplicity
                return;
            }

            // Check if this part contains an error marker
            const errorMatch = part.match(/\{\{ERROR_(\d+)\}\}/);
            if (errorMatch) {
                const errorIndex = parseInt(errorMatch[1]);
                const error = matches[errorIndex];
                const prefix = part.split(`{{ERROR_${errorIndex}}}`)[0];
                const suffix = part.split(`{{ERROR_${errorIndex}}}`)[1];

                if (prefix) {
                    displayWords.push({
                        text: prefix,
                        isError: false,
                        wordIndex: wordIndex++
                    });
                }

                displayWords.push({
                    text: error.wrong,
                    isError: true,
                    correct: error.correct,
                    wordIndex: wordIndex
                });

                errors.push({
                    wrongWord: error.wrong,
                    correctWord: error.correct,
                    userCorrection: null,
                    wordIndex: wordIndex
                });
                wordIndex++;

                if (suffix) {
                    displayWords.push({
                        text: suffix,
                        isError: false,
                        wordIndex: wordIndex++
                    });
                }
            } else {
                displayWords.push({
                    text: part,
                    isError: false,
                    wordIndex: wordIndex++
                });
            }
        });

        return { displayWords, errors };
    }

    private renderText(): void {
        const text = this.texts()[this.currentTextIndex()];
        if (!text) return;

        const { displayWords, errors } = this.parseText(text);
        this.displayWords.set(displayWords);
        this.currentTextErrors = errors;
        this.checked.set(false);
        this.cdr.markForCheck();
    }

    openCorrectionPopup(word: DisplayWord): void {
        if (this.checked()) return;

        this.selectedWordIndex.set(word.wordIndex);
        this.popupWordText.set(word.text);
        this.correctionInput = '';
        this.popupIsError = word.isError;
        this.popupCorrect = word.correct || '';
        this.showPopup.set(true);
    }

    submitCorrection(): void {
        const input = this.correctionInput.trim();
        const wordIndex = this.selectedWordIndex();

        if (!input || wordIndex === null) {
            this.closePopup();
            return;
        }

        // Update display word to show correction
        const words = [...this.displayWords()];
        const wordIdx = words.findIndex(w => w.wordIndex === wordIndex);
        if (wordIdx >= 0) {
            words[wordIdx] = { ...words[wordIdx], text: words[wordIdx].text, userCorrection: input } as any;
            this.displayWords.set(words);
        }

        // Track user correction
        if (this.popupIsError) {
            const error = this.currentTextErrors.find(e => e.wordIndex === wordIndex);
            if (error) {
                error.userCorrection = input;
            }
        }

        this.closePopup();
    }

    closePopup(): void {
        this.showPopup.set(false);
        this.selectedWordIndex.set(null);
    }

    getWordClass(word: DisplayWord): string {
        const hasCorrection = this.currentTextErrors.some(
            e => e.wordIndex === word.wordIndex && e.userCorrection
        );

        if (!this.checked()) {
            return hasCorrection ? 'corrected' : '';
        }

        const error = this.currentTextErrors.find(e => e.wordIndex === word.wordIndex);
        if (!error) return '';

        if (error.userCorrection) {
            if (error.userCorrection.toLowerCase() === error.correctWord.toLowerCase()) {
                return 'correct-click';
            } else {
                return 'missed';
            }
        } else {
            return 'missed';
        }
    }

    getWordCorrection(word: DisplayWord): string | null {
        const error = this.currentTextErrors.find(e => e.wordIndex === word.wordIndex);
        if (error?.userCorrection) {
            return error.userCorrection;
        }
        return null;
    }

    getRevealedCorrection(word: DisplayWord): string | null {
        if (!this.checked()) return null;
        const error = this.currentTextErrors.find(e => e.wordIndex === word.wordIndex);
        return error?.correctWord || null;
    }

    showHint(): void {
        const totalErrors = this.currentTextErrors.length;
        const foundErrors = this.currentTextErrors.filter(e => e.userCorrection !== null).length;
        const remaining = totalErrors - foundErrors;
        alert(`${foundErrors}/${totalErrors} Fehler gefunden. Noch ${remaining} Fehler offen.`);
    }

    checkText(): void {
        let foundCorrect = 0;
        let missed = 0;

        this.currentTextErrors.forEach(error => {
            if (error.userCorrection) {
                if (error.userCorrection.toLowerCase() === error.correctWord.toLowerCase()) {
                    foundCorrect++;
                } else {
                    missed++;
                }
            } else {
                missed++;
            }
        });

        this.totalFound.update(f => f + foundCorrect);
        this.totalMissed.update(m => m + missed);
        this.checked.set(true);
    }

    nextText(): void {
        if (this.currentTextIndex() >= this.texts().length - 1) {
            this.screen.set('results');
        } else {
            this.currentTextIndex.update(i => i + 1);
            this.renderText();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
