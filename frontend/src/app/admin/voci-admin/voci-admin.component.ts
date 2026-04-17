import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';

interface VociEntry {
    id: string; // pseudo id: topic||de_word
    de_word: string;
    fr_word: string;
    en_word: string;
    topic: string;
}

@Component({
    selector: 'app-voci-admin',
    standalone: true,
    imports: [FormsModule, JsonPipe],
    templateUrl: './voci-admin.component.html',
    styleUrl: './voci-admin.component.css'
})
export class VociAdminComponent implements OnInit {
    private router = inject(Router);
    private http = inject(HttpClient);

    items = signal<VociEntry[]>([]);
    loading = signal(false);
    error = signal<string | null>(null);
    successMsg = signal<string | null>(null);

    // Topics filter
    topics = computed(() => {
        const unique = new Set(this.items().map(i => i.topic).filter(Boolean));
        return Array.from(unique).sort();
    });
    selectedFilterTopic = signal<string>('');

    filteredItems = computed(() => {
        const t = this.selectedFilterTopic();
        if (!t) return this.items();
        return this.items().filter(i => i.topic === t);
    });

    // Form
    showForm = signal(false);
    isEditing = signal(false);
    formDeWord = signal('');
    formFrWord = signal('');
    formEnWord = signal('');
    formTopic = signal('');
    oldDeWord = signal('');
    oldTopic = signal('');
    saving = signal(false);

    // AI Generate
    showAIPanel = signal(false);
    aiTopic = signal('');
    aiGenerating = signal(false);
    aiSuggestions = signal<{de_word: string, fr_word: string, en_word: string}[]>([]);
    savingSuggestions = signal(false);

    ngOnInit() {
        this.loadContent();
    }

    loadContent() {
        this.loading.set(true);
        this.http.get<{ items: VociEntry[] }>('/api/admin/voci').subscribe({
            next: (res) => {
                this.items.set(res.items);
                this.loading.set(false);
            },
            error: (err) => {
                this.error.set(err.error?.error || 'Load failed');
                this.loading.set(false);
            }
        });
    }

    openAdd() {
        this.isEditing.set(false);
        this.formDeWord.set('');
        this.formFrWord.set('');
        this.formEnWord.set('');
        this.formTopic.set(this.selectedFilterTopic() || '');
        this.oldDeWord.set('');
        this.oldTopic.set('');
        this.showForm.set(true);
    }

    openEdit(item: VociEntry) {
        this.isEditing.set(true);
        this.formDeWord.set(item.de_word);
        this.formFrWord.set(item.fr_word);
        this.formEnWord.set(item.en_word);
        this.formTopic.set(item.topic);
        this.oldDeWord.set(item.de_word);
        this.oldTopic.set(item.topic);
        this.showForm.set(true);
    }

    cancelForm() {
        this.showForm.set(false);
    }

    save() {
        const de_word = this.formDeWord().trim();
        const fr_word = this.formFrWord().trim();
        const en_word = this.formEnWord().trim();
        const topic = this.formTopic().trim();

        if (!de_word || !topic || (!fr_word && !en_word)) {
            alert('Bitte Deutsches Wort, Thema und mindestens eine Übersetzung angeben.');
            return;
        }

        this.saving.set(true);
        const payload = {
            old_de_word: this.isEditing() ? this.oldDeWord() : undefined,
            old_topic: this.isEditing() ? this.oldTopic() : undefined,
            de_word,
            fr_word,
            en_word,
            topic
        };

        this.http.post('/api/admin/voci', payload).subscribe({
            next: () => {
                this.flashSuccess('Gespeichert!');
                this.saving.set(false);
                this.showForm.set(false);
                this.loadContent();
            },
            error: (err) => {
                alert(err.error?.error || 'Speichern fehlgeschlagen');
                this.saving.set(false);
            }
        });
    }

    deleteItem(item: VociEntry) {
        if (!confirm('Eintrag "'+item.de_word+'" in beiden Sprachen löschen?')) return;
        
        this.http.delete('/api/admin/voci', {
            body: { de_word: item.de_word, topic: item.topic }
        }).subscribe({
            next: () => {
                this.flashSuccess('Gelöscht');
                this.loadContent();
            },
            error: (err) => {
                alert(err.error?.error || 'Löschen fehlgeschlagen');
            }
        });
    }

    toggleAIPanel() {
        this.showAIPanel.update(v => !v);
        if (this.showAIPanel()) {
            this.aiTopic.set(this.selectedFilterTopic() || '');
            this.aiSuggestions.set([]);
        }
    }

    generateSuggestions() {
        if (!this.aiTopic().trim()) return;
        this.aiGenerating.set(true);
        this.http.post<{entries: any[]}>('/api/admin/voci', {
            action: 'generate',
            topic: this.aiTopic().trim(),
            count: 5
        }).subscribe({
            next: (res) => {
                this.aiSuggestions.set(res.entries);
                this.aiGenerating.set(false);
            },
            error: (err) => {
                alert(err.error?.error || 'Generierung fehlgeschlagen');
                this.aiGenerating.set(false);
            }
        });
    }

    saveSuggestions() {
        const suggestions = this.aiSuggestions();
        if (suggestions.length === 0) return;

        this.savingSuggestions.set(true);
        const payload = {
            entries: suggestions.map(s => ({
                de_word: s.de_word,
                fr_word: s.fr_word,
                en_word: s.en_word,
                topic: this.aiTopic()
            }))
        };

        this.http.post('/api/admin/voci', payload).subscribe({
            next: () => {
                this.flashSuccess(suggestions.length + ' Einträge gespeichert!');
                this.savingSuggestions.set(false);
                this.aiSuggestions.set([]);
                this.loadContent();
            },
            error: (err) => {
                alert(err.error?.error || 'Speichern fehlgeschlagen');
                this.savingSuggestions.set(false);
            }
        });
    }

    private flashSuccess(msg: string) {
        this.successMsg.set(msg);
        setTimeout(() => this.successMsg.set(null), 3000);
    }

    goBack() {
        this.router.navigate(['/admin']);
    }
}
