import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { DataService } from '../../services/data.service';

interface WordSlot {
    word: string;
    expected: string;
    selected: string;
    checked: boolean;
}

@Component({
    selector: 'app-satzzeichen',
    standalone: true,
    templateUrl: './satzzeichen.component.html',
    styleUrl: './satzzeichen.component.css'
})
export class SatzzeichenComponent {
    private dataService = inject(DataService);
    private cdr = inject(ChangeDetectorRef);

    // Punctuation characters to detect (including German quotes)
    readonly punctSet = new Set(['.', ',', '?', ':', '\u201E', '\u201C']);
    readonly punctOptions = [',', '.', '?', ':', '\u201E', '\u201C'];

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    allTexts = signal<string[]>([]);
    texts = signal<string[]>([]);
    currentTextIndex = signal(0);

    slots = signal<WordSlot[]>([]);
    answered = signal(false);

    totalCorrect = signal(0);
    totalSlots = signal(0);

    // Popup state
    showPopup = signal(false);
    currentSlotIndex = signal<number | null>(null);
    currentBuilding = signal('');

    progress = computed(() => (this.currentTextIndex() / this.texts().length) * 100);
    percentage = computed(() => {
        const total = this.totalSlots();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    dataLoaded = computed(() => this.allTexts().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadData<{ texts: string[] }>('satzzeichen.json').subscribe({
            next: (data) => this.allTexts.set(data.texts),
            error: (err) => console.error('Error loading satzzeichen data:', err)
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

    private isPunct(char: string): boolean {
        return this.punctSet.has(char);
    }

    private parseText(text: string): WordSlot[] {
        const result: { word: string; punct: string }[] = [];
        let currentWord = '';
        let currentPunct = '';

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (this.isPunct(char)) {
                currentPunct += char;
            } else if (char === ' ' || char === '\n') {
                if (currentWord) {
                    result.push({ word: currentWord, punct: currentPunct });
                    currentWord = '';
                    currentPunct = '';
                } else if (currentPunct && result.length > 0) {
                    result[result.length - 1].punct += currentPunct;
                    currentPunct = '';
                }
            } else {
                if (currentPunct) {
                    if (currentWord) {
                        result.push({ word: currentWord, punct: currentPunct });
                        currentWord = '';
                        currentPunct = '';
                    } else if (result.length > 0) {
                        result[result.length - 1].punct += currentPunct;
                        currentPunct = '';
                    } else {
                        currentPunct = '';
                    }
                }
                currentWord += char;
            }
        }

        if (currentWord) {
            result.push({ word: currentWord, punct: currentPunct });
        } else if (currentPunct && result.length > 0) {
            result[result.length - 1].punct += currentPunct;
        }

        return result.map(item => ({
            word: item.word,
            expected: item.punct,
            selected: '',
            checked: false
        }));
    }

    startQuiz(): void {
        this.texts.set(this.shuffle(this.allTexts()).slice(0, 5));
        this.currentTextIndex.set(0);
        this.totalCorrect.set(0);
        this.totalSlots.set(0);
        this.screen.set('quiz');
        this.showText();
    }

    private showText(): void {
        const text = this.texts()[this.currentTextIndex()];
        if (!text) return;

        const parsed = this.parseText(text);
        this.slots.set(parsed);
        this.answered.set(false);
        this.cdr.markForCheck();
    }

    openPopup(index: number): void {
        if (this.answered()) return;

        this.currentSlotIndex.set(index);
        this.currentBuilding.set(this.slots()[index].selected || '');
        this.showPopup.set(true);
    }

    addSymbol(symbol: string): void {
        this.currentBuilding.update(b => b + symbol);
    }

    clearBuilding(): void {
        this.currentBuilding.set('');
    }

    confirmSelection(): void {
        const index = this.currentSlotIndex();
        if (index === null) return;

        const slotsArr = [...this.slots()];
        slotsArr[index] = { ...slotsArr[index], selected: this.currentBuilding() };
        this.slots.set(slotsArr);

        this.closePopup();
    }

    closePopup(): void {
        this.showPopup.set(false);
        this.currentSlotIndex.set(null);
        this.currentBuilding.set('');
    }

    getSlotClass(slot: WordSlot): string {
        if (!slot.checked) {
            return slot.selected ? 'filled' : '';
        }

        if (slot.expected === slot.selected) {
            return 'correct';
        } else if (slot.expected && !slot.selected) {
            return 'missing';
        } else if (!slot.expected && slot.selected) {
            return 'incorrect';
        } else {
            return 'incorrect';
        }
    }

    checkAnswers(): void {
        let roundCorrect = 0;
        let roundTotal = 0;

        const checked = this.slots().map(slot => {
            if (slot.expected || slot.selected) {
                roundTotal++;
                if (slot.expected === slot.selected) {
                    roundCorrect++;
                }
            }
            return { ...slot, checked: true };
        });

        this.slots.set(checked);
        this.totalCorrect.update(c => c + roundCorrect);
        this.totalSlots.update(t => t + roundTotal);
        this.answered.set(true);
    }

    nextText(): void {
        if (this.currentTextIndex() >= this.texts().length - 1) {
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
