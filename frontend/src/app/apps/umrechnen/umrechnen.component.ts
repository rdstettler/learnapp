import { Component, signal, computed } from '@angular/core';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { inject } from '@angular/core';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

interface UnitCategory {
    id: string;
    name: string;
    icon: string;
    units: Unit[];
}

interface Unit {
    name: string;
    symbol: string;
    toBase: number; // Faktor um zur Basiseinheit zu konvertieren
}

interface Problem {
    value: number;
    fromUnit: Unit;
    toUnit: Unit;
    category: UnitCategory;
    correctAnswer: number;
}

@Component({
    selector: 'app-umrechnen',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './umrechnen.component.html',
    styleUrl: './umrechnen.component.css'
})
export class UmrechnenComponent {
    private telemetryService = inject(AppTelemetryService);
    private sessionId = this.telemetryService.generateSessionId();
    readonly PROBLEMS_PER_ROUND = 10;
    readonly MIN_VALUE = 0.0001; // Max 3 Nullen nach Komma
    readonly MAX_VALUE = 9999999; // Unter 10 Millionen

    screen = signal<'welcome' | 'quiz' | 'results'>('welcome');
    selectedCategories = signal<Set<string>>(new Set());

    currentProblem = signal<Problem | null>(null);
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

    readonly categories: UnitCategory[] = [
        {
            id: 'length',
            name: 'Längen',
            icon: '📏',
            units: [
                { name: 'Millimeter', symbol: 'mm', toBase: 0.001 },
                { name: 'Zentimeter', symbol: 'cm', toBase: 0.01 },
                { name: 'Dezimeter', symbol: 'dm', toBase: 0.1 },
                { name: 'Meter', symbol: 'm', toBase: 1 },
                { name: 'Kilometer', symbol: 'km', toBase: 1000 }
            ]
        },
        {
            id: 'area',
            name: 'Flächen',
            icon: '⬜',
            units: [
                { name: 'Quadratmillimeter', symbol: 'mm²', toBase: 0.000001 },
                { name: 'Quadratzentimeter', symbol: 'cm²', toBase: 0.0001 },
                { name: 'Quadratdezimeter', symbol: 'dm²', toBase: 0.01 },
                { name: 'Quadratmeter', symbol: 'm²', toBase: 1 },
                { name: 'Are', symbol: 'a', toBase: 100 },
                { name: 'Hektare', symbol: 'ha', toBase: 10000 },
                { name: 'Quadratkilometer', symbol: 'km²', toBase: 1000000 }
            ]
        },
        {
            id: 'volume',
            name: 'Volumen',
            icon: '📦',
            units: [
                { name: 'Kubikmillimeter', symbol: 'mm³', toBase: 0.000000001 },
                { name: 'Kubikzentimeter', symbol: 'cm³', toBase: 0.000001 },
                { name: 'Kubikdezimeter', symbol: 'dm³', toBase: 0.001 },
                { name: 'Kubikmeter', symbol: 'm³', toBase: 1 }
            ]
        },
        {
            id: 'liquid',
            name: 'Hohlmasse',
            icon: '🥛',
            units: [
                { name: 'Milliliter', symbol: 'ml', toBase: 0.001 },
                { name: 'Zentiliter', symbol: 'cl', toBase: 0.01 },
                { name: 'Deziliter', symbol: 'dl', toBase: 0.1 },
                { name: 'Liter', symbol: 'l', toBase: 1 },
                { name: 'Hektoliter', symbol: 'hl', toBase: 100 }
            ]
        },
        {
            id: 'weight',
            name: 'Gewicht',
            icon: '⚖️',
            units: [
                { name: 'Milligramm', symbol: 'mg', toBase: 0.000001 },
                { name: 'Gramm', symbol: 'g', toBase: 0.001 },
                { name: 'Kilogramm', symbol: 'kg', toBase: 1 },
                { name: 'Tonne', symbol: 't', toBase: 1000 }
            ]
        }
    ];

    toggleCategory(categoryId: string): void {
        const selected = new Set(this.selectedCategories());
        if (selected.has(categoryId)) {
            selected.delete(categoryId);
        } else {
            selected.add(categoryId);
        }
        this.selectedCategories.set(selected);
    }

    selectAllCategories(): void {
        this.selectedCategories.set(new Set(this.categories.map(c => c.id)));
    }

    canStart(): boolean {
        return this.selectedCategories().size > 0;
    }

    startQuiz(): void {
        this.problemIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
        this.generateProblem();
    }

    private generateProblem(): void {
        const selectedCats = this.categories.filter(c => this.selectedCategories().has(c.id));
        const category = selectedCats[Math.floor(Math.random() * selectedCats.length)];

        // Wähle zwei verschiedene Einheiten
        const units = category.units;
        const fromIndex = Math.floor(Math.random() * units.length);
        let toIndex = Math.floor(Math.random() * units.length);
        while (toIndex === fromIndex) {
            toIndex = Math.floor(Math.random() * units.length);
        }

        const fromUnit = units[fromIndex];
        const toUnit = units[toIndex];

        // Berechne den Umrechnungsfaktor
        const conversionFactor = fromUnit.toBase / toUnit.toBase;

        // Generiere einen Wert, der ein "schönes" Ergebnis gibt
        const value = this.generateNiceValue(conversionFactor);
        const correctAnswer = value * conversionFactor;

        this.currentProblem.set({
            value,
            fromUnit,
            toUnit,
            category,
            correctAnswer
        });

        this.userAnswer.set('');
        this.answered.set(false);
    }

    private generateNiceValue(conversionFactor: number): number {
        // Versuche verschiedene "schöne" Zahlen
        const niceNumbers = [
            1, 2, 3, 4, 5, 6, 7, 8, 9,
            10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100,
            120, 150, 200, 250, 300, 400, 500, 750, 800,
            1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000,
            10000, 15000, 20000, 50000, 100000, 250000, 500000,
            0.1, 0.2, 0.25, 0.5, 0.75,
            0.01, 0.02, 0.05,
            0.001, 0.002, 0.005
        ];

        // Mische die Zahlen
        const shuffled = [...niceNumbers].sort(() => Math.random() - 0.5);

        for (const num of shuffled) {
            const result = num * conversionFactor;
            if (this.isValidResult(result) && this.isValidResult(num)) {
                return num;
            }
        }

        // Fallback: generiere eine passende Zahl
        return this.findValidValue(conversionFactor);
    }

    private findValidValue(conversionFactor: number): number {
        // Berechne einen Bereich basierend auf dem Faktor
        let minInput = this.MIN_VALUE;
        let maxInput = this.MAX_VALUE;

        // Stelle sicher, dass das Ergebnis auch gültig ist
        if (conversionFactor > 1) {
            maxInput = Math.min(maxInput, this.MAX_VALUE / conversionFactor);
        } else {
            minInput = Math.max(minInput, this.MIN_VALUE / conversionFactor);
        }

        // Generiere eine "runde" Zahl im gültigen Bereich
        const magnitude = Math.floor(Math.log10(maxInput / 2));
        const base = Math.pow(10, Math.max(0, Math.min(magnitude, 4)));
        const multipliers = [1, 2, 2.5, 5];
        const mult = multipliers[Math.floor(Math.random() * multipliers.length)];

        return base * mult;
    }

    private isValidResult(value: number): boolean {
        if (value > this.MAX_VALUE || value < this.MIN_VALUE) return false;

        // Prüfe auf zu viele Nachkommastellen (max 4 signifikante Dezimalstellen nach führenden Nullen)
        if (value < 1 && value > 0) {
            const decimalStr = value.toString();
            const match = decimalStr.match(/0\.(0*)([1-9])/);
            if (match && match[1].length > 3) return false; // Mehr als 3 führende Nullen
        }

        return true;
    }

    formatNumber(num: number): string {
        // Formatiere die Zahl schön
        if (Number.isInteger(num)) {
            return num.toLocaleString('de-CH');
        }

        // Für Dezimalzahlen: entferne unnötige Nullen
        let str = num.toFixed(6);
        str = str.replace(/\.?0+$/, '');

        // Schweizer Format mit Apostroph als Tausendertrennzeichen
        const parts = str.split('.');
        parts[0] = parseInt(parts[0]).toLocaleString('de-CH');
        return parts.join('.');
    }

    updateAnswer(value: string): void {
        this.userAnswer.set(value);
    }

    checkAnswer(): void {
        const problem = this.currentProblem();
        if (!problem) return;

        // Normalisiere die Eingabe (erlaube Komma und Punkt)
        const userStr = this.userAnswer().trim()
            .replace(/[''\s]/g, '') // Entferne Tausendertrennzeichen
            .replace(',', '.');
        const userNum = parseFloat(userStr);

        if (isNaN(userNum)) {
            this.isCorrect.set(false);
            this.answered.set(true);
            this.totalWrong.update(w => w + 1);
            return;
        }

        // Erlaube kleine Rundungsfehler (0.1% Toleranz)
        const tolerance = Math.abs(problem.correctAnswer * 0.001);
        const correct = Math.abs(userNum - problem.correctAnswer) <= Math.max(tolerance, 0.0001);

        this.isCorrect.set(correct);
        this.answered.set(true);

        if (correct) {
            this.totalCorrect.update(c => c + 1);
        } else {
            this.totalWrong.update(w => w + 1);

            // Telemetry: Track error
            const content = JSON.stringify({
                fromUnit: problem.fromUnit.symbol,
                toUnit: problem.toUnit.symbol,
                value: problem.value,
                actual: userNum
            });
            this.telemetryService.trackError('umrechnen', content, this.sessionId);
        }
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
