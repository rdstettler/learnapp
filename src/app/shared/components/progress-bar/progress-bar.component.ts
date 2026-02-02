import { Component, Input } from '@angular/core';

@Component({
    selector: 'app-progress-bar',
    standalone: true,
    template: `
        <div class="progress-bar">
            <div class="progress-fill" [style.width.%]="progress"></div>
        </div>
    `,
    styles: [`
        .progress-bar {
            height: 6px;
            background: var(--border-color);
            border-radius: 3px;
            margin-bottom: 20px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--accent-1), var(--accent-2));
            border-radius: 3px;
            transition: width 0.3s ease;
        }
    `]
})
export class ProgressBarComponent {
    @Input() progress: number = 0;
}
