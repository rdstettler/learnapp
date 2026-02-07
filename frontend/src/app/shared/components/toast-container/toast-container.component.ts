import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../services/notification.service';

@Component({
    selector: 'app-toast-container',
    standalone: true,
    template: `
        @for (msg of notificationService.messages(); track msg.id) {
            <div class="toast" [class]="'toast-' + msg.type" (click)="notificationService.dismiss(msg.id)">
                <span class="toast-icon">
                    @if (msg.type === 'error') { ⚠️ }
                    @else if (msg.type === 'warning') { ⚡ }
                    @else { ℹ️ }
                </span>
                <span class="toast-text">{{ msg.text }}</span>
                <button class="toast-close" (click)="notificationService.dismiss(msg.id); $event.stopPropagation()">✕</button>
            </div>
        }
    `,
    styles: [`
        :host {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column-reverse;
            gap: 8px;
            max-width: 400px;
            pointer-events: none;
        }

        .toast {
            pointer-events: auto;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            border-radius: 12px;
            color: white;
            font-size: 0.9rem;
            cursor: pointer;
            animation: slideIn 0.3s ease-out;
            backdrop-filter: blur(12px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .toast-error {
            background: rgba(220, 38, 38, 0.9);
        }

        .toast-warning {
            background: rgba(217, 119, 6, 0.9);
        }

        .toast-info {
            background: rgba(59, 130, 246, 0.9);
        }

        .toast-icon {
            flex-shrink: 0;
        }

        .toast-text {
            flex: 1;
            line-height: 1.3;
        }

        .toast-close {
            flex-shrink: 0;
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            font-size: 1rem;
            cursor: pointer;
            padding: 0 4px;
        }

        .toast-close:hover {
            color: white;
        }

        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @media (max-width: 480px) {
            :host {
                left: 10px;
                right: 10px;
                max-width: none;
            }
        }
    `]
})
export class ToastContainerComponent {
    notificationService = inject(NotificationService);
}
