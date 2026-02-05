import { Component, input, output } from '@angular/core';

@Component({
    selector: 'app-welcome-screen',
    standalone: true,
    template: `
        <div class="welcome-container">
            <div class="welcome-emoji">{{ emoji() }}</div>
            <h2 style="margin-bottom: 12px;">{{ title() }}</h2>
            <p class="text-secondary" style="margin-bottom: 20px; max-width: 300px;">
                {{ description() }}
            </p>
            <ng-content></ng-content>
            <button class="btn btn-primary" style="margin-top: 24px;" (click)="start.emit()" [disabled]="disabled()">
                {{ buttonText() }}
            </button>
        </div>
    `,
    styles: [`
        .welcome-container {
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            flex: 1;
        }

        .welcome-emoji {
            font-size: 4rem;
            margin-bottom: 20px;
            animation: bounce 2s infinite;
        }

        .text-secondary {
            color: var(--text-secondary);
        }

        .btn {
            width: 100%;
            max-width: 200px;
            padding: 16px;
            border-radius: 12px;
            border: none;
            font-size: 1rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
            color: white;
        }

        .btn-primary:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        @keyframes bounce {
            0%, 100% {
                transform: translateY(0);
            }
            50% {
                transform: translateY(-10px);
            }
        }
    `]
})
export class WelcomeScreenComponent {
    emoji = input('🎮');
    title = input('Welcome');
    description = input('');
    buttonText = input('Starten');
    disabled = input(false);

    start = output<void>();
}
