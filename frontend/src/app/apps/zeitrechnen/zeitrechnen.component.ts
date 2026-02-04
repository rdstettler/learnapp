import { Component, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';

type ProblemType = 'mixed-to-single' | 'single-to-mixed' | 'fraction';

interface TimeProblem {
    type: ProblemType;
    question: string;
    correctAnswer: string;
    acceptedAnswers: string[];
    explanation: string;
}

import { AppTelemetryService } from '../../services/app-telemetry.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-zeitrechnen',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './zeitrechnen.component.html',
    styleUrl: './zeitrechnen.component.css'
})
export class ZeitrechnenComponent {
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();
    readonly PROBLEMS_PER_ROUND = 10;

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');

    currentProblem = signal<TimeProblem | null>(null);
    problemIndex = signal(0);

    userAnswer = signal('');
    answered = signal(false);
    isCorrect = signal(false);

    totalCorrect = signal(0);
    totalWrong = signal(0);

    progress = computed(() => (this.problemIndex() / this.PROBLEMS_PER_ROUND) * 100);
    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    startQuiz(): void {
        this.problemIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
        this.generateProblem();
    }

    private generateProblem(): void {
        const types: ProblemType[] = ['mixed-to-single', 'single-to-mixed', 'fraction'];
        const type = types[Math.floor(Math.random() * types.length)];

        let problem: TimeProblem;

        switch (type) {
            case 'mixed-to-single':
                problem = this.generateMixedToSingle();
                break;
            case 'single-to-mixed':
                problem = this.generateSingleToMixed();
                break;
            case 'fraction':
                problem = this.generateFraction();
                break;
        }

        this.currentProblem.set(problem);
        this.userAnswer.set('');
        this.answered.set(false);
    }

    private generateMixedToSingle(): TimeProblem {
        // Entscheide: h+min+s → s ODER h+min → min
        const toSeconds = Math.random() < 0.5;

        if (toSeconds) {
            // x h y min z s → ? s
            const hours = Math.floor(Math.random() * 3); // 0-2 Stunden
            const minutes = Math.floor(Math.random() * 60); // 0-59 Minuten
            const seconds = Math.floor(Math.random() * 60); // 0-59 Sekunden

            // Mindestens eine Komponente > 0
            const h = hours || (!minutes && !seconds ? 1 : 0);
            const m = minutes;
            const s = seconds;

            const totalSeconds = h * 3600 + m * 60 + s;

            // Baue Frage-String
            const parts: string[] = [];
            if (h > 0) parts.push(`${h} h`);
            if (m > 0) parts.push(`${m} min`);
            if (s > 0) parts.push(`${s} s`);

            const question = `${parts.join(' ')} = ? s`;

            return {
                type: 'mixed-to-single',
                question,
                correctAnswer: `${totalSeconds} s`,
                acceptedAnswers: [
                    `${totalSeconds}`,
                    `${totalSeconds}s`,
                    `${totalSeconds} s`
                ],
                explanation: `${h > 0 ? `${h} × 3600 = ${h * 3600}` : ''}${h > 0 && m > 0 ? ' + ' : ''}${m > 0 ? `${m} × 60 = ${m * 60}` : ''}${(h > 0 || m > 0) && s > 0 ? ' + ' : ''}${s > 0 ? `${s}` : ''} = ${totalSeconds} s`
            };
        } else {
            // x h y min → ? min
            const hours = Math.floor(Math.random() * 5) + 1; // 1-5 Stunden
            const minutes = Math.floor(Math.random() * 60); // 0-59 Minuten

            const totalMinutes = hours * 60 + minutes;

            const parts: string[] = [`${hours} h`];
            if (minutes > 0) parts.push(`${minutes} min`);

            const question = `${parts.join(' ')} = ? min`;

            return {
                type: 'mixed-to-single',
                question,
                correctAnswer: `${totalMinutes} min`,
                acceptedAnswers: [
                    `${totalMinutes}`,
                    `${totalMinutes}min`,
                    `${totalMinutes} min`
                ],
                explanation: `${hours} × 60 = ${hours * 60}${minutes > 0 ? ` + ${minutes} = ${totalMinutes}` : ''} min`
            };
        }
    }

    private generateSingleToMixed(): TimeProblem {
        // Entscheide: min → h min ODER s → min s
        const fromMinutes = Math.random() < 0.5;

        if (fromMinutes) {
            // x min → ? h ? min
            const totalMinutes = Math.floor(Math.random() * 180) + 61; // 61-240 Minuten
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            const question = `${totalMinutes} min = ? h ? min`;

            const answers: string[] = [
                `${hours}h ${minutes}min`,
                `${hours} h ${minutes} min`,
                `${hours}h${minutes}min`,
                `${hours} h ${minutes}min`,
                `${hours}h ${minutes} min`
            ];

            // Falls Minuten = 0
            if (minutes === 0) {
                answers.push(`${hours}h`, `${hours} h`, `${hours}h 0min`, `${hours} h 0 min`);
            }

            return {
                type: 'single-to-mixed',
                question,
                correctAnswer: `${hours} h ${minutes} min`,
                acceptedAnswers: answers,
                explanation: `${totalMinutes} ÷ 60 = ${hours} Rest ${minutes}, also ${hours} h ${minutes} min`
            };
        } else {
            // x s → ? min ? s
            const totalSeconds = Math.floor(Math.random() * 300) + 61; // 61-360 Sekunden
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;

            const question = `${totalSeconds} s = ? min ? s`;

            const answers: string[] = [
                `${minutes}min ${seconds}s`,
                `${minutes} min ${seconds} s`,
                `${minutes}min${seconds}s`,
                `${minutes} min ${seconds}s`,
                `${minutes}min ${seconds} s`
            ];

            // Falls Sekunden = 0
            if (seconds === 0) {
                answers.push(`${minutes}min`, `${minutes} min`, `${minutes}min 0s`, `${minutes} min 0 s`);
            }

            return {
                type: 'single-to-mixed',
                question,
                correctAnswer: `${minutes} min ${seconds} s`,
                acceptedAnswers: answers,
                explanation: `${totalSeconds} ÷ 60 = ${minutes} Rest ${seconds}, also ${minutes} min ${seconds} s`
            };
        }
    }

    private gcd(a: number, b: number): number {
        return b === 0 ? a : this.gcd(b, a % b);
    }

    private generateFraction(): TimeProblem {
        // Generiere zufälligen Wert von 1-59 für Sekunden oder Minuten
        const value = Math.floor(Math.random() * 59) + 1; // 1-59
        const isSeconds = Math.random() < 0.5;

        // Berechne den gekürzten Bruch
        const divisor = this.gcd(value, 60);
        const num = value / divisor;
        const den = 60 / divisor;

        let question: string;
        let toUnit: string;

        if (isSeconds) {
            toUnit = 'min';
            question = `${value} s = ? min`;
        } else {
            toUnit = 'h';
            question = `${value} min = ? h`;
        }

        const fractionStr = `${num}/${den}`;

        // Nur vollständig gekürzte Brüche werden akzeptiert
        return {
            type: 'fraction',
            question,
            correctAnswer: `${fractionStr} ${toUnit}`,
            acceptedAnswers: [
                fractionStr,
                `${fractionStr}${toUnit}`,
                `${fractionStr} ${toUnit}`
            ],
            explanation: `${value} ÷ 60 = ${value}/60 = ${fractionStr} ${toUnit}`
        };
    }

    updateAnswer(value: string): void {
        this.userAnswer.set(value);
    }

    checkAnswer(): void {
        const problem = this.currentProblem();
        if (!problem) return;

        const userStr = this.userAnswer().trim().toLowerCase().replace(/\s+/g, ' ');

        // Normalisiere und prüfe gegen alle akzeptierten Antworten
        let isCorrect = problem.acceptedAnswers.some(ans =>
            this.normalizeAnswer(ans) === this.normalizeAnswer(userStr)
        );

        // Für Bruch-Aufgaben: Prüfe auch ob ein äquivalenter Bruch eingegeben wurde
        if (!isCorrect && problem.type === 'fraction') {
            isCorrect = this.checkFractionAnswer(userStr, problem);
        }

        this.isCorrect.set(isCorrect);
        this.answered.set(true);

        if (isCorrect) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(w => w + 1);

            // Telemetry: Track error
            const content = JSON.stringify({
                type: problem.type,
                question: problem.question,
                actual: this.userAnswer()
            });
            this.telemetryService.trackError('zeitrechnen', content, this.sessionId);
        }
    }

    private checkFractionAnswer(userStr: string, problem: TimeProblem): boolean {
        // Extrahiere Bruch aus der richtigen Antwort
        const correctFractionMatch = problem.correctAnswer.match(/(\d+)\/(\d+)/);
        if (!correctFractionMatch) return false;

        const correctNum = parseInt(correctFractionMatch[1]);
        const correctDen = parseInt(correctFractionMatch[2]);
        const correctValue = correctNum / correctDen;

        // Prüfe ob User einen Bruch eingegeben hat
        const normalized = this.normalizeAnswer(userStr);
        const userFractionMatch = normalized.match(/^(\d+)\/(\d+)/);

        if (userFractionMatch) {
            const userNum = parseInt(userFractionMatch[1]);
            const userDen = parseInt(userFractionMatch[2]);

            // Prüfe ob der Bruch den gleichen Wert hat
            if (userDen !== 0 && Math.abs(userNum / userDen - correctValue) < 0.0001) {
                return true;
            }
        }

        // Prüfe ob User eine Dezimalzahl eingegeben hat
        const userDecimalMatch = normalized.match(/^(\d*[.,]?\d+)/);
        if (userDecimalMatch) {
            const userDecimal = parseFloat(userDecimalMatch[1].replace(',', '.'));
            if (Math.abs(userDecimal - correctValue) < 0.0001) {
                return true;
            }
        }

        return false;
    }

    private normalizeAnswer(answer: string): string {
        return answer
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '')  // Entferne alle Leerzeichen
            .replace(',', '.')    // Komma zu Punkt
            .replace(/stunden?/g, 'h')
            .replace(/minuten?/g, 'min')
            .replace(/sekunden?/g, 's');
    }

    nextProblem(): void {
        const nextIndex = this.problemIndex() + 1;

        if (nextIndex >= this.PROBLEMS_PER_ROUND) {
            this.screen.set('results');
        } else {
            this.problemIndex.set(nextIndex);
            this.generateProblem();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    playAgain(): void {
        this.startQuiz();
    }
}
