import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { UserService } from '../../services/user.service';

interface ReadingQuestion {
    id: number;
    tier: number;
    questionType: 'multiple_choice' | 'true_false' | 'true_false_unknown';
    question: string;
    options: string[] | null;
    correctAnswer: string;
    explanation: string | null;
    paragraphIndex: number | null;
}

interface ReadingText {
    id: number;
    title: string;
    text: string;
    sourceUrl: string | null;
    thema: string | null;
    minAge: number;
    zyklus: number;
    wordCount: number;
}

interface AvailableText {
    id: number;
    title: string;
    zyklus: number;
    wordCount: number;
}

@Component({
    selector: 'app-textverstaendnis',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './textverstaendnis.component.html',
    styleUrl: './textverstaendnis.component.css'
})
export class TextverstaendnisComponent implements OnInit {
    private http = inject(HttpClient);
    private router = inject(Router);
    private userService = inject(UserService);

    loading = signal(true);
    error = signal<string | null>(null);
    readingText = signal<ReadingText | null>(null);
    questions = signal<ReadingQuestion[]>([]);
    availableTexts = signal<AvailableText[]>([]);

    // User progress state
    currentQuestionIndex = signal(0);
    answers = signal<Map<number, string>>(new Map());
    revealed = signal<Set<number>>(new Set());
    score = signal(0);
    totalAnswered = signal(0);
    finished = signal(false);

    // Chunked mode state
    currentChunkIndex = signal(0);

    // Text paragraphs (split by newline)
    paragraphs = computed(() => {
        const text = this.readingText();
        if (!text) return [];
        return text.text.split('\n').filter(p => p.trim().length > 0);
    });

    // Determine display mode
    isChunkedMode = computed(() => {
        const level = this.userService.profile()?.learnLevel;
        if (!level || level === -1) return false;
        return level >= 4 && level <= 6;
    });

    // Split paragraphs into chunks of ~3-4 for chunked mode
    chunks = computed(() => {
        const paras = this.paragraphs();
        const chunkList: string[][] = [];
        let current: string[] = [];
        let sentenceCount = 0;

        for (const para of paras) {
            const sentences = para.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
            current.push(para);
            sentenceCount += sentences;
            if (sentenceCount >= 3) {
                chunkList.push(current);
                current = [];
                sentenceCount = 0;
            }
        }
        if (current.length > 0) chunkList.push(current);
        return chunkList;
    });

    // Questions for current chunk (in chunked mode)
    currentChunkQuestions = computed(() => {
        const idx = this.currentChunkIndex();
        const qs = this.questions();
        return qs.filter(q => q.paragraphIndex === idx + 1);
    });

    // Visible questions (all for full mode, chunk-specific for chunked)
    visibleQuestions = computed(() => {
        if (this.isChunkedMode()) {
            return this.currentChunkQuestions();
        }
        return this.questions();
    });

    // Max Zyklus from user level
    maxZyklus = computed(() => {
        const level = this.userService.profile()?.learnLevel;
        if (!level || level === -1) return 3;
        if (level <= 4) return 1;
        if (level <= 8) return 2;
        return 3;
    });

    ngOnInit(): void {
        this.loadText();
    }

    async loadText(textId?: number): Promise<void> {
        this.loading.set(true);
        this.error.set(null);
        this.resetProgress();

        try {
            const z = this.maxZyklus();
            let url = `/api/apps?app_id=textverstaendnis&max_zyklus=${z}`;
            if (textId) url += `&text_id=${textId}`;

            const response = await firstValueFrom(
                this.http.get<{ text: ReadingText; questions: ReadingQuestion[]; availableTexts: AvailableText[] }>(url)
            );

            this.readingText.set(response.text);
            this.questions.set(response.questions);
            this.availableTexts.set(response.availableTexts);

            if (response.questions.length === 0) {
                this.error.set('Für diesen Text sind noch keine Fragen verfügbar.');
            }
        } catch (e: any) {
            console.error('Error loading text:', e);
            this.error.set('Fehler beim Laden des Textes.');
        } finally {
            this.loading.set(false);
        }
    }

    private resetProgress(): void {
        this.currentQuestionIndex.set(0);
        this.answers.set(new Map());
        this.revealed.set(new Set());
        this.score.set(0);
        this.totalAnswered.set(0);
        this.finished.set(false);
        this.currentChunkIndex.set(0);
    }

    selectAnswer(questionId: number, answer: string): void {
        const answers = new Map(this.answers());
        if (answers.has(questionId)) return; // Already answered

        answers.set(questionId, answer);
        this.answers.set(answers);

        // Check correctness
        const question = this.questions().find(q => q.id === questionId);
        if (question && answer === question.correctAnswer) {
            this.score.update(s => s + 1);
        }
        this.totalAnswered.update(t => t + 1);

        // Auto-reveal explanation
        const rev = new Set(this.revealed());
        rev.add(questionId);
        this.revealed.set(rev);

        // Check if all questions answered
        const total = this.visibleQuestions().length;
        const answeredInView = this.visibleQuestions().filter(q => answers.has(q.id)).length;
        if (answeredInView === total && !this.isChunkedMode()) {
            this.finished.set(true);
        }
    }

    isCorrect(questionId: number): boolean | null {
        const answer = this.answers().get(questionId);
        if (!answer) return null;
        const question = this.questions().find(q => q.id === questionId);
        return question ? answer === question.correctAnswer : null;
    }

    isRevealed(questionId: number): boolean {
        return this.revealed().has(questionId);
    }

    getAnswer(questionId: number): string | undefined {
        return this.answers().get(questionId);
    }

    // Chunked mode: advance to next chunk
    nextChunk(): void {
        const maxChunks = this.chunks().length;
        const current = this.currentChunkIndex();
        if (current < maxChunks - 1) {
            this.currentChunkIndex.set(current + 1);
        } else {
            this.finished.set(true);
        }
    }

    canAdvanceChunk(): boolean {
        const qs = this.currentChunkQuestions();
        if (qs.length === 0) return true;
        return qs.every(q => this.answers().has(q.id));
    }

    selectText(textId: number): void {
        this.loadText(textId);
    }

    getTierLabel(tier: number): string {
        switch (tier) {
            case 1: return 'Grundwissen';
            case 2: return 'Schlussfolgerung';
            case 3: return 'Analyse';
            default: return '';
        }
    }

    getTierColor(tier: number): string {
        switch (tier) {
            case 1: return '#4ade80';
            case 2: return '#facc15';
            case 3: return '#f87171';
            default: return '#888';
        }
    }

    getScorePercent(): number {
        const total = this.totalAnswered();
        if (total === 0) return 0;
        return Math.round(this.score() / total * 100);
    }

    scrollToText(): void {
        document.getElementById('text-body')?.scrollIntoView({ behavior: 'smooth' });
    }

    goBack(): void {
        this.router.navigate(['/']);
    }
}
