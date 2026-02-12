import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { normalizeGermanText } from '../../shared/utils/text.utils';
import { shuffle } from '../../shared/utils/array.utils';
import { FormsModule } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';


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

interface SentenceItem {
    correct: string;
    wrong: string[];
    _contentId?: number;
    _mastery?: string;
}

interface SentenceOption {
    text: string;
    isCorrect: boolean;
}

type QuizMode = 'korrektur' | 'markieren' | 'saetze';

@Component({
    selector: 'app-fehler',
    standalone: true,
    imports: [FormsModule, LearningAppLayoutComponent],
    templateUrl: './fehler.component.html',
    styleUrl: './fehler.component.css'
})
export class FehlerComponent {
    private dataService = inject(DataService);
    private cdr = inject(ChangeDetectorRef);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'korrektur', label: 'Korrektur', icon: '✏️', description: 'Finde Fehler und tippe die Korrektur.' },
        { id: 'markieren', label: 'Markieren', icon: '🎯', description: 'Klicke nur auf die falschen Wörter.' },
        { id: 'saetze', label: 'Sätze', icon: '📝', description: 'Finde den richtigen Satz unter vier Varianten.' }
    ];
    mode = signal<QuizMode>('korrektur');

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    texts = signal<string[]>([]);
    allTexts = signal<string[]>([]);
    currentTextIndex = signal(0);

    displayWords = signal<DisplayWord[]>([]);
    currentTextErrors: ErrorItem[] = [];

    totalFound = signal(0);
    totalMissed = signal(0);
    checked = signal(false);

    // Highlight mode
    highlightMarked = signal<Set<number>>(new Set());

    // Popup state
    showPopup = signal(false);
    selectedWordIndex = signal<number | null>(null);
    popupWordText = signal('');
    correctionInput = '';
    popupIsError = false;
    popupCorrect = '';

    // ═══ SÄTZE MODE STATE ═══
    allSentences = signal<SentenceItem[]>([]);
    sentences = signal<SentenceItem[]>([]);
    currentSentenceIndex = signal(0);
    sentenceOptions = signal<SentenceOption[]>([]);
    selectedSentence = signal<number | null>(null);
    sentenceChecked = signal(false);
    sentenceCorrectCount = signal(0);
    sentenceTotalCount = signal(0);

    progress = computed(() => {
        if (this.mode() === 'saetze') {
            return (this.currentSentenceIndex() / this.sentences().length) * 100;
        }
        return (this.currentTextIndex() / this.texts().length) * 100;
    });
    percentage = computed(() => {
        const total = this.totalFound() + this.totalMissed();
        return total > 0 ? Math.round((this.totalFound() / total) * 100) : 0;
    });

    dataLoaded = computed(() => {
        if (this.mode() === 'saetze') return this.allSentences().length > 0;
        return this.allTexts().length > 0;
    });

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<string>('fehler').subscribe({
            next: (data) => this.allTexts.set(data),
            error: (err) => console.error('Error loading fehler data:', err)
        });
        this.dataService.loadAppContent<SentenceItem>('fehlerfinden2').subscribe({
            next: (data) => this.allSentences.set(data as SentenceItem[]),
            error: (err) => console.error('Error loading fehlerfinden2 data:', err)
        });
    }

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        if (this.mode() === 'saetze') {
            this.sentences.set(shuffle(this.allSentences()));
            this.currentSentenceIndex.set(0);
            this.sentenceCorrectCount.set(0);
            this.sentenceTotalCount.set(0);
            this.totalFound.set(0);
            this.totalMissed.set(0);
            this.screen.set('quiz');
            this.renderSentence();
            return;
        }
        this.texts.set(shuffle(this.allTexts()));
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
        this.highlightMarked.set(new Set());
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
            if (normalizeGermanText(error.userCorrection) === normalizeGermanText(error.correctWord)) {
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
                if (normalizeGermanText(error.userCorrection) === normalizeGermanText(error.correctWord)) {
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

        // Track per-content progress
        const text = this.texts()[this.currentTextIndex()] as any;
        if (text?._contentId) {
            this.telemetryService.trackProgress('fehler', text._contentId, missed === 0, this.mode());
        }
    }

    nextText(): void {
        if (this.currentTextIndex() >= this.texts().length - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentTextIndex.update(i => i + 1);
            this.renderText();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    // ═══ MODE: MARKIEREN ═══

    toggleHighlight(word: DisplayWord): void {
        if (this.checked()) return;
        const marked = new Set(this.highlightMarked());
        if (marked.has(word.wordIndex)) marked.delete(word.wordIndex);
        else marked.add(word.wordIndex);
        this.highlightMarked.set(marked);
    }

    getHighlightClass(word: DisplayWord): string {
        const isMarked = this.highlightMarked().has(word.wordIndex);
        if (!this.checked()) {
            return isMarked ? 'hl-marked' : '';
        }
        if (word.isError && isMarked) return 'correct-click';
        if (word.isError && !isMarked) return 'missed';
        if (!word.isError && isMarked) return 'false-alarm';
        return '';
    }

    checkHighlight(): void {
        let found = 0;
        let missed = 0;
        const marked = this.highlightMarked();

        this.currentTextErrors.forEach(error => {
            if (marked.has(error.wordIndex)) found++;
            else missed++;
        });

        marked.forEach(idx => {
            if (!this.currentTextErrors.some(e => e.wordIndex === idx)) {
                missed++;
            }
        });

        this.totalFound.update(f => f + found);
        this.totalMissed.update(m => m + missed);
        this.checked.set(true);

        const text = this.texts()[this.currentTextIndex()] as any;
        if (text?._contentId) {
            this.telemetryService.trackProgress('fehler', text._contentId, missed === 0, this.mode());
        }
    }

    // ═══ MODE: SÄTZE ═══

    private renderSentence(): void {
        const item = this.sentences()[this.currentSentenceIndex()];
        if (!item) return;

        const options: SentenceOption[] = shuffle([
            { text: item.correct, isCorrect: true },
            ...item.wrong.map(w => ({ text: w, isCorrect: false }))
        ]);

        this.sentenceOptions.set(options);
        this.selectedSentence.set(null);
        this.sentenceChecked.set(false);
        this.cdr.markForCheck();
    }

    selectSentence(index: number): void {
        if (this.sentenceChecked()) return;
        this.selectedSentence.set(index);
    }

    checkSentence(): void {
        if (this.selectedSentence() === null) return;

        const chosen = this.sentenceOptions()[this.selectedSentence()!];
        const isCorrect = chosen.isCorrect;

        this.sentenceTotalCount.update(c => c + 1);
        if (isCorrect) {
            this.sentenceCorrectCount.update(c => c + 1);
            this.totalFound.update(f => f + 1);
        } else {
            this.totalMissed.update(m => m + 1);
        }

        this.sentenceChecked.set(true);

        const item = this.sentences()[this.currentSentenceIndex()] as any;
        if (item?._contentId) {
            this.telemetryService.trackProgress('fehlerfinden2', item._contentId, isCorrect, this.mode());
        }
    }

    nextSentence(): void {
        if (this.currentSentenceIndex() >= this.sentences().length - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentSentenceIndex.update(i => i + 1);
            this.renderSentence();
        }
    }

    getSentenceClass(index: number): string {
        const isSelected = this.selectedSentence() === index;
        const option = this.sentenceOptions()[index];

        if (!this.sentenceChecked()) {
            return isSelected ? 'sentence-selected' : '';
        }

        if (option.isCorrect) return 'sentence-correct';
        if (isSelected && !option.isCorrect) return 'sentence-wrong';
        return 'sentence-dimmed';
    }
}
