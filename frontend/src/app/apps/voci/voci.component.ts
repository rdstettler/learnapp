import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';
import { ModeSelectorComponent } from '../../shared/components/mode-btn';
import { normalizeGermanText } from '../../shared/utils/text.utils';
import { shuffle } from '../../shared/utils/array.utils';

export interface VociWord {
    id: string;
    lang_code: string;
    de_word: string;
    target_word: string;
    topic: string;
}

type QuizMode = 'de_to_target' | 'target_to_de' | 'mixed';

/** Language configuration lookup */
const LANG_CONFIG: Record<string, { name: string; flag: string; label: string }> = {
    fr: { name: 'Französisch', flag: '🇫🇷', label: 'FR' },
    en: { name: 'Englisch', flag: '🇬🇧', label: 'EN' },
    it: { name: 'Italienisch', flag: '🇮🇹', label: 'IT' },
    es: { name: 'Spanisch', flag: '🇪🇸', label: 'ES' },
};

const TOPIC_LABELS: Record<string, string> = {
    food: '🍎 Essen',
    colors: '🎨 Farben',
    nature: '🌿 Natur',
    activities: '🏃 Aktivitäten',
};

@Component({
    selector: 'app-voci',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        LearningAppLayoutComponent,
        ModeSelectorComponent,
    ],
    templateUrl: './voci.component.html',
    styleUrl: './voci.component.css'
})
export class VociComponent implements OnInit {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private route = inject(ActivatedRoute);

    /** Current language code from route, e.g. 'fr', 'en' */
    langCode = signal<string>('fr');

    /** Resolved language config */
    langConfig = computed(() => LANG_CONFIG[this.langCode()] ?? { name: this.langCode().toUpperCase(), flag: '🌍', label: this.langCode().toUpperCase() });

    /** Dynamic page title */
    pageTitle = computed(() => `${this.langConfig().flag} ${this.langConfig().name} Vokabeln`);

    readonly interactionModes: { id: 'typing' | 'flashcard'; label: string; icon: string; description: string }[] = [
        { id: 'typing', label: 'Tippen', icon: '⌨️', description: 'Tippe die genaue Übersetzung ein.' },
        { id: 'flashcard', label: 'Karteikarte', icon: '📇', description: 'Überprüfe mental und decke die Antwort auf.' }
    ];
    interactionMode = signal<'typing' | 'flashcard'>('typing');

    /** Dynamic translation direction modes based on current language */
    directionModes = computed<{ id: QuizMode; label: string; icon: string; description: string }[]>(() => {
        const cfg = this.langConfig();
        return [
            { id: 'de_to_target', label: `DE → ${cfg.label}`, icon: '🇩🇪', description: `Übersetze vom Deutschen ins ${cfg.name}.` },
            { id: 'target_to_de', label: `${cfg.label} → DE`, icon: cfg.flag, description: `Übersetze vom ${cfg.name} ins Deutsche.` },
            { id: 'mixed', label: 'Gemischt', icon: '🔀', description: 'Beide Richtungen gemischt.' }
        ];
    });
    mode = signal<QuizMode>('de_to_target');

    topics = signal<string[]>(['food', 'colors', 'nature', 'activities']);
    selectedTopic = signal<string>(''); // empty means all

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    words = signal<VociWord[]>([]);
    quizQueue = signal<VociWord[]>([]);
    currentWordIndex = signal(0);

    // Quiz state
    userInput = signal<string>('');
    answered = signal(false);
    flashcardRevealed = signal(false);
    isCorrect = signal(false);

    totalCorrect = signal(0);
    totalWrong = signal(0);

    readonly WORDS_PER_ROUND = 15;

    dataLoaded = computed(() => this.words().length > 0);

    progress = computed(() => {
        if (this.quizQueue().length === 0) return 0;
        return (this.currentWordIndex() / this.quizQueue().length) * 100;
    });

    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    currentWord = computed(() => {
        const queue = this.quizQueue();
        if (queue.length === 0 || this.currentWordIndex() >= queue.length) return null;
        return queue[this.currentWordIndex()];
    });

    // Determines the challenge word display and target answer based on mode
    currentChallenge = computed(() => {
        const word = this.currentWord();
        if (!word) return { prompt: '', answer: '', lang: '', langIcon: '' };
        const cfg = this.langConfig();

        let m = this.mode();
        if (m === 'mixed') {
            m = Math.random() > 0.5 ? 'de_to_target' : 'target_to_de';
        }

        if (m === 'de_to_target') {
            return { prompt: word.de_word, answer: word.target_word, lang: cfg.label, langIcon: '🇩🇪' };
        } else {
            return { prompt: word.target_word, answer: word.de_word, lang: 'DE', langIcon: cfg.flag };
        }
    });

    ngOnInit(): void {
        // Read langCode from route param
        const paramLang = this.route.snapshot.paramMap.get('langCode');
        if (paramLang) {
            this.langCode.set(paramLang);
        }
        this.loadData();
    }

    topicLabel(topic: string): string {
        return TOPIC_LABELS[topic] ?? topic;
    }

    private loadData(): void {
        this.dataService.loadVociData(this.langCode()).subscribe({
            next: (data) => {
                this.words.set(data);
                // Extract unique topics
                const uniqueTopics = [...new Set(data.map((w: any) => w.topic))].filter(Boolean);
                if (uniqueTopics.length > 0) {
                    this.topics.set(uniqueTopics);
                }
            },
            error: (err) => console.error('Error loading voci data:', err)
        });
    }

    selectTopic(event: Event): void {
        this.selectedTopic.set((event.target as HTMLSelectElement).value);
    }

    startQuiz(): void {
        let pool = this.words();
        if (this.selectedTopic()) {
            pool = pool.filter(w => w.topic === this.selectedTopic());
        }

        if (pool.length === 0) return;

        const shuffled = shuffle([...pool]);
        this.quizQueue.set(shuffled.slice(0, Math.min(this.WORDS_PER_ROUND, shuffled.length)));

        this.currentWordIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.resetTurn();
        this.screen.set('quiz');
    }

    private resetTurn(): void {
        this.userInput.set('');
        this.answered.set(false);
        this.flashcardRevealed.set(false);
        this.isCorrect.set(false);
    }

    revealFlashcard(): void {
        this.flashcardRevealed.set(true);
    }

    assessFlashcard(correct: boolean): void {
        this.isCorrect.set(correct);
        if (correct) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(c => c + 1);
        }
        this.answered.set(true);

        const word = this.currentWord();
        if (word && word.id) {
            try {
                this.telemetryService.trackCategoryProgress('voci', word.id, correct, this.mode());
            } catch (e) {}
        }
    }

    checkAnswer(): void {
        if (this.answered() || !this.userInput().trim()) return;

        const challenge = this.currentChallenge();
        const input = this.userInput().trim();

        const normalizedInput = input.toLowerCase().replace(/[.,!?;:]/g, '');
        const normalizedAnswer = challenge.answer.toLowerCase().replace(/[.,!?;:]/g, '');

        if (normalizedInput === normalizedAnswer || normalizeGermanText(normalizedInput) === normalizeGermanText(normalizedAnswer)) {
            this.isCorrect.set(true);
            this.totalCorrect.update(c => c + 1);
        } else {
            this.isCorrect.set(false);
            this.totalWrong.update(c => c + 1);
        }

        this.answered.set(true);

        const word = this.currentWord();
        if (word && word.id) {
            try {
                this.telemetryService.trackCategoryProgress('voci', word.id, this.isCorrect(), this.mode());
            } catch (e) {
                // Ignore if telemetry isn't fully ready
            }
        }
    }

    nextWord(): void {
        const nextIndex = this.currentWordIndex() + 1;

        if (nextIndex >= this.quizQueue().length) {
            this.screen.set('results');
            if (this.percentage() >= 80) launchConfetti();
        } else {
            this.currentWordIndex.set(nextIndex);
            this.resetTurn();
        }
    }

    onInputKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            if (!this.answered()) {
                this.checkAnswer();
            } else {
                this.nextWord();
            }
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
