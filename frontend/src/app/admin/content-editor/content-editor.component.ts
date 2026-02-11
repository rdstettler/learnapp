import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
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
    depthScore?: number;
    completeness?: number;
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

interface EnhanceResult {
    id: number;
    original: Record<string, unknown>;
    enhanced: Record<string, unknown> | null;
    error?: string;
}

@Component({
    selector: 'app-content-editor',
    standalone: true,
    imports: [FormsModule, JsonPipe],
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

    // Sorting
    readonly sortBy = signal<'id' | 'completeness-asc' | 'completeness-desc' | 'accuracy-asc' | 'accuracy-desc' | 'flags'>('id');
    readonly sortedItems = computed(() => {
        const items = [...this.items()];
        switch (this.sortBy()) {
            case 'completeness-asc':
                return items.sort((a, b) => (a.completeness ?? 100) - (b.completeness ?? 100));
            case 'completeness-desc':
                return items.sort((a, b) => (b.completeness ?? 100) - (a.completeness ?? 100));
            case 'accuracy-asc':
                return items.sort((a, b) => (a.stats.accuracy ?? 101) - (b.stats.accuracy ?? 101));
            case 'accuracy-desc':
                return items.sort((a, b) => (b.stats.accuracy ?? -1) - (a.stats.accuracy ?? -1));
            case 'flags':
                return items.sort((a, b) => b.flagCounter - a.flagCounter);
            default:
                return items;
        }
    });

    // Adding
    readonly showAddForm = signal(false);
    readonly addJson = signal('');
    readonly addLevel = signal<number | null>(null);

    // Template & AI Enhancement
    readonly templateId = signal<number | null>(null);
    readonly showEnhancePanel = signal(false);
    readonly customPrompt = signal('');
    readonly batchSize = signal(5);
    readonly enhancing = signal(false);
    readonly enhanceProgress = signal<{ current: number; total: number } | null>(null);
    readonly enhanceResults = signal<EnhanceResult[]>([]);
    readonly acceptedIds = signal<Set<number>>(new Set());
    readonly rejectedIds = signal<Set<number>>(new Set());
    readonly savingEnhanced = signal(false);

    // Default prompts per app type
    readonly defaultPrompts: Record<string, string> = {
        verben: 'Nur unregelmässige Verben und Verben mit "bin" statt "habe" im Perfekt brauchen typicalMistakes. Reguläre Verben mit "habe" brauchen KEINE typicalMistakes — lasse das Feld bei denen weg. Füge "category" hinzu (z.B. "Häufig", "Unregelmässig", "Bewegung").',
        oberbegriffe: 'Füge "trickyWrongs" hinzu — Wörter die ähnlich klingen oder thematisch nahe sind, aber NICHT zur Kategorie gehören. Jeder trickyWrong braucht word, explanation und level (4-8). Die bestehenden "words" und "answers" NICHT ändern.',
        aehnlichewoerter: 'Füge Kontext-Sätze oder Eselsbrücken hinzu falls sinnvoll. Bestehende pairs nicht ändern.',
        wortfamilie: 'Füge Beispielsätze hinzu falls sinnvoll.',
        kasus: 'Füge typische Fehler hinzu falls der Kasus häufig verwechselt wird.',
        redewendungen: 'Füge eine Herkunft/Etymologie hinzu falls bekannt.',
    };

    // Summary computed
    readonly summary = computed(() => {
        const all = this.items();
        if (all.length === 0) return null;
        const withStats = all.filter(i => i.stats.totalAttempts > 0);
        const totalAttempts = withStats.reduce((s, i) => s + i.stats.totalAttempts, 0);
        const totalCorrect = withStats.reduce((s, i) => s + i.stats.totalCorrect, 0);
        const flagged = all.filter(i => i.flagCounter > 0).length;
        const unverified = all.filter(i => !i.humanVerified).length;
        const maxDepth = Math.max(...all.map(i => i.depthScore ?? 0), 1);
        const sparse = all.filter(i => (i.completeness ?? 100) < 80).length;
        return {
            total: all.length,
            withStats: withStats.length,
            accuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null,
            flagged,
            unverified,
            maxDepth,
            sparse
        };
    });

    // Sparse entries (< 80% completeness, not the template)
    readonly sparseEntries = computed(() => {
        const tplId = this.templateId();
        return this.items().filter(i => (i.completeness ?? 100) < 80 && i.id !== tplId);
    });

    // Template item
    readonly templateItem = computed(() => {
        const id = this.templateId();
        if (!id) return null;
        return this.items().find(i => i.id === id) ?? null;
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
        this.templateId.set(null);
        this.showEnhancePanel.set(false);
        this.enhanceResults.set([]);
        // Pre-fill custom prompt
        this.customPrompt.set(this.defaultPrompts[appId] ?? '');
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
            // Compute depth scores
            const items = res.items;
            const scores = items.map(i => this.computeDepthScore(i.data));
            const maxScore = Math.max(...scores, 1);
            items.forEach((item, idx) => {
                item.depthScore = scores[idx];
                item.completeness = Math.round((scores[idx] / maxScore) * 100);
            });

            this.items.set(items);
            this.totalPages.set(res.pagination.totalPages);
            this.totalCount.set(res.pagination.totalCount);

            // Auto-select richest as template if none set
            if (!this.templateId()) {
                const richest = items.reduce((best, item) =>
                    (item.depthScore ?? 0) > (best.depthScore ?? 0) ? item : best, items[0]);
                if (richest) this.templateId.set(richest.id);
            }
        } catch (e: any) {
            this.error.set(e.error?.error || 'Fehler beim Laden');
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Recursively count property paths in an object
     */
    computeDepthScore(obj: unknown): number {
        if (typeof obj !== 'object' || obj === null) return 0;
        if (Array.isArray(obj)) return 1 + obj.reduce((s, v) => s + (typeof v === 'object' ? 1 : 0), 0);
        let score = 0;
        for (const val of Object.values(obj as Record<string, unknown>)) {
            score += 1; // count each key
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                score += this.computeDepthScore(val);
            } else if (Array.isArray(val)) {
                score += val.length;
            }
        }
        return score;
    }

    async goToPage(page: number): Promise<void> {
        this.currentPage.set(page);
        await this.loadContent();
    }

    // ── Template ─────────────────────────────────────────

    setAsTemplate(item: ContentItem): void {
        this.templateId.set(item.id);
        // Recompute completeness relative to new template
        const items = this.items();
        const templateScore = item.depthScore ?? 1;
        items.forEach(i => {
            i.completeness = Math.round(((i.depthScore ?? 0) / templateScore) * 100);
        });
        this.items.set([...items]);
        this.flashSuccess('Vorlage gesetzt: #' + item.id);
    }

    // ── AI Enhancement ───────────────────────────────────

    toggleEnhancePanel(): void {
        this.showEnhancePanel.update(v => !v);
        if (this.showEnhancePanel()) {
            this.enhanceResults.set([]);
            this.acceptedIds.set(new Set());
            this.rejectedIds.set(new Set());
        }
    }

    async runEnhanceBatch(): Promise<void> {
        const tpl = this.templateItem();
        if (!tpl) {
            this.error.set('Bitte zuerst eine Vorlage setzen (⭐)');
            return;
        }

        const sparse = this.sparseEntries();
        const batch = sparse.slice(0, this.batchSize());
        if (batch.length === 0) {
            this.flashSuccess('Alle Einträge sind bereits vollständig!');
            return;
        }

        this.enhancing.set(true);
        this.enhanceProgress.set({ current: 0, total: batch.length });
        this.enhanceResults.set([]);

        try {
            const res = await firstValueFrom(
                this.http.post<{ results: EnhanceResult[] }>('/api/admin/add-content', {
                    action: 'enhance',
                    appId: this.selectedAppId(),
                    template: tpl.data,
                    entries: batch.map(b => ({ id: b.id, data: b.data })),
                    customPrompt: this.customPrompt() || undefined
                })
            );
            this.enhanceResults.set(res.results);
            this.enhanceProgress.set({ current: batch.length, total: batch.length });
        } catch (e: any) {
            this.error.set(e.error?.error || 'AI-Erweiterung fehlgeschlagen');
        } finally {
            this.enhancing.set(false);
        }
    }

    acceptResult(r: EnhanceResult): void {
        this.acceptedIds.update(s => { const n = new Set(s); n.add(r.id); n.delete(r.id); n.add(r.id); return n; });
        this.rejectedIds.update(s => { const n = new Set(s); n.delete(r.id); return n; });
    }

    rejectResult(r: EnhanceResult): void {
        this.rejectedIds.update(s => { const n = new Set(s); n.add(r.id); return n; });
        this.acceptedIds.update(s => { const n = new Set(s); n.delete(r.id); return n; });
    }

    isAccepted(id: number): boolean { return this.acceptedIds().has(id); }
    isRejected(id: number): boolean { return this.rejectedIds().has(id); }

    async saveAcceptedEnhancements(): Promise<void> {
        const accepted = this.enhanceResults().filter(r => this.acceptedIds().has(r.id) && r.enhanced);
        if (accepted.length === 0) return;

        this.savingEnhanced.set(true);
        let saved = 0;

        for (const r of accepted) {
            try {
                await firstValueFrom(
                    this.http.put('/api/admin/add-content', {
                        id: r.id,
                        data: r.enhanced,
                        human_verified: true
                    })
                );
                saved++;
            } catch (e) {
                console.error(`Failed to save #${r.id}:`, e);
            }
        }

        this.savingEnhanced.set(false);
        this.flashSuccess(`${saved} Einträge gespeichert!`);
        this.enhanceResults.set([]);
        this.acceptedIds.set(new Set());
        this.rejectedIds.set(new Set());
        await this.loadContent();
    }

    getEnhancedDiffKeys(r: EnhanceResult): string[] {
        if (!r.enhanced) return [];
        const origKeys = this.collectKeys(r.original);
        const enhKeys = this.collectKeys(r.enhanced);
        return enhKeys.filter(k => !origKeys.includes(k));
    }

    private collectKeys(obj: unknown, prefix = ''): string[] {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];
        const paths: string[] = [];
        for (const key of Object.keys(obj as Record<string, unknown>)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            paths.push(fullPath);
            paths.push(...this.collectKeys((obj as Record<string, unknown>)[key], fullPath));
        }
        return paths;
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

    getCompletenessColor(pct: number): string {
        if (pct >= 90) return '#22c55e';
        if (pct >= 70) return '#eab308';
        if (pct >= 50) return '#f97316';
        return '#ef4444';
    }

    getPreview(data: Record<string, unknown>): string {
        if (data['question']) return (data['question'] as string).slice(0, 80);
        if (data['verb']) return `Verb: ${data['verb']}`;
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
