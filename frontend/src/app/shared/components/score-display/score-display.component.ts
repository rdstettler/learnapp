import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-score-display',
    standalone: true,
    template: `
        <div class="score-display">
            <div class="score-circle">{{ percentage }}%</div>
            <div class="score-text">{{ text }}</div>
            <div class="score-breakdown">
                <div class="score-item correct">
                    <div class="score-item-number">{{ correct }}</div>
                    <div class="score-item-label">{{ correctLabel }}</div>
                </div>
                <div class="score-item wrong">
                    <div class="score-item-number">{{ wrong }}</div>
                    <div class="score-item-label">{{ wrongLabel }}</div>
                </div>
            </div>
            <ng-content></ng-content>
        </div>
    `,
    styles: [`
        .score-display {
            text-align: center;
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }

        .score-circle {
            width: 140px;
            height: 140px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 20px;
        }

        .score-text {
            font-size: 1.2rem;
            color: var(--text-secondary);
            margin-bottom: 10px;
        }

        .score-breakdown {
            display: flex;
            gap: 20px;
            margin-top: 20px;
        }

        .score-item {
            text-align: center;
        }

        .score-item-number {
            font-size: 1.5rem;
            font-weight: 700;
        }

        .score-item-label {
            font-size: 0.85rem;
            color: var(--text-secondary);
        }

        .score-item.correct .score-item-number {
            color: var(--success);
        }

        .score-item.wrong .score-item-number {
            color: var(--error);
        }
    `]
})
export class ScoreDisplayComponent {
    @Input() percentage: number = 0;
    @Input() text: string = 'Richtig beantwortet';
    @Input() correct: number = 0;
    @Input() wrong: number = 0;
    @Input() correctLabel: string = 'Richtig';
    @Input() wrongLabel: string = 'Falsch';
}
