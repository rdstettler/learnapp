import { Component, signal, computed, inject } from '@angular/core';
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

@Component({
    selector: 'app-aehnlichewoerter',
    standalone: true,
    templateUrl: './aehnlichewoerter.component.html',
    styleUrl: './aehnlichewoerter.component.css'
})
export class AehnlichewoerterComponent {
    private dataService = inject(DataService);

    readonly SENTENCES_PER_ROUND = 10;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    pairs = signal<WordPair[]>([]);
    currentPair = signal<WordPair | null>(null);
    selectedPairId = signal('');
    
    sentences = signal<Sentence[]>([]);
    currentSentenceIndex = signal(0);
    userAnswers = signal<Map<number, string>>(new Map());
    answered = signal(false);
    
    totalCorrect = signal(0);
    totalWrong = signal(0);

    progress = computed(() => (this.currentSentenceIndex() / this.SENTENCES_PER_ROUND) * 100);
    
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentSentence = computed(() => this.sentences()[this.currentSentenceIndex()]);
    
    dataLoaded = computed(() => this.pairs().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadData<{ pairs: WordPair[] }>('aehnlichewoerter.json').subscribe({
            next: (data) => this.pairs.set(data.pairs),
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
        this.userAnswers.set(new Map());
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.answered.set(false);
        this.screen.set('quiz');
    }

    getProcessedText(): { parts: { type: 'text' | 'slot'; content?: string }[] } {
        const sentence = this.currentSentence();
        if (!sentence) return { parts: [] };

        const parts: { type: 'text' | 'slot'; content?: string }[] = [];
        const regex = /\[([^\]]+)\]/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        regex.lastIndex = 0;
        while ((match = regex.exec(sentence.text)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ type: 'text', content: sentence.text.substring(lastIndex, match.index) });
            }
            parts.push({ type: 'slot' });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < sentence.text.length) {
            parts.push({ type: 'text', content: sentence.text.substring(lastIndex) });
        }

        return { parts };
    }

    getSlotDisplay(): string {
        const sentence = this.currentSentence();
        if (!sentence) return '?';
        
        const answers = this.userAnswers();
        const answer = answers.get(sentence.id);
        return answer || '?';
    }

    getSlotClass(): string {
        const sentence = this.currentSentence();
        if (!sentence) return '';
        
        const answers = this.userAnswers();
        const answer = answers.get(sentence.id);
        
        if (!answer) return '';
        if (!this.answered()) return 'selected';
        
        // Normalize for comparison (case-insensitive)
        const normalizedAnswer = answer.toLowerCase();
        const normalizedCorrect = sentence.correct.toLowerCase();
        
        return normalizedAnswer === normalizedCorrect ? 'correct' : 'incorrect';
    }

    selectWord(word: string): void {
        if (this.answered()) return;
        
        const sentence = this.currentSentence();
        if (!sentence) return;
        
        // Preserve capitalization from correct answer if selecting the right word
        // Check if sentence starts with the slot (needs capital)
        const text = sentence.text;
        const startsWithSlot = text.startsWith('[');
        
        let selectedWord = word;
        if (startsWithSlot) {
            selectedWord = word.charAt(0).toUpperCase() + word.slice(1);
        }
        
        const answers = new Map(this.userAnswers());
        answers.set(sentence.id, selectedWord);
        this.userAnswers.set(answers);
    }

    checkAnswer(): void {
        const sentence = this.currentSentence();
        if (!sentence) return;
        
        const answers = this.userAnswers();
        const answer = answers.get(sentence.id);
        
        if (!answer) return;
        
        const normalizedAnswer = answer.toLowerCase();
        const normalizedCorrect = sentence.correct.toLowerCase();
        
        if (normalizedAnswer === normalizedCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);
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
            this.answered.set(false);
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
        this.selectedPairId.set('');
        this.currentPair.set(null);
    }

    playAgainSamePair(): void {
        this.startQuiz();
    }
}
