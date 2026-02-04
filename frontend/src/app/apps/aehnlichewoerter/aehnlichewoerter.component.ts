import { Component, signal, computed, inject, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';

interface Sentence {
    id: number;
    text: string;
    correct: string;
}

interface WordPair {
    id: string;
    words: string[];
    description: string;
    sentences: Sentence[];
}

import { AppTelemetryService } from '../../services/app-telemetry.service';

@Component({
    selector: 'app-aehnlichewoerter',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './aehnlichewoerter.component.html',
    styleUrl: './aehnlichewoerter.component.css'
})
export class AehnlichewoerterComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);

    // Session ID for telemetry
    private sessionId = this.telemetryService.generateSessionId();

    readonly SENTENCES_PER_ROUND = 8;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    pairs = signal<WordPair[]>([]);
    currentPair = signal<WordPair | null>(null);
    selectedPairId = signal('');

    sentences = signal<Sentence[]>([]);
    currentSentenceIndex = signal(0);
    // Key is `${sentence.id}_${slotIndex}`
    userAnswers = signal<Map<string, string>>(new Map());
    answered = signal(false);

    // Track selected slot index for the current sentence
    selectedSlotIndex = signal<number>(-1);

    totalCorrect = signal(0);
    totalWrong = signal(0);

    progress = computed(() => (this.currentSentenceIndex() / this.SENTENCES_PER_ROUND) * 100);

    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentSentence = computed(() => this.sentences()[this.currentSentenceIndex()]);

    // Parse sentence once to identify slots
    currentParts = computed(() => {
        const sentence = this.currentSentence();
        if (!sentence) return [];

        const parts: { type: 'text' | 'slot'; content?: string; slotIndex?: number }[] = [];
        const regex = /\[([^\]]+)\]/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        let slotCount = 0;

        regex.lastIndex = 0;
        while ((match = regex.exec(sentence.text)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ type: 'text', content: sentence.text.substring(lastIndex, match.index) });
            }
            parts.push({ type: 'slot', slotIndex: slotCount++ });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < sentence.text.length) {
            parts.push({ type: 'text', content: sentence.text.substring(lastIndex) });
        }
        return parts;
    });

    // Auto-select first slot if there's only one
    currentSlotCount = computed(() => this.currentParts().filter(p => p.type === 'slot').length);

    dataLoaded = computed(() => this.pairs().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<WordPair>('aehnlichewoerter').subscribe({
            next: (data) => this.pairs.set(data),
            error: (err) => console.error('Error loading aehnlichewoerter data:', err)
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

    selectPair(event: Event): void {
        this.selectedPairId.set((event.target as HTMLSelectElement).value);
    }

    startQuiz(): void {
        const pair = this.pairs().find(p => p.id === this.selectedPairId());
        if (!pair) return;

        this.currentPair.set(pair);
        const shuffled = this.shuffle(pair.sentences);
        this.sentences.set(shuffled.slice(0, this.SENTENCES_PER_ROUND));
        this.currentSentenceIndex.set(0);
        this.resetRoundState();
        this.userAnswers.set(new Map());
        this.totalCorrect.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        // this.answered.set(false); // Moved to resetRoundState
        this.screen.set('quiz');
    }

    private resetRoundState(): void {
        this.userAnswers.set(new Map());
        this.answered.set(false);

        // Check slot count via computed logic, but computed signals update in next cycle usually.
        // We can parse here manually or wait. simpler to just rely on effect or do it explicitly.
        // Let's do it explicitly for the current sentence
        const sentence = this.sentences()[this.currentSentenceIndex()];
        const matchCount = (sentence.text.match(/\[([^\]]+)\]/g) || []).length;

        if (matchCount === 1) {
            this.selectedSlotIndex.set(0);
        } else {
            this.selectedSlotIndex.set(-1);
        }
    }

    getSlotDisplay(slotIndex: number): string {
        const sentence = this.currentSentence();
        if (!sentence) return '?';

        const answers = this.userAnswers();
        const answer = answers.get(`${sentence.id}_${slotIndex}`);
        return answer || '?';
    }

    getSlotClass(slotIndex: number): string {
        const sentence = this.currentSentence();
        if (!sentence) return '';

        const answers = this.userAnswers();
        const answer = answers.get(`${sentence.id}_${slotIndex}`);

        if (!answer) {
            return this.selectedSlotIndex() === slotIndex && !this.answered() ? 'selected-active' : '';
        }

        if (!this.answered()) {
            // If answered but not submitted yet, stick to selection
            return this.selectedSlotIndex() === slotIndex ? 'selected-active' : 'selected';
        }

        // Logic for correctness: currently simplified to single correct word logic 
        // OR we check if the filled word matches what was expected in that slot.
        // Since original data only has one 'correct' field but potentially multiple slots, 
        // we might not have per-slot correct answers unless we deduce them.
        // Assuming 'correct' applies to ALL slots for now if multiple, or checking against logic?
        // Actually the logic for 'aehnlichewoerter' usually implies filling the same word or cognates.
        // Let's assume strict match against 'correct' field for now, as data usually has 1 slot.
        // If 2 slots exist, the standard behavior in this app type implies testing distinct words?
        // Wait, 'aehnlichewoerter.json' has "text": "Der Apfel [fiel] vom Baum.", "correct": "fiel".
        // It's a fill-in-the-gap.
        // If there were two gaps, e.g. "Das [Meer] ist [mehr] als..." with correct="Meer"? No.
        // If multiple slots exist, the user likely needs to pick the right one for EACH.
        // I will assume the 'correct' word applies to the slot being checked.

        const normalizedAnswer = answer.toLowerCase();
        const normalizedCorrect = sentence.correct.toLowerCase();

        return normalizedAnswer === normalizedCorrect ? 'correct' : 'incorrect';
    }

    selectSlot(index: number): void {
        if (!this.answered()) {
            this.selectedSlotIndex.set(index);
        }
    }

    selectWord(word: string): void {
        if (this.answered()) return;

        const currentSlot = this.selectedSlotIndex();
        if (currentSlot === -1) {
            // If no slot selected, maybe auto-select first empty one?
            // For now, require selection if multiple, or rely on auto-select logic
            return;
        }

        const sentence = this.currentSentence();
        if (!sentence) return;

        // Preserve capitalization logic (check start of sentence)
        // We need to know where the slot is in the text to check for capitalization
        // Simplified: just check if sentence starts with '[' and slot is 0
        const isFirstSlotAtStart = currentSlot === 0 && sentence.text.startsWith('[');

        let selectedWord = word;
        if (isFirstSlotAtStart) {
            selectedWord = word.charAt(0).toUpperCase() + word.slice(1);
        }

        const key = `${sentence.id}_${currentSlot}`;
        const answers = new Map(this.userAnswers());
        answers.set(key, selectedWord);
        this.userAnswers.set(answers);

        // Auto-advance selection to next empty slot if exists
        const totalSlots = this.currentSlotCount();
        if (totalSlots > 1) {
            // Find next empty
            for (let i = 0; i < totalSlots; i++) {
                if (!answers.has(`${sentence.id}_${i}`)) {
                    this.selectedSlotIndex.set(i);
                    return;
                }
            }
            // If all full, keep selection or deselect?
            // this.selectedSlotIndex.set(-1); 
        }
    }

    checkAnswer(): void {
        const sentence = this.currentSentence();
        if (!sentence) return;

        const answers = this.userAnswers();
        const parts = this.currentParts();
        const slots = parts.filter(p => p.type === 'slot');

        let allCorrect = true;
        let errorActual = '';

        slots.forEach((slot, index) => {
            const key = `${sentence.id}_${slot.slotIndex}`;
            const answer = answers.get(key);
            if (!answer) {
                allCorrect = false;
                return;
            }

            // Check correctness
            if (answer.toLowerCase() !== sentence.correct.toLowerCase()) {
                allCorrect = false;
                errorActual += answer + ' ';
            }
        });

        if (allCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);

            // Telemetry: Track error
            const content = JSON.stringify({
                sentenceId: sentence.id,
                originalText: sentence.text,
                correct: sentence.correct,
                actual: errorActual.trim() || 'incomplete'
            });

            this.telemetryService.trackError('aehnlichewoerter', content, this.sessionId);
        }

        this.answered.set(true);
    }

    getCorrectAnswer(): string {
        const sentence = this.currentSentence();
        return sentence?.correct || '';
    }

    nextSentence(): void {
        const nextIndex = this.currentSentenceIndex() + 1;

        if (nextIndex >= this.SENTENCES_PER_ROUND) {
            this.screen.set('results');
        } else {
            this.currentSentenceIndex.set(nextIndex);
            this.resetRoundState();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
        this.selectedPairId.set('');
        this.currentPair.set(null);
    }

    getSelectedSlotValue(): string {
        const idx = this.selectedSlotIndex();
        if (idx === -1) return '';
        return this.getSlotDisplay(idx);
    }

    areAllSlotsFilled(): boolean {
        const total = this.currentSlotCount();
        const answers = this.userAnswers();
        const sentence = this.currentSentence();
        if (!sentence) return false;

        for (let i = 0; i < total; i++) {
            if (!answers.has(`${sentence.id}_${i}`)) return false;
        }
        return true;
    }

    // Returns true if any slot is incorrect
    hasErrors(): boolean {
        if (!this.answered()) return false;
        const sentence = this.currentSentence();
        if (!sentence) return false;

        // Simplified check: usually one correct word for the whole sentence?
        // Actually, let's just check if any slot is red.
        const answers = this.userAnswers();
        const slots = this.currentParts().filter(p => p.type === 'slot');

        return slots.some(slot => {
            const key = `${sentence.id}_${slot.slotIndex}`;
            const ans = answers.get(key) || '';
            return ans.toLowerCase() !== sentence.correct.toLowerCase();
        });
    }

    playAgainSamePair(): void {
        this.startQuiz();
    }
}
