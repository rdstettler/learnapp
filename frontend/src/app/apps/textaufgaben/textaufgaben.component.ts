import { Component, signal, computed, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { ApiService } from '../../services/api.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { shuffle } from '../../shared/utils/array.utils';

interface TextaufgabeItem {
    id: string;
    topics: string[];
    question: string;
    answers: string[];
    explanation: string;
}


@Component({
    selector: 'app-textaufgaben',
    standalone: true,
    imports: [RouterLink, LearningAppLayoutComponent],
    templateUrl: './textaufgaben.component.html',
    styleUrl: './textaufgaben.component.css'
})
export class TextaufgabenComponent {
    private dataService = inject(DataService);
    private apiService = inject(ApiService);
    private router = inject(Router);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    items = signal<TextaufgabeItem[]>([]);
    rounds = signal<TextaufgabeItem[]>([]);
    currentRound = signal(0);

    // AI Session
    isSessionMode = false;
    sessionTaskId: number | null = null;
    sessionTaskIds: number[] | null = null;

    userAnswer = signal('');
    answered = signal(false);
    isCorrect = signal(false);
    feedbackText = signal('');
    showExplanation = signal(false);

    totalCorrect = signal(0);
    totalQuestions = signal(5);

    progress = computed(() => (this.currentRound() / this.totalQuestions()) * 100);
    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        const state = window.history.state;
        if (state && state.learningContent && state.sessionId) {
            this.isSessionMode = true;
            this.sessionTaskId = state.taskId;
            this.sessionTaskIds = state.taskIds;

            // Map content. 
            // Determine if content is array or single item?
            // If AI returns tasks: [ { content: { ... } } ], then content is single object.
            // But Textaufgaben usually runs 5 rounds.
            // Did we ask AI for 5 tasks in the array?
            // In learning-session.ts we ask for 3-5 tasks total session.
            // A single TASK in the session might contain multiple questions? 
            // "For each task, generate SPECIFIC content that follows ... JSON Schema"
            // If schema is Object, we get 1 Object.
            // If Schema is Array, we get Array.
            // The schema I just added is OBJECT. "{ ... }"
            // So we get 1 question per task?
            // If so, `rounds` should have 1 item.

            let loadedItems: TextaufgabeItem[] = [];

            if (Array.isArray(state.learningContent)) {
                loadedItems = state.learningContent;
            } else if (state.learningContent.question) {
                // Single object
                loadedItems = [{
                    id: 'ai-gen',
                    topics: ['ai'],
                    question: state.learningContent.question,
                    answers: state.learningContent.answers || [],
                    explanation: state.learningContent.explanation || ''
                }];
            }

            if (loadedItems.length > 0) {
                this.items.set(loadedItems);
                this.totalQuestions.set(loadedItems.length); // Dynamic
                this.screen.set('welcome');
                return;
            }
        }

        // Fallback ApiService check
        const sessionTask = this.apiService.getSessionTask('textaufgaben');
        if (sessionTask) {
            this.isSessionMode = true;
            this.sessionTaskId = sessionTask.id;
            // Assume sessionTask content can be array or single
            let loadedItems: TextaufgabeItem[] = [];
            if (Array.isArray(sessionTask.content)) {
                loadedItems = sessionTask.content;
            } else if (sessionTask.content && sessionTask.content['question']) {
                loadedItems = [{
                    id: 'ai-gen',
                    topics: ['ai'],
                    question: sessionTask.content['question'] as string,
                    answers: (sessionTask.content['answers'] as string[]) || [],
                    explanation: (sessionTask.content['explanation'] as string) || ''
                }];
            }
            if (loadedItems.length > 0) {
                this.items.set(loadedItems);
                this.totalQuestions.set(loadedItems.length);
                return;
            }
        }

        // Default
        this.dataService.loadAppContent<TextaufgabeItem>('textaufgaben').subscribe({
            next: (data) => {
                this.items.set(data);
                this.totalQuestions.set(5);
            },
            error: (err) => console.error('Error loading textaufgaben data:', err)
        });
    }

    startQuiz(): void {
        let quizRounds: TextaufgabeItem[];
        if (this.isSessionMode) {
            quizRounds = [...this.items()];
        } else {
            quizRounds = shuffle(this.items()).slice(0, 5);
        }

        this.rounds.set(quizRounds);
        this.currentRound.set(0);
        this.totalCorrect.set(0);
        // Ensure totalQuestions is synced with actual rounds
        this.totalQuestions.set(quizRounds.length);

        this.screen.set('quiz');
        this.showRound();
    }

    // ... showRound/getCurrentProblem/updateAnswer/checkAnswer/toggleExplanation ...
    private showRound(): void {
        this.userAnswer.set('');
        this.answered.set(false);
        this.feedbackText.set('');
        this.showExplanation.set(false);
    }

    getCurrentProblem(): TextaufgabeItem | null {
        return this.rounds()[this.currentRound()] || null;
    }

    updateAnswer(value: string): void {
        this.userAnswer.set(value);
    }

    checkAnswer(): void {
        const problem = this.getCurrentProblem();
        if (!problem) return;

        const userAnswerNormalized = this.userAnswer().trim().toLowerCase().replace(',', '.');
        const correct = problem.answers.some(ans =>
            ans.toLowerCase().replace(',', '.') === userAnswerNormalized
        );

        this.isCorrect.set(correct);
        this.answered.set(true);

        if (correct) {
            this.totalCorrect.update(c => c + 1);
            this.feedbackText.set('✓ Richtig!');
        } else {
            this.feedbackText.set(`✗ Falsch! Richtige Antwort: ${problem.answers[0]}`);

            // Telemetry: Track error
            const content = JSON.stringify({
                questionId: problem.id,
                question: problem.question,
                actual: this.userAnswer()
            });
            this.telemetryService.trackError('textaufgaben', content, this.sessionId);
        }
    }

    toggleExplanation(): void {
        this.showExplanation.update(v => !v);
    }

    nextRound(): void {
        if (this.currentRound() >= this.rounds().length - 1) {
            if (this.isSessionMode) {
                if (this.sessionTaskIds && this.sessionTaskIds.length > 0) {
                    this.apiService.completeTask(this.sessionTaskIds);
                } else if (this.sessionTaskId) {
                    this.apiService.completeTask(this.sessionTaskId);
                }
            }
            this.screen.set('results');
        } else {
            this.currentRound.update(r => r + 1);
            this.showRound();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
