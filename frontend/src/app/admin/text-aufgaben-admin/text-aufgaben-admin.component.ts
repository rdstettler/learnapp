
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';

interface TextAufgabeContent {
    question: string;
    answers: string[];
    explanation: string;
}

@Component({
    selector: 'app-text-aufgaben-admin',
    standalone: true,
    imports: [CommonModule, FormsModule, LearningAppLayoutComponent],
    templateUrl: './text-aufgaben-admin.component.html',
    styleUrl: './text-aufgaben-admin.component.css'
})
export class TextAufgabenAdminComponent {
    private apiService = inject(ApiService);

    question = '';
    answers: string[] = [''];
    explanation = '';

    isSubmitting = signal(false);
    successMessage = signal('');
    errorMessage = signal('');

    addAnswer() {
        this.answers.push('');
    }

    removeAnswer(index: number) {
        if (this.answers.length > 1) {
            this.answers.splice(index, 1);
        }
    }

    trackByIndex(index: number): number {
        return index;
    }

    async submit() {
        this.successMessage.set('');
        this.errorMessage.set('');

        if (!this.question.trim()) {
            this.errorMessage.set('Bitte eine Frage eingeben.');
            return;
        }

        const validAnswers = this.answers.map(a => a.trim()).filter(a => a.length > 0);
        if (validAnswers.length === 0) {
            this.errorMessage.set('Bitte mindestens eine Antwort eingeben.');
            return;
        }

        this.isSubmitting.set(true);

        const content: TextAufgabeContent = {
            question: this.question.trim(),
            answers: validAnswers,
            explanation: this.explanation.trim()
        };

        try {
            await this.apiService.addAppContent('textaufgaben', content);
            this.successMessage.set('Aufgabe erfolgreich gespeichert!');
            this.resetForm();
        } catch (err: any) {
            console.error('Error submitting:', err);
            this.errorMessage.set(err.message || 'Fehler beim Speichern.');
        } finally {
            this.isSubmitting.set(false);
        }
    }

    resetForm() {
        this.question = '';
        this.answers = [''];
        this.explanation = '';
    }
}
