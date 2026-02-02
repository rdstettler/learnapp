import { Component, signal, computed, inject, ChangeDetectorRef, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DataService } from '../../services/data.service';

interface TextItem {
    id: number;
    sentences: string;
}

interface SlotData {
    correct: string;
    capitalize: boolean;
}

@Component({
    selector: 'app-dasdass',
    standalone: true,
    templateUrl: './dasdass.component.html',
    styleUrl: './dasdass.component.css'
})
export class DasdassComponent {
    private dataService = inject(DataService);
    private sanitizer = inject(DomSanitizer);
    private cdr = inject(ChangeDetectorRef);

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
        this.dataService.loadData<{ texts: TextItem[] }>('dasdass.json').subscribe({
            next: (data) => this.allTexts.set(data.texts),
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

        for (const key of Object.keys(this.slotData)) {
            const index = parseInt(key);
            const data = this.slotData[index];
            const userChoice = this.userChoices[index];

            if (userChoice === data.correct) {
                correctCount++;
            } else {
                wrongCount++;
            }
        }

        this.totalCorrect.update(c => c + correctCount);
        this.totalWrong.update(c => c + wrongCount);
        this.answered.set(true);
    }

    nextText(): void {
        if (this.currentTextIndex() >= this.TEXTS_PER_ROUND - 1) {
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
