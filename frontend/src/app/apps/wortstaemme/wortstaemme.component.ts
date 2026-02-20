import { Component, signal, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';


interface MeaningOption {
    option: string;
    correct: boolean;
}

interface Composite {
    word: string;
    exists: boolean;
    meanings?: MeaningOption[];
    examples?: string[];
}

interface Stem {
    stem: string;
    composites: Composite[];
}

interface SentenceQuestion {
    sentence: string;          // display sentence with blanks
    answerParts: string[];     // correct #word# tokens
    answerDisplay: string;     // combined answer for display
    options: string[];         // shuffled options including correct
    compositeWord: string;     // which composite this belongs to
}

interface WriteQuestion {
    sentence: string;          // display sentence with blanks
    answerParts: string[];     // correct #word# tokens
    compositeWord: string;
    stem: string;              // the base stem for hint
}

type QuizMode = 'klassisch' | 'kreativ' | 'satzauswahl' | 'schreiben';

type Screen = 'welcome' | 'stage1' | 'results1' | 'stage2' | 'results2' | 'final'
    | 'build' | 'sentence' | 'sentence-result' | 'write' | 'write-result';

@Component({
    selector: 'app-wortstaemme',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './wortstaemme.component.html',
    styleUrl: './wortstaemme.component.css'
})
export class WortstaemmeComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);


    readonly modes: { id: QuizMode; label: string; icon: string; description: string }[] = [
        { id: 'klassisch', label: 'Klassisch', icon: '📝', description: 'Existenz prüfen & Bedeutungen zuordnen.' },
        { id: 'kreativ', label: 'Kreativ', icon: '💡', description: 'Tippe zusammengesetzte Wörter aus dem Gedächtnis.' },
        { id: 'satzauswahl', label: 'Satzauswahl', icon: '🔤', description: 'Wähle die richtige Form im Satz.' },
        { id: 'schreiben', label: 'Schreiben', icon: '✍️', description: 'Schreibe die richtige Form.' }
    ];
    mode = signal<QuizMode>('klassisch');

    screen = signal<Screen>('welcome');
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

    // Build mode
    buildInput = signal('');
    buildFound = signal<string[]>([]);
    buildTotal = signal(0);

    // Sentence quiz mode
    sentenceQuestions = signal<SentenceQuestion[]>([]);
    sentenceIndex = signal(0);
    sentenceSelected = signal<string | null>(null);
    sentenceChecked = signal(false);

    // Write mode
    writeQuestions = signal<WriteQuestion[]>([]);
    writeIndex = signal(0);
    writeInputs = signal<string[]>([]);
    writeChecked = signal(false);
    writeCorrect = signal(false);

    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentMeaningWord = computed(() => this.existingWords()[this.currentWordIndex()] || '');
    currentMeanings = computed(() => {
        const stem = this.currentStem();
        const word = this.currentMeaningWord();
        if (!stem) return [];
        const composite = stem.composites.find(c => c.word.replace(/-/g, '').toLowerCase() === word.toLowerCase());
        return composite?.meanings || [];
    });

    currentSentenceQ = computed(() => this.sentenceQuestions()[this.sentenceIndex()] || null);
    currentWriteQ = computed(() => this.writeQuestions()[this.writeIndex()] || null);

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

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        const stem = this.stems().find(s => s.stem === this.selectedStemValue());
        if (!stem) return;
        this.currentStem.set(stem);
        this.totalCorrect.set(0);
        this.totalQuestions.set(0);

        if (this.mode() === 'kreativ') {
            const existing = stem.composites.filter(c => c.exists);
            this.buildTotal.set(existing.length);
            this.buildFound.set([]);
            this.buildInput.set('');
            this.totalQuestions.set(existing.length);
            this.screen.set('build');
            return;
        }

        if (this.mode() === 'satzauswahl') {
            this.startSentenceQuiz(stem);
            return;
        }

        if (this.mode() === 'schreiben') {
            this.startWriteQuiz(stem);
            return;
        }

        this.stage1Selections.set(new Set());
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

        // Find existing words that have meanings
        const existing = stem.composites
            .filter(c => c.exists && c.meanings && c.meanings.length > 0)
            .map(c => c.word.replace(/-/g, ''));

        this.existingWords.set(existing);
        this.screen.set('results1');

        // Track per-content progress for stage 1
        const stemItem = this.currentStem() as any;
        if (stemItem?._contentId) {
            const totalComposites = stem.composites.length;
            this.telemetryService.trackProgress('wortstaemme', stemItem._contentId, correct === totalComposites, this.mode());
        }
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

    // ═══ MODE: KREATIV ═══

    submitBuildWord(): void {
        const input = this.buildInput().trim();
        if (!input) return;
        const stem = this.currentStem();
        if (!stem) return;

        const existing = stem.composites.filter(c => c.exists);
        const normalizedInput = input.toLowerCase().replace(/-/g, '');

        if (this.buildFound().some(f => f.toLowerCase() === normalizedInput)) {
            this.buildInput.set('');
            return;
        }

        const found = existing.find(c => c.word.replace(/-/g, '').toLowerCase() === normalizedInput);
        if (found) {
            this.buildFound.update(f => [...f, found.word.replace(/-/g, '')]);
            this.totalCorrect.update(c => c + 1);
        }

        this.buildInput.set('');
    }

    finishBuild(): void {
        this.screen.set('final');
    }

    // ═══ MODE: SATZAUSWAHL ═══

    /**
     * Parse #word# tokens from a sentence.
     * Returns { display: sentence with ____ blanks, parts: extracted words }
     */
    private parseSentence(sentence: string): { display: string; parts: string[] } {
        const parts: string[] = [];
        const display = sentence.replace(/#([^#]+)#/g, (_match, word) => {
            parts.push(word);
            return '____';
        });
        return { display, parts };
    }

    /**
     * Collect all unique #word# values from all composites of a stem (excluding given composite)
     */
    private collectDistractors(stem: Stem, excludeComposite: string): string[] {
        const distractors: string[] = [];
        for (const c of stem.composites) {
            if (!c.exists || !c.examples || c.word === excludeComposite) continue;
            for (const ex of c.examples) {
                const { parts } = this.parseSentence(ex);
                const combined = parts.join(' ');
                if (combined && !distractors.includes(combined)) {
                    distractors.push(combined);
                }
            }
        }
        return distractors;
    }

    private shuffle<T>(arr: T[]): T[] {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    private startSentenceQuiz(stem: Stem): void {
        const questions: SentenceQuestion[] = [];

        for (const c of stem.composites) {
            if (!c.exists || !c.examples) continue;
            for (const ex of c.examples) {
                const { display, parts } = this.parseSentence(ex);
                if (parts.length === 0) continue;

                const answerDisplay = parts.join(' ... ');
                const distractors = this.collectDistractors(stem, c.word);

                // Pick up to 3 distractors
                const picked = this.shuffle(distractors.filter(d => d !== answerDisplay)).slice(0, 3);
                const options = this.shuffle([answerDisplay, ...picked]);

                questions.push({
                    sentence: display,
                    answerParts: parts,
                    answerDisplay,
                    options,
                    compositeWord: c.word
                });
            }
        }

        this.sentenceQuestions.set(this.shuffle(questions));
        this.sentenceIndex.set(0);
        this.sentenceSelected.set(null);
        this.sentenceChecked.set(false);
        this.totalQuestions.set(questions.length);
        this.screen.set('sentence');
    }

    selectSentenceOption(option: string): void {
        if (this.sentenceChecked()) return;
        this.sentenceSelected.set(option);
    }

    checkSentenceAnswer(): void {
        const q = this.currentSentenceQ();
        if (!q || this.sentenceChecked()) return;

        this.sentenceChecked.set(true);
        if (this.sentenceSelected() === q.answerDisplay) {
            this.totalCorrect.update(c => c + 1);
        }
    }

    nextSentence(): void {
        if (this.sentenceIndex() >= this.sentenceQuestions().length - 1) {
            this.screen.set('final');
        } else {
            this.sentenceIndex.update(i => i + 1);
            this.sentenceSelected.set(null);
            this.sentenceChecked.set(false);
        }
    }

    getSentenceOptionClass(option: string): string {
        if (!this.sentenceChecked()) {
            return this.sentenceSelected() === option ? 'selected' : '';
        }
        const q = this.currentSentenceQ();
        if (!q) return '';
        const isCorrect = option === q.answerDisplay;
        const isSelected = this.sentenceSelected() === option;
        if (isCorrect) return 'correct';
        if (isSelected && !isCorrect) return 'wrong';
        return '';
    }

    // ═══ MODE: SCHREIBEN ═══

    private startWriteQuiz(stem: Stem): void {
        const questions: WriteQuestion[] = [];

        for (const c of stem.composites) {
            if (!c.exists || !c.examples) continue;
            for (const ex of c.examples) {
                const { display, parts } = this.parseSentence(ex);
                if (parts.length === 0) continue;

                questions.push({
                    sentence: display,
                    answerParts: parts,
                    compositeWord: c.word,
                    stem: stem.stem
                });
            }
        }

        this.writeQuestions.set(this.shuffle(questions));
        this.writeIndex.set(0);
        this.writeInputs.set(new Array(questions.length > 0 ? questions[0].answerParts.length : 0).fill(''));
        this.writeChecked.set(false);
        this.writeCorrect.set(false);
        this.totalQuestions.set(questions.length);
        this.screen.set('write');
    }

    updateWriteInput(index: number, value: string): void {
        const inputs = [...this.writeInputs()];
        inputs[index] = value;
        this.writeInputs.set(inputs);
    }

    checkWriteAnswer(): void {
        const q = this.currentWriteQ();
        if (!q || this.writeChecked()) return;

        this.writeChecked.set(true);
        const inputs = this.writeInputs();
        const allCorrect = q.answerParts.every((part, i) =>
            this.normalizeGerman(inputs[i] || '') === this.normalizeGerman(part)
        );
        this.writeCorrect.set(allCorrect);
        if (allCorrect) {
            this.totalCorrect.update(c => c + 1);
        }
    }

    nextWriteQuestion(): void {
        if (this.writeIndex() >= this.writeQuestions().length - 1) {
            this.screen.set('final');
        } else {
            this.writeIndex.update(i => i + 1);
            const nextQ = this.writeQuestions()[this.writeIndex()];
            this.writeInputs.set(new Array(nextQ ? nextQ.answerParts.length : 0).fill(''));
            this.writeChecked.set(false);
            this.writeCorrect.set(false);
        }
    }

    normalizeGerman(str: string): string {
        return str.trim().toLowerCase().replace(/ß/g, 'ss');
    }

    /** Build the sentence display with inline blanks for the write mode template */
    getSentenceParts(sentence: string): string[] {
        return sentence.split('____');
    }
}
