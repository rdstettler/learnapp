import { Component, input, Input, model, output, ViewEncapsulation } from '@angular/core';
import { ModeBtnComponent } from './mode-btn.component';

@Component({
  selector: 'app-mode-selector',
  standalone: true,
  imports: [ModeBtnComponent],
  template: `
<div class="mode-selector">
    @for (m of modes(); track m.id) {
    <app-mode-btn
      [icon]="m.icon"
      [label]="m.label"
      [description]="m.description"
      [active]="mode() === m.id"
      (onClick)="mode.set(m.id)">
    </app-mode-btn>
    }
</div>
  `,
  styles: [`
.mode-selector {
    display: flex;
    gap: 12px;
    justify-content: center;
    margin: 20px 0;
    flex-wrap: wrap;
}
      `]
})
export class ModeSelectorComponent {
  modes = input<{ id: string; icon: string; label: string; description: string }[]>([]);
  mode = model<string>('');
}
