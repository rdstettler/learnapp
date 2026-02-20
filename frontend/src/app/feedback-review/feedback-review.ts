
import { Component, inject, signal, effect } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';

interface FeedbackItem {
  id: number;
  user_uid: string;
  app_id: string;
  session_id: string;
  content: string;
  comment: string;
  target_id: string;
  created_at: string;
  suggestion?: Record<string, unknown>;
}

interface ReviewResult {
  checked_count: number;
  results: { status: string }[];
}

interface ReviewProgress {
  current: number;
  total: number;
}

interface AppConfig {
  id: string;
  name: string;
  icon: string;
  category: string;
}

interface AiReviewResponse {
  mode: string;
  checked_count?: number;
  flagged_count?: number;
  generated_count?: number;
  inserted_ids?: number[];
  results?: AiReviewResultItem[];
  entries?: unknown[];
}

interface AiReviewResultItem {
  id: number;
  app_id: string;
  status: string;
  reason?: string;
  original?: Record<string, unknown>;
  correction?: unknown;
}

@Component({
  selector: 'app-feedback-review',
  standalone: true,
  imports: [JsonPipe, FormsModule, RouterModule],
  templateUrl: './feedback-review.html',
  styles: [`
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .card { background: var(--surface-card); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; border: 1px solid var(--surface-border); }
        .row { display: flex; gap: 1rem; }
        .col { flex: 1; overflow-x: auto; }
        pre { background: #000; color: #0f0; padding: 1rem; border-radius: 4px; font-size: 0.8rem; }
        .actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
        button { padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; border: none; font-weight: bold; }
        .btn-approve { background: var(--primary-color); color: white; }
        .btn-dismiss { background: var(--surface-300); color: var(--text-color); }
        .reason { background: rgba(255,0,0,0.1); border-left: 4px solid red; padding: 1rem; margin: 1rem 0; }
        .editor textarea { padding: 1rem; background: #1e1e1e; color: #d4d4d4; border: 1px solid #333; border-radius: 4px; }
    `]
})
export class FeedbackReviewComponent {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  items = signal<FeedbackItem[]>([]);
  loading = signal(false);

  // Editing State
  editingId = signal<number | null>(null);
  editContent = signal<string>('');

  // Targeted AI Review State
  availableApps = signal<AppConfig[]>([]);
  selectedAppId = signal<string>('');
  customPrompt = signal<string>('');
  reviewMode = signal<'review' | 'update' | 'extend'>('review');
  targetedReviewResults = signal<AiReviewResultItem[]>([]);
  targetedReviewRunning = signal(false);
  targetedReviewSummary = signal<string>('');

  constructor() {
    effect(() => {
      if (this.auth.user()) {
        this.loadItems();
        this.loadApps();
      }
    });
  }

  loadApps() {
    this.http.get<{ apps: AppConfig[] }>('/api/apps').subscribe({
      next: (res) => this.availableApps.set(res.apps),
      error: (e) => console.error('Failed to load apps', e)
    });
  }

  loadItems() {
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    this.loading.set(true);
    this.http.get<FeedbackItem[]>('/api/feedback').subscribe({
      next: (data) => {
        // Parse suggestions from comments
        const processedData = data.map(item => {
          try {
            const parts = item.comment.split('Suggestion: ');
            if (parts.length > 1) {
              item.suggestion = JSON.parse(parts[1]);
            }
          } catch (e) {
            console.warn("Failed to parse suggestion for item", item.id);
          }
          return item;
        });
        this.items.set(processedData);
        this.loading.set(false);
      },
      error: (e) => {
        console.error("Failed to load items", e);
        this.loading.set(false);
      }
    });
  }

  reviewProgress = signal<ReviewProgress | null>(null);

  async runAiReview() {
    this.loading.set(true);
    const total = 10;
    this.reviewProgress.set({ current: 0, total });

    let newFlags = 0;
    let checked = 0;

    try {
      for (let i = 0; i < total; i++) {
        const res = await firstValueFrom(this.http.get<ReviewResult>('/api/cron/review-questions?limit=1'));

        if (res) {
          checked += res.checked_count;
          newFlags += res.results.filter(r => r.status === 'FAILED').length;
        }

        this.reviewProgress.set({ current: i + 1, total });
      }

      alert(`Review complete! Checked: ${checked}, New Flags: ${newFlags}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      alert('Review failed: ' + msg);
    } finally {
      this.reviewProgress.set(null);
      this.loadItems();
      this.loading.set(false);
    }
  }

  parseContent(json: string): unknown {
    try { return JSON.parse(json) as unknown; } catch { return json; }
  }

  async runTargetedReview() {
    this.targetedReviewRunning.set(true);
    this.targetedReviewResults.set([]);
    this.targetedReviewSummary.set('');

    try {
      const body: Record<string, unknown> = {
        action: 'ai-review',
        mode: this.reviewMode()
      };

      if (this.selectedAppId()) {
        body['app_id'] = this.selectedAppId();
      }
      if (this.customPrompt().trim()) {
        body['customPrompt'] = this.customPrompt().trim();
      }

      const res = await firstValueFrom(
        this.http.post<AiReviewResponse>('/api/admin/add-content', body)
      );

      if (res.mode === 'extend') {
        this.targetedReviewSummary.set(
          `✅ Generated ${res.generated_count} new entries (IDs: ${res.inserted_ids?.join(', ')})`
        );
      } else {
        this.targetedReviewResults.set(res.results || []);
        const flagged = res.flagged_count || 0;
        const checked = res.checked_count || 0;
        const modeLabel = res.mode === 'update' ? 'Updated' : 'Flagged';
        this.targetedReviewSummary.set(
          `✅ Checked ${checked} items. ${modeLabel}: ${flagged}`
        );
      }

      // Refresh feedback list if we were in review mode (new flags)
      if (this.reviewMode() === 'review') {
        this.loadItems();
      }
    } catch (e: unknown) {
      const msg = e instanceof HttpErrorResponse ? (e.error?.error || e.message) : 'Unknown error';
      this.targetedReviewSummary.set(`❌ Error: ${msg}`);
    } finally {
      this.targetedReviewRunning.set(false);
    }
  }

  startEdit(item: FeedbackItem) {
    this.editingId.set(item.id);
    // Use suggestion if available, otherwise original content
    const contentObj = item.suggestion || this.parseContent(item.content);
    this.editContent.set(JSON.stringify(contentObj, null, 2));
  }

  cancelEdit() {
    this.editingId.set(null);
    this.editContent.set('');
  }

  saveEdit(item: FeedbackItem) {
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    let newContentParsed;
    try {
      newContentParsed = JSON.parse(this.editContent());
    } catch (e) {
      alert("Invalid JSON");
      return;
    }

    const reason = prompt("Any comments on this edit? (Optional)");

    this.loading.set(true);
    this.http.post('/api/feedback', {
      action: 'resolve',
      feedback_id: item.id,
      target_id: item.target_id || item.session_id, // Fallback for legacy items
      new_content: newContentParsed,
      resolution_reason: reason
    }).subscribe({
      next: () => {
        this.items.update(list => list.filter(i => i.id !== item.id));
        this.cancelEdit();
        this.loading.set(false);
      },
      error: (e: HttpErrorResponse) => {
        alert('Failed: ' + (e.error?.error || e.message));
        this.loading.set(false);
      }
    });
  }

  dismiss(item: FeedbackItem) {
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    let originalContent;
    try { originalContent = JSON.parse(item.content); } catch { return; }

    const reason = prompt("Why are you dismissing this? (Optional)");

    this.loading.set(true);
    this.http.post('/api/feedback', {
      action: 'resolve',
      feedback_id: item.id,
      target_id: item.target_id || item.session_id, // Fallback for legacy items
      new_content: originalContent,
      resolution_reason: reason,
      dismiss: true // Signal to backend this is a dismissal (optional, or just content update same as old)
    }).subscribe({
      next: () => {
        this.items.update(list => list.filter(i => i.id !== item.id));
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        alert("Dismiss failed: " + e.message);
      }
    });
  }
}
