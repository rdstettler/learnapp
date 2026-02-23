import { Component, input, Input, output, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-mode-btn',
  standalone: true,
  template: `
    <button class="mode-btn" [class.active]="active()" (click)="onClick.emit()" [disabled]="disabled()">
      @if (icon()) {
        <span class="mode-icon">{{ icon() }}</span>
      }
      <span class="mode-label">{{ label() }}</span>
      @if (description()) {
        <span class="mode-desc">{{ description() }}</span>
      }
    </button>
  `,
  styles: [`

.mode-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 18px;
    border-radius: 14px;
    border: 2px solid var(--border-color);
    background: var(--bg-card);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
    min-width: 120px;
}

.mode-btn:hover {
    border-color: var(--accent-1);
    transform: translateY(-2px);
}

.mode-btn.active {
    border-color: var(--accent-1);
    background: rgba(99, 102, 241, 0.15);
}

.mode-icon {
    font-size: 1.5rem;
}

.mode-label {
    font-weight: 600;
    font-size: 0.9rem;
}

.mode-desc {
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-align: center;
}
  `]
})
export class ModeBtnComponent {
  icon = input<string | undefined>(undefined);
  label = input<string>('');
  description = input<string | undefined>(undefined);
  active = input<boolean>(false);
  disabled = input<boolean>(false);
  onClick = output();
}
