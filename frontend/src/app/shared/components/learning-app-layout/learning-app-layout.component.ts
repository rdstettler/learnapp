
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ErrorReporterComponent } from '../error-reporter/error-reporter.component';

@Component({
    selector: 'app-learning-app-layout',
    standalone: true,
    imports: [CommonModule, RouterLink, ErrorReporterComponent],
    template: `
    <div class="bg-animation"></div>
    <div class="app-container">
        <div class="app-header">
            <a [routerLink]="backLink" class="back-button">← Dashboard</a>
            <h1>{{ title }}</h1>
        </div>

        <ng-content></ng-content>
        
        <app-error-reporter [appId]="appId" [content]="content"></app-error-reporter>
    </div>
  `,
    styles: [`
    :host {
        display: block;
        min-height: 100vh;
    }
    /* Ensure global styles for app-container etc are picked up or redefined if component encapsulated */
    /* Since we use ViewEncapsulation.Emulated by default, global styles like .app-container won't apply unless they are in styles.css */
    /* If they were in component css, they wouldn't apply here. */
    /* Assuming they are global. */
  `]
})
export class LearningAppLayoutComponent {
    @Input({ required: true }) title!: string;
    @Input({ required: true }) appId!: string;
    @Input() content: any;
    @Input() backLink: any[] | string = '/';
}
