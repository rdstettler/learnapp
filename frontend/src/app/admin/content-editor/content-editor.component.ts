import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { firstValueFrom } from 'rxjs';

interface ContentStats {
    totalAttempts: number;
    totalCorrect: number;
    totalWrong: number;
    uniqueUsers: number;
    accuracy: number | null;
}

interface ContentItem {
    id: number;
    appId: string;
    data: Record<string, unknown>;
    level: number | null;
    skillLevel: number | null;
    aiGenerated: boolean;
    humanVerified: boolean;
    flagCounter: number;
    createdAt: string;
    stats: ContentStats;
}

interface AppOption {
    id: string;
    name: string;
    icon: string;
    type: string;
}

interface ContentResponse {
    items: ContentItem[];
    pagination: { page: number; limit: number; totalCount: number; totalPages: number };
}

@Component({
    selector: 'app-content-editor',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './content-editor.component.html',
    styleUrl: './content-editor.component.css'
})
export class ContentEditorComponent implements OnInit {
    private router = inject(Router);
    private http = inject(HttpClient);
    authService = inject(AuthService);

    // State
    readonly apps = signal<AppOption[]>([]);
    readonly selectedAppId = signal<string>('');
    readonly items = signal<ContentItem[]>([]);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly successMsg = signal<string | null>(null);

    // Pagination
    readonly currentPage = signal(1);
    readonly totalPages = signal(1);
    readonly totalCount = signal(0);

    // Editing
    readonly editingId = signal<number | null>(null);
    readonly editJson = signal('');
    readonly editLevel = signal<number | null>(null);
    readonly saving = signal(false);
    readonly jsonError = signal<string | null>(null);

    // Adding
    readonly showAddForm = signal(false);
    readonly addJson = signal('');
    readonly addLevel = signal<number | null>(null);

    // Summary
    readonly summary = computed(() => {
        const all = this.items();
        if (all.length === 0) return null;
        const withStats = all.filter(i => i.stats.totalAttempts > 0);
        const totalAttempts = withStats.reduce((s, i) => s + i.stats.totalAttempts, 0);
        const totalCorrect = withStats.reduce((s, i) => s + i.stats.totalCorrect, 0);
        const flagged = all.filter(i => i.flagCounter > 0).length;
        const unverified = all.filter(i => !i.humanVerified).length;
        return {
            total: all.length,
            withStats: withStats.length,
            accuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null,
            flagged,
            unverified
        };
    });

    ngOnInit(): void {
        if (!this.authService.isAuthenticated()) {
            this.router.navigate(['/']);
            return;
        }
        this.loadApps();
    }

    async loadApps(): Promise<void> {
        try {
            const res = await firstValueFrom(
                this.http.get<{ apps: AppOption[] }>('/api/apps')
            );
            // Show all apps that could have content (exclude purely logic-only ones)
            this.apps.set(res.apps.filter((a: any) => a.type !== 'game'));
        } catch (e) {
            console.error('Failed to load apps:', e);
        }
    }

    async selectApp(appId: string): Promise<void> {
        this.selectedAppId.set(appId);
        this.currentPage.set(1);
        this.editingId.set(null);
        this.showAddForm.set(false);
        await this.loadContent();
    }

    async loadContent(): Promise<void> {
        const appId = this.selectedAppId();
        if (!appId) return;

        this.loading.set(true);
        this.error.set(null);

        try {
            const res = await firstValueFrom(
                this.http.get<ContentResponse>(
                    `/api/admin/add-content?app_id=${appId}&page=${this.currentPage()}&limit=50`
                )
            );
            this.items.set(res.items);
            this.totalPages.set(res.pagination.totalPages);
            this.totalCount.set(res.pagination.totalCount);
        } catch (e: any) {
            this.error.set(e.error?.error || 'Fehler beim Laden');
        } finally {
            this.loading.set(false);
        }
    }

    async goToPage(page: number): Promise<void> {
        this.currentPage.set(page);
        await this.loadContent();
    }

    // ── Editing ──────────────────────────────────────────

    startEdit(item: ContentItem): void {
        this.editingId.set(item.id);
        this.editJson.set(JSON.stringify(item.data, null, 2));
        this.editLevel.set(item.level);
        this.jsonError.set(null);
    }

    cancelEdit(): void {
        this.editingId.set(null);
        this.editJson.set('');
        this.jsonError.set(null);
    }

    async saveEdit(): Promise<void> {
        const id = this.editingId();
        if (!id) return;

        let parsed;
        try {
            parsed = JSON.parse(this.editJson());
        } catch {
            this.jsonError.set('Ungültiges JSON');
            return;
        }

        this.saving.set(true);
        this.jsonError.set(null);

        try {
            await firstValueFrom(
                this.http.put('/api/admin/add-content', {
                    id,
                    data: parsed,
                    level: this.editLevel(),
                    human_verified: true
                })
            );
            this.flashSuccess('Gespeichert!');
            this.cancelEdit();
            await this.loadContent();
        } catch (e: any) {
            this.jsonError.set(e.error?.error || 'Speichern fehlgeschlagen');
        } finally {
            this.saving.set(false);
        }
    }

    // ── Adding ──────────────────────────────────────────

    toggleAddForm(): void {
        this.showAddForm.update(v => !v);
        if (this.showAddForm()) {
            this.addJson.set('{\n  \n}');
            this.addLevel.set(null);
        }
    }

    async addContent(): Promise<void> {
        let parsed;
        try {
            parsed = JSON.parse(this.addJson());
        } catch {
            this.jsonError.set('Ungültiges JSON');
            return;
        }

        this.saving.set(true);
        this.jsonError.set(null);

        try {
            await firstValueFrom(
                this.http.post('/api/admin/add-content', {
                    app_id: this.selectedAppId(),
                    content: parsed,
                    level: this.addLevel()
                })
            );
            this.flashSuccess('Inhalt hinzugefügt!');
            this.showAddForm.set(false);
            await this.loadContent();
        } catch (e: any) {
            this.jsonError.set(e.error?.error || 'Hinzufügen fehlgeschlagen');
        } finally {
            this.saving.set(false);
        }
    }

    // ── Delete ──────────────────────────────────────────

    async deleteItem(item: ContentItem): Promise<void> {
        if (!confirm(`Inhalt #${item.id} wirklich löschen?`)) return;

        try {
            await firstValueFrom(
                this.http.delete(`/api/admin/add-content?id=${item.id}`)
            );
            this.flashSuccess('Gelöscht!');
            await this.loadContent();
        } catch (e: any) {
            this.error.set(e.error?.error || 'Löschen fehlgeschlagen');
        }
    }

    // ── Helpers ──────────────────────────────────────────

    getAccuracyColor(accuracy: number | null): string {
        if (accuracy === null) return '#666';
        if (accuracy >= 80) return '#22c55e';
        if (accuracy >= 60) return '#eab308';
        if (accuracy >= 40) return '#f97316';
        return '#ef4444';
    }

    getPreview(data: Record<string, unknown>): string {
        // Try common fields for a human-readable preview
        if (data['question']) return (data['question'] as string).slice(0, 80);
        if (data['words'] && Array.isArray(data['words'])) return (data['words'] as string[]).join(', ').slice(0, 80);
        if (data['sentences'] && Array.isArray(data['sentences'])) return ((data['sentences'] as string[])[0] || '').slice(0, 80);
        if (data['stem']) return `Stamm: ${data['stem']}`;
        if (data['nomen']) return `${data['nomen']} / ${data['verb']} / ${data['adjektiv']}`;
        if (data['pairs'] && Array.isArray(data['pairs'])) {
            const p = (data['pairs'] as { word1: string; word2: string }[])[0];
            return p ? `${p.word1} / ${p.word2}` : '';
        }
        if (data['category']) return `Kategorie: ${data['category']}`;
        return JSON.stringify(data).slice(0, 80);
    }

    private flashSuccess(msg: string): void {
        this.successMsg.set(msg);
        setTimeout(() => this.successMsg.set(null), 2500);
    }

    goBack(): void {
        this.router.navigate(['/admin']);
    }
}
