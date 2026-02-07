import { Component, signal, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { shuffle } from '../../shared/utils/array.utils';

interface VerbData {
    verb: string;
    praeteritum: Record<string, string>;
    perfekt: Record<string, string>;
    plusquamperfekt: Record<string, string>;
}

interface Question {
    verb: string;
    person: string;
    tense: 'praeteritum' | 'perfekt' | 'plusquamperfekt';
    answer: string;
    userAnswer?: string;
    isCorrect?: boolean;
}

@Component({
    selector: 'app-verben',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './verben.component.html',
    styleUrl: './verben.component.css'
})
export class VerbenComponent {
    private dataService = inject(DataService);
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly tenseNames: Record<string, string> = {
        praeteritum: 'Präteritum',
        perfekt: 'Perfekt',
        plusquamperfekt: 'Plusquamperfekt'
    };

    readonly persons = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'];
    readonly tenses: ('praeteritum' | 'perfekt' | 'plusquamperfekt')[] = ['praeteritum', 'perfekt', 'plusquamperfekt'];

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    verbs = signal<VerbData[]>([]);
    rounds = signal<Question[][]>([]);
    currentRoundIndex = signal(0);
    roundAnswers = signal<string[]>(['', '', '']);
    answered = signal(false);

    totalCorrect = signal(0);
    totalQuestions = signal(15);

    currentRound = computed(() => this.rounds()[this.currentRoundIndex()] || []);
    progress = computed(() => (this.currentRoundIndex() / 5) * 100);
    percentage = computed(() => Math.round((this.totalCorrect() / this.totalQuestions()) * 100));

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<VerbData>('verben').subscribe({
            next: (data) => this.verbs.set(data),
            error: (err) => console.error('Error loading verben data:', err)
        });
    }

    private shuffle<T>(array: T[]): T[] {
        return shuffle(array);
    }

    private generateRounds(): void {
        const rounds: Question[][] = [];

        for (let r = 0; r < 5; r++) {
            const roundQuestions: Question[] = [];
            const shuffledVerbs = this.shuffle(this.verbs());
            const shuffledPersons = this.shuffle(this.persons);
            const shuffledTenses = this.shuffle(this.tenses);

            for (let q = 0; q < 3; q++) {
                const verb = shuffledVerbs[q];
                const person = shuffledPersons[q];
                const tense = shuffledTenses[q];

                roundQuestions.push({
                    verb: verb.verb,
                    person: person,
                    tense: tense,
                    answer: verb[tense][person]
                });
            }
            rounds.push(roundQuestions);
        }

        this.rounds.set(rounds);
    }

    startQuiz(): void {
        this.generateRounds();
        this.currentRoundIndex.set(0);
        this.totalCorrect.set(0);
        this.roundAnswers.set(['', '', '']);
        this.answered.set(false);
        this.screen.set('quiz');
    }

    updateAnswer(index: number, value: string): void {
        const answers = [...this.roundAnswers()];
        answers[index] = value;
        this.roundAnswers.set(answers);
    }

    checkAnswers(): void {
        const round = this.currentRound();
        const answers = this.roundAnswers();
        let correct = 0;

        const updatedRound = round.map((q, i) => {
            const userAnswer = answers[i].trim().toLowerCase();
            const correctAnswer = q.answer.toLowerCase();
            const pronoun = q.person.split('/')[0].toLowerCase();

            const answerWithoutPronoun = correctAnswer.replace(pronoun + ' ', '');
            const userWithoutPronoun = userAnswer.replace(pronoun + ' ', '');

            const isCorrect =
                userAnswer === correctAnswer ||
                userAnswer === answerWithoutPronoun ||
                userWithoutPronoun === answerWithoutPronoun;

            if (isCorrect) correct++;

            return { ...q, userAnswer: answers[i], isCorrect };
        });

        const rounds = [...this.rounds()];
        rounds[this.currentRoundIndex()] = updatedRound;
        this.rounds.set(rounds);
        this.totalCorrect.update(c => c + correct);
        this.answered.set(true);

        // Telemetry: Track errors
        const errors = updatedRound.filter(q => !q.isCorrect);
        if (errors.length > 0) {
            const content = JSON.stringify({
                round: this.currentRoundIndex(),
                errors: errors.map(q => ({
                    verb: q.verb,
                    person: q.person,
                    tense: q.tense,
                    expected: q.answer,
                    actual: q.userAnswer
                }))
            });
            this.telemetryService.trackError('verben', content, this.sessionId);
        }
    }

    nextRound(): void {
        if (this.currentRoundIndex() >= 4) {
            this.screen.set('results');
        } else {
            this.currentRoundIndex.update(i => i + 1);
            this.roundAnswers.set(['', '', '']);
            this.answered.set(false);
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
