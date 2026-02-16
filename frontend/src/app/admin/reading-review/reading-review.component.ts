import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

interface TextSummary {
    id: number;
    title: string;
    autor: string | null;
    zyklus: number;
    minAge: number;
    wordCount: number;
    totalQuestions: number;
    approvedQuestions: number;
    pendingQuestions: number;
}

interface ReviewQuestion {
    id: number;
    textId: number;
    textTitle: string;
    tier: number;
    questionType: string;
    question: string;
    options: string[] | null;
    correctAnswer: string;
    explanation: string | null;
    paragraphIndex: number | null;
    aiGenerated: boolean;
    reviewed: number;
    createdAt: string;
}

@Component({
    selector: 'app-reading-review',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './reading-review.component.html',
    styleUrl: './reading-review.component.css'
})
export class ReadingReviewComponent implements OnInit {
    private http = inject(HttpClient);
    private router = inject(Router);

    loading = signal(true);
    texts = signal<TextSummary[]>([]);
    questions = signal<ReviewQuestion[]>([]);
    selectedTextId = signal<number | null>(null);
    filterReviewed = signal<string>('all');
    editingQuestion = signal<ReviewQuestion | null>(null);
    actionMessage = signal<string | null>(null);

    // Editing state
    editQuestion = '';
    editCorrectAnswer = '';
    editExplanation = '';
    editOptions: string[] = [];

    filteredQuestions = computed(() => {
        const qs = this.questions();
        const textId = this.selectedTextId();
        const filter = this.filterReviewed();

        let result = qs;
        if (textId) {
            result = result.filter(q => q.textId === textId);
        }
        if (filter === '0') {
            result = result.filter(q => q.reviewed === 0);
        } else if (filter === '1') {
            result = result.filter(q => q.reviewed === 1);
        }
        return result;
    });

    pendingCount = computed(() => this.questions().filter(q => q.reviewed === 0).length);
    approvedCount = computed(() => this.questions().filter(q => q.reviewed === 1).length);

    ngOnInit(): void {
        this.loadData();
    }

    async loadData(): Promise<void> {
        this.loading.set(true);
        try {
            const response = await firstValueFrom(
                this.http.get<{ texts: TextSummary[]; questions: ReviewQuestion[] }>(
                    '/api/admin/reading-questions'
                )
            );
            this.texts.set(response.texts);
            this.questions.set(response.questions);
        } catch (e) {
            console.error('Error loading reading questions:', e);
        } finally {
            this.loading.set(false);
        }
    }

    selectText(textId: number | null): void {
        this.selectedTextId.set(textId === this.selectedTextId() ? null : textId);
    }

    setFilter(filter: string): void {
        this.filterReviewed.set(filter);
    }

    async approveQuestion(q: ReviewQuestion): Promise<void> {
        try {
            await firstValueFrom(
                this.http.put('/api/admin/reading-questions', { id: q.id, reviewed: 1 })
            );
            q.reviewed = 1;
            this.questions.set([...this.questions()]);
            this.showMessage('✅ Frage genehmigt');
        } catch (e) {
            console.error('Error approving:', e);
        }
    }

    async deleteQuestion(q: ReviewQuestion): Promise<void> {
        if (!confirm(`Frage "${q.question.substring(0, 50)}..." wirklich löschen?`)) return;
        try {
            await firstValueFrom(
                this.http.delete(`/api/admin/reading-questions?id=${q.id}`)
            );
            this.questions.set(this.questions().filter(x => x.id !== q.id));
            this.showMessage('🗑️ Frage gelöscht');
        } catch (e) {
            console.error('Error deleting:', e);
        }
    }

    startEdit(q: ReviewQuestion): void {
        this.editingQuestion.set(q);
        this.editQuestion = q.question;
        this.editCorrectAnswer = q.correctAnswer;
        this.editExplanation = q.explanation || '';
        this.editOptions = q.options ? [...q.options] : [];
    }

    cancelEdit(): void {
        this.editingQuestion.set(null);
    }

    async saveEdit(): Promise<void> {
        const q = this.editingQuestion();
        if (!q) return;

        try {
            await firstValueFrom(
                this.http.put('/api/admin/reading-questions', {
                    id: q.id,
                    question: this.editQuestion,
                    correctAnswer: this.editCorrectAnswer,
                    explanation: this.editExplanation || null,
                    options: this.editOptions.length > 0 ? this.editOptions : null,
                    reviewed: 1,
                })
            );
            // Update in-memory
            const updated = this.questions().map(x => {
                if (x.id === q.id) {
                    return {
                        ...x,
                        question: this.editQuestion,
                        correctAnswer: this.editCorrectAnswer,
                        explanation: this.editExplanation || null,
                        options: this.editOptions.length > 0 ? [...this.editOptions] : null,
                        reviewed: 1,
                    };
                }
                return x;
            });
            this.questions.set(updated);
            this.editingQuestion.set(null);
            this.showMessage('✅ Frage gespeichert und genehmigt');
        } catch (e) {
            console.error('Error saving:', e);
        }
    }

    async approveAllForText(textId: number): Promise<void> {
        try {
            const result = await firstValueFrom(
                this.http.post<{ affected: number }>('/api/admin/reading-questions',
                    { action: 'approve-all', textId }
                )
            );
            // Update in-memory
            this.questions.set(this.questions().map(q =>
                q.textId === textId ? { ...q, reviewed: 1 } : q
            ));
            this.showMessage(`✅ ${result.affected} Fragen genehmigt`);
        } catch (e) {
            console.error('Error bulk approving:', e);
        }
    }

    getTierLabel(tier: number): string {
        switch (tier) {
            case 1: return 'Grundwissen';
            case 2: return 'Schlussfolgerung';
            case 3: return 'Analyse';
            default: return '?';
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

    getTypeLabel(type: string): string {
        switch (type) {
            case 'multiple_choice': return 'MC';
            case 'true_false': return 'W/F';
            case 'true_false_unknown': return 'W/F/U';
            default: return type;
        }
    }

    private showMessage(msg: string): void {
        this.actionMessage.set(msg);
        setTimeout(() => this.actionMessage.set(null), 3000);
    }

    goBack(): void {
        this.router.navigate(['/admin']);
    }
}
