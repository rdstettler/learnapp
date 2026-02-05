
import { Component, input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';

@Component({
    selector: 'app-error-reporter',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div class="error-reporter-container">
        <button class="report-btn" (click)="isOpen.set(true)" title="Fehler melden">
            ⚠️
        </button>
    </div>

    @if (isOpen()) {
        <div class="modal-overlay" (click)="close()">
            <div class="modal" (click)="$event.stopPropagation()">
                @if (submitted()) {
                    <div class="success-message">
                        ✅ Vielen Dank! Dein Feedback wurde gesendet.
                    </div>
                } @else {
                    <h3>Fehler melden</h3>
                    
                    <div class="form-group">
                        <label>Art des Fehlers:</label>
                        <div class="radio-group">
                            <label class="radio-label">
                                <input type="radio" name="errorType" value="content" [(ngModel)]="errorType">
                                Inhalt/Aufgabe
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="errorType" value="solution" [(ngModel)]="errorType">
                                Lösung/Antwort
                            </label>
                            <label class="radio-label">
                                <input type="radio" name="errorType" value="other" [(ngModel)]="errorType">
                                Sonstiges
                            </label>
                        </div>
                    </div>

                    <div class="form-group">
                        <label>Beschreibung / Korrekturvorschlag:</label>
                        <textarea 
                            [(ngModel)]="comment" 
                            placeholder="Was ist falsch? Wie sollte es richtig heißen?"
                            rows="4"
                        ></textarea>
                    </div>

                    <div class="modal-actions">
                        <button class="btn btn-secondary" (click)="close()">Abbrechen</button>
                        <button class="btn btn-primary" (click)="submit()" [disabled]="!comment || submitting()">
                            {{ submitting() ? 'Sende...' : 'Absenden' }}
                        </button>
                    </div>
                }
            </div>
        </div>
    }
  `,
    styleUrls: ['./error-reporter.component.css']
})
export class ErrorReporterComponent {
    appId = input.required<string>();
    content = input<any>();

    apiService = inject(ApiService);

    isOpen = signal(false);
    submitting = signal(false);
    submitted = signal(false);

    errorType = 'content';
    comment = '';

    close() {
        this.isOpen.set(false);
        // Reset after delay if submitted, or immediately if not
        if (this.submitted()) {
            setTimeout(() => {
                this.submitted.set(false);
                this.comment = '';
                this.errorType = 'content';
            }, 500);
        }
    }

    async submit() {
        if (!this.comment) return;

        this.submitting.set(true);

        const success = await this.apiService.submitFeedback({
            appId: this.appId(),
            content: this.content(),
            comment: this.comment,
            errorType: this.errorType
        });

        this.submitting.set(false);

        if (success) {
            this.submitted.set(true);
            setTimeout(() => this.close(), 2000);
        } else {
            alert('Fehler beim Senden. Bitte versuche es später noch einmal.');
        }
    }
}
