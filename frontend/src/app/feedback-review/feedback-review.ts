
import { Component, inject, signal, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';

interface FeedbackItem {
  id: number;
  user_uid: string;
  app_id: string;
  session_id: string;
  content: string; // JSON string of the *original* faulty content
  comment: string; // AI Reason
  target_id: string;
  created_at: string;
  suggestion?: any; // Parsed from comment if possible, or we just show comment
}

@Component({
  selector: 'app-feedback-review',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  constructor() {
    effect(() => {
      if (this.auth.user()) {
        this.loadItems();
      }
    });
  }

  loadItems() {
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    this.loading.set(true);
    this.http.get<FeedbackItem[]>('/api/feedback-review', {
      headers: new HttpHeaders({ 'X-User-Uid': uid })
    }).subscribe({
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

  runAiReview() {
    this.loading.set(true);
    this.http.get('/api/cron/review-questions').subscribe({
      next: (res: any) => {
        alert(`Review complete! Checked: ${res.checked_count}, New Flags: ${res.results.filter((r: any) => r.status === 'FAILED').length}`);
        this.loadItems();
      },
      error: (e) => {
        alert("Review failed: " + e.message);
        this.loading.set(false);
      }
    });
  }

  parseContent(json: string): any {
    try { return JSON.parse(json); } catch { return json; }
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
    this.http.post('/api/feedback-review', {
      feedback_id: item.id,
      target_id: item.target_id || item.session_id, // Fallback for legacy items
      new_content: newContentParsed,
      resolution_reason: reason
    }, {
      headers: new HttpHeaders({ 'X-User-Uid': uid })
    }).subscribe({
      next: () => {
        this.items.update(list => list.filter(i => i.id !== item.id));
        this.cancelEdit();
        this.loading.set(false);
      },
      error: (e: any) => {
        alert("Failed: " + (e.error?.error || e.message));
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
    this.http.post('/api/feedback-review', {
      feedback_id: item.id,
      target_id: item.target_id || item.session_id, // Fallback for legacy items
      new_content: originalContent,
      resolution_reason: reason,
      dismiss: true // Signal to backend this is a dismissal (optional, or just content update same as old)
    }, {
      headers: new HttpHeaders({ 'X-User-Uid': uid })
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
