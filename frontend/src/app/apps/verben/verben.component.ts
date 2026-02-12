import { Component, signal, computed, inject } from '@angular/core';
import { DataService } from '../../services/data.service';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { UserService } from '../../services/user.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';
import { shuffle } from '../../shared/utils/array.utils';

interface VerbData {
    verb: string;
    praeteritum: Record<string, string>;
    perfekt: Record<string, string>;
    plusquamperfekt: Record<string, string>;
    typicalMistakes?: {
        praeteritum?: Record<string, string>;
        perfekt?: Record<string, string>;
        plusquamperfekt?: Record<string, string>;
    };
    category?: string;
}

interface Question {
    verb: string;
    person: string;
    tense: 'praeteritum' | 'perfekt' | 'plusquamperfekt';
    answer: string;
    userAnswer?: string;
    isCorrect?: boolean;
}

// Zeitform mode question
interface TenseQuestion {
    verb: string;
    person: string;
    conjugated: string;
    correctTense: 'praeteritum' | 'perfekt' | 'plusquamperfekt';
    options: string[];
    selectedOption?: string;
    isCorrect?: boolean;
    _verbData?: VerbData;
}

// Multiple Choice mode question
interface MCQuestion {
    verb: string;
    person: string;
    tense: 'praeteritum' | 'perfekt' | 'plusquamperfekt';
    correctAnswer: string;
    options: { text: string; isCorrect: boolean; selected: boolean; disabled: boolean }[];
    isCorrect?: boolean;
    _verbData?: VerbData;
}

// Fehler finden mode question
interface FehlerQuestion {
    verb: string;
    tense: 'praeteritum' | 'perfekt' | 'plusquamperfekt';
    mistakePerson: string;
    mistakeForm: string;
    correctForm: string;
    options: { person: string; form: string; isMistake: boolean; selected: boolean; disabled: boolean }[];
    isCorrect?: boolean;
    _verbData?: VerbData;
}

type QuizMode = 'konjugation' | 'zeitform' | 'multiplechoice' | 'fehlerfinden';

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
    private userService = inject(UserService);
    private sessionId = this.telemetryService.generateSessionId();

    readonly tenseNames: Record<string, string> = {
        praeteritum: 'Präteritum',
        perfekt: 'Perfekt',
        plusquamperfekt: 'Plusquamperfekt'
    };

    readonly persons = ['ich', 'du', 'er/sie/es', 'wir', 'ihr', 'sie/Sie'];
    readonly tenses: ('praeteritum' | 'perfekt' | 'plusquamperfekt')[] = ['praeteritum', 'perfekt', 'plusquamperfekt'];

    readonly modes: { id: QuizMode; label: string; icon: string; description: string; minLevel?: number }[] = [
        { id: 'konjugation', label: 'Konjugation', icon: '✍️', description: 'Schreibe die richtige Verbform.' },
        { id: 'zeitform', label: 'Zeitform', icon: '🕐', description: 'Erkenne die Zeitform der konjugierten Form.' },
        { id: 'multiplechoice', label: 'Auswahl', icon: '🎯', description: 'Wähle die richtige Verbform aus vier Optionen.' },
        { id: 'fehlerfinden', label: 'Fehler finden', icon: '🔍', description: 'Finde die falsche Verbform unter fünf Optionen.', minLevel: 7 }
    ];

    userLevel = computed(() => this.userService.profile()?.learnLevel ?? 0);

    mode = signal<QuizMode>('konjugation');
    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    verbs = signal<VerbData[]>([]);

    // Mode: konjugation
    rounds = signal<Question[][]>([]);
    currentRoundIndex = signal(0);
    roundAnswers = signal<string[]>(['', '', '']);
    answered = signal(false);

    // Mode: zeitform
    tenseQuestions = signal<TenseQuestion[]>([]);
    currentTenseIndex = signal(0);
    tenseAnswered = signal(false);

    // Mode: multiplechoice
    mcQuestions = signal<MCQuestion[]>([]);
    currentMCIndex = signal(0);
    mcAnswered = signal(false);

    // Mode: fehlerfinden
    fehlerQuestions = signal<FehlerQuestion[]>([]);
    currentFehlerIndex = signal(0);
    fehlerAnswered = signal(false);

    totalCorrect = signal(0);
    totalQuestions = signal(15);

    // Computed: konjugation
    currentRound = computed(() => this.rounds()[this.currentRoundIndex()] || []);
    progress = computed(() => {
        if (this.mode() === 'konjugation') return (this.currentRoundIndex() / 5) * 100;
        if (this.mode() === 'zeitform') return (this.currentTenseIndex() / this.totalQuestions()) * 100;
        if (this.mode() === 'fehlerfinden') return (this.currentFehlerIndex() / this.totalQuestions()) * 100;
        return (this.currentMCIndex() / this.totalQuestions()) * 100;
    });
    percentage = computed(() => {
        const total = this.totalQuestions();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    // Computed: zeitform
    currentTenseQuestion = computed(() => this.tenseQuestions()[this.currentTenseIndex()]);

    // Computed: multiplechoice
    currentMCQuestion = computed(() => this.mcQuestions()[this.currentMCIndex()]);

    // Computed: fehlerfinden
    currentFehlerQuestion = computed(() => this.fehlerQuestions()[this.currentFehlerIndex()]);

    // Verbs that have typicalMistakes
    verbsWithMistakes = computed(() => this.verbs().filter(v => v.typicalMistakes && Object.keys(v.typicalMistakes).length > 0));

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.dataService.loadAppContent<VerbData>('verben').subscribe({
            next: (data) => this.verbs.set(data),
            error: (err) => console.error('Error loading verben data:', err)
        });
    }

    setMode(m: QuizMode): void {
        this.mode.set(m);
    }

    startQuiz(): void {
        this.totalCorrect.set(0);
        this.answered.set(false);

        switch (this.mode()) {
            case 'konjugation':
                this.startKonjugation();
                break;
            case 'zeitform':
                this.startZeitform();
                break;
            case 'multiplechoice':
                this.startMultipleChoice();
                break;
            case 'fehlerfinden':
                this.startFehlerFinden();
                break;
        }
        this.screen.set('quiz');
    }

    // ═══ MODE: KONJUGATION ═══

    private startKonjugation(): void {
        this.totalQuestions.set(15);
        const rounds: Question[][] = [];
        for (let r = 0; r < 5; r++) {
            const roundQuestions: Question[] = [];
            const shuffledVerbs = shuffle(this.verbs());
            const shuffledPersons = shuffle(this.persons);
            const shuffledTenses = shuffle(this.tenses);
            for (let q = 0; q < 3; q++) {
                const verb = shuffledVerbs[q];
                const person = shuffledPersons[q];
                const tense = shuffledTenses[q];
                roundQuestions.push({
                    verb: verb.verb,
                    person,
                    tense,
                    answer: verb[tense][person]
                });
            }
            rounds.push(roundQuestions);
        }
        this.rounds.set(rounds);
        this.currentRoundIndex.set(0);
        this.roundAnswers.set(['', '', '']);
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

        updatedRound.forEach(q => {
            const verb = this.verbs().find(v => v.verb === q.verb) as any;
            if (verb?._contentId) {
                this.telemetryService.trackProgress('verben', verb._contentId, !!q.isCorrect, this.mode());
            }
        });
    }

    nextRound(): void {
        if (this.currentRoundIndex() >= 4) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentRoundIndex.update(i => i + 1);
            this.roundAnswers.set(['', '', '']);
            this.answered.set(false);
        }
    }

    // ═══ MODE: ZEITFORM ═══

    private startZeitform(): void {
        const count = 10;
        this.totalQuestions.set(count);
        const questions: TenseQuestion[] = [];
        const shuffledVerbs = shuffle(this.verbs());

        for (let i = 0; i < count; i++) {
            const verb = shuffledVerbs[i % shuffledVerbs.length];
            const person = this.persons[Math.floor(Math.random() * this.persons.length)];
            const correctTense = this.tenses[Math.floor(Math.random() * this.tenses.length)];
            const conjugated = verb[correctTense][person];

            questions.push({
                verb: verb.verb,
                person,
                conjugated,
                correctTense,
                options: shuffle([...this.tenses]),
                _verbData: verb
            });
        }

        this.tenseQuestions.set(questions);
        this.currentTenseIndex.set(0);
        this.tenseAnswered.set(false);
    }

    selectTense(tense: string): void {
        if (this.tenseAnswered()) return;

        const q = this.currentTenseQuestion();
        if (!q) return;

        const isCorrect = tense === q.correctTense;
        const updated = [...this.tenseQuestions()];
        updated[this.currentTenseIndex()] = { ...q, selectedOption: tense, isCorrect };
        this.tenseQuestions.set(updated);
        this.tenseAnswered.set(true);

        if (isCorrect) this.totalCorrect.update(c => c + 1);

        const verb = q._verbData as any;
        if (verb?._contentId) {
            this.telemetryService.trackProgress('verben', verb._contentId, isCorrect, this.mode());
        }
    }

    nextTenseQuestion(): void {
        if (this.currentTenseIndex() >= this.totalQuestions() - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentTenseIndex.update(i => i + 1);
            this.tenseAnswered.set(false);
        }
    }

    // ═══ MODE: MULTIPLE CHOICE ═══

    private startMultipleChoice(): void {
        const count = 10;
        this.totalQuestions.set(count);
        const questions: MCQuestion[] = [];
        const shuffledVerbs = shuffle(this.verbs());

        for (let i = 0; i < count; i++) {
            const verb = shuffledVerbs[i % shuffledVerbs.length];
            const person = this.persons[Math.floor(Math.random() * this.persons.length)];
            const correctTense = this.tenses[Math.floor(Math.random() * this.tenses.length)];
            const correctAnswer = verb[correctTense][person];

            // Generate 3 wrong answers from other tenses/verbs
            const wrongAnswers = new Set<string>();
            // Wrong from same verb, different tenses
            for (const t of this.tenses) {
                if (t !== correctTense) {
                    wrongAnswers.add(verb[t][person]);
                }
            }
            // Wrong from other verbs, same tense
            for (const otherVerb of shuffle(this.verbs()).slice(0, 3)) {
                if (otherVerb.verb !== verb.verb) {
                    wrongAnswers.add(otherVerb[correctTense][person]);
                }
            }

            // Remove correct answer if it accidentally appears
            wrongAnswers.delete(correctAnswer);
            const distractors = shuffle([...wrongAnswers]).slice(0, 3);

            const allOptions = shuffle([correctAnswer, ...distractors]);

            questions.push({
                verb: verb.verb,
                person,
                tense: correctTense,
                correctAnswer,
                options: allOptions.map(text => ({
                    text,
                    isCorrect: text === correctAnswer,
                    selected: false,
                    disabled: false
                })),
                _verbData: verb
            });
        }

        this.mcQuestions.set(questions);
        this.currentMCIndex.set(0);
        this.mcAnswered.set(false);
    }

    selectMCOption(index: number): void {
        if (this.mcAnswered()) return;

        const q = this.currentMCQuestion();
        if (!q) return;

        const selected = q.options[index];
        const isCorrect = selected.isCorrect;

        const updatedOptions = q.options.map((opt, i) => ({
            ...opt,
            selected: i === index,
            disabled: true
        }));

        const updated = [...this.mcQuestions()];
        updated[this.currentMCIndex()] = { ...q, options: updatedOptions, isCorrect };
        this.mcQuestions.set(updated);
        this.mcAnswered.set(true);

        if (isCorrect) this.totalCorrect.update(c => c + 1);

        const verb = q._verbData as any;
        if (verb?._contentId) {
            this.telemetryService.trackProgress('verben', verb._contentId, isCorrect, this.mode());
        }
    }

    nextMCQuestion(): void {
        if (this.currentMCIndex() >= this.totalQuestions() - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentMCIndex.update(i => i + 1);
            this.mcAnswered.set(false);
        }
    }

    // ═══ MODE: FEHLER FINDEN ═══

    private startFehlerFinden(): void {
        const eligible = this.verbsWithMistakes();
        if (eligible.length === 0) {
            // Fallback if no verbs have typicalMistakes yet
            this.startMultipleChoice();
            return;
        }

        const count = Math.min(10, eligible.length * 3); // At most 3 questions per verb
        this.totalQuestions.set(count);
        const questions: FehlerQuestion[] = [];
        const shuffledVerbs = shuffle(eligible);

        for (let i = 0; i < count; i++) {
            const verb = shuffledVerbs[i % shuffledVerbs.length];
            const mistakes = verb.typicalMistakes!;

            // Pick a tense that has a mistake defined
            const availableTenses = this.tenses.filter(t => mistakes[t] && Object.keys(mistakes[t]!).length > 0);
            if (availableTenses.length === 0) continue;

            const tense = availableTenses[Math.floor(Math.random() * availableTenses.length)];
            const mistakeEntries = Object.entries(mistakes[tense]!);
            const [mistakePerson, mistakeForm] = mistakeEntries[Math.floor(Math.random() * mistakeEntries.length)];
            const correctForm = verb[tense][mistakePerson];

            // Build options: 4 correct conjugations + 1 mistake
            const correctPersons = shuffle(this.persons.filter(p => p !== mistakePerson)).slice(0, 4);
            const options: FehlerQuestion['options'] = correctPersons.map(p => ({
                person: p,
                form: verb[tense][p],
                isMistake: false,
                selected: false,
                disabled: false
            }));

            // Insert the mistake at a random position
            const mistakeOption = {
                person: mistakePerson,
                form: mistakeForm,
                isMistake: true,
                selected: false,
                disabled: false
            };
            const insertIdx = Math.floor(Math.random() * (options.length + 1));
            options.splice(insertIdx, 0, mistakeOption);

            questions.push({
                verb: verb.verb,
                tense,
                mistakePerson,
                mistakeForm,
                correctForm,
                options,
                _verbData: verb
            });
        }

        this.fehlerQuestions.set(questions);
        this.currentFehlerIndex.set(0);
        this.fehlerAnswered.set(false);
    }

    selectFehlerOption(index: number): void {
        if (this.fehlerAnswered()) return;

        const q = this.currentFehlerQuestion();
        if (!q) return;

        const selected = q.options[index];
        const isCorrect = selected.isMistake; // User should tap the WRONG one

        const updatedOptions = q.options.map((opt, i) => ({
            ...opt,
            selected: i === index,
            disabled: true
        }));

        const updated = [...this.fehlerQuestions()];
        updated[this.currentFehlerIndex()] = { ...q, options: updatedOptions, isCorrect };
        this.fehlerQuestions.set(updated);
        this.fehlerAnswered.set(true);

        if (isCorrect) this.totalCorrect.update(c => c + 1);

        const verb = q._verbData as any;
        if (verb?._contentId) {
            this.telemetryService.trackProgress('verben', verb._contentId, isCorrect, this.mode());
        }
    }

    nextFehlerQuestion(): void {
        if (this.currentFehlerIndex() >= this.totalQuestions() - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentFehlerIndex.update(i => i + 1);
            this.fehlerAnswered.set(false);
        }
    }

    // ═══ SHARED ═══

    restartQuiz(): void {
        this.screen.set('welcome');
    }
}
