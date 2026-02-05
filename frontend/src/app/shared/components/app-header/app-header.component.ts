import { Component, input } from '@angular/core';

@Component({
    selector: 'app-header',
    standalone: true,
    template: `
        <div class="app-header">
            <h1>{{ icon() }} {{ title() }}</h1>
        </div>
    `,
    styles: [`
        .app-header {
            text-align: center;
            margin-bottom: 20px;
        }

        .app-header h1 {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, var(--accent-1), var(--accent-2), var(--accent-3));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
    `]
})
export class AppHeaderComponent {
    title = input.required<string>();
    icon = input('');
}
