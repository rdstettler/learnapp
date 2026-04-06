import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-feedback-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './feedback-panel.component.html'
})
export class FeedbackPanelComponent {
  @Input() isCorrect: boolean = false;
  @Input() message: string = '';
  @Input() showRetry: boolean = true;
  @Input() showNext: boolean = true;
  
  @Output() onRetry = new EventEmitter<void>();
  @Output() onNext = new EventEmitter<void>();
}
