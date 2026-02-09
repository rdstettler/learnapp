
import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApiService } from '../../services/api.service';
import { AppCardComponent, AppInfo } from '../../shared/components/app-card/app-card.component';
import { Router } from '@angular/router';
import { MarkdownPipe } from '../../shared/pipes/markdown.pipe';
import { LearningSession, SessionTask, NotEnoughDataResponse } from '../../shared/models/learning-session.model';

@Component({
  selector: 'app-learning-view',
  standalone: true,
  imports: [CommonModule, AppCardComponent, MarkdownPipe],
  template: `
    <div class="learning-container">
      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Lade Lern-Status...</p>
        </div>
      } @else if (session()) {
        <!-- Active Session -->
        <div class="session-view fade-in">
          <div class="session-header">
            <h2>{{ session()!.topic }}</h2>
            <p class="session-text">{{ session()!.text }}</p>
            
            <div class="progress-bar-container">
                <div class="progress-text">
                    @if (totalTasks() > 0) {
                        {{ completedTasks() }} von {{ totalTasks() }} Aufgaben erledigt
                    } @else {
                        Du hast alle Aufgaben gelöst, kehre zu deinen Favoriten zurück und lerne weiter
                    }
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" [style.width.%]="sessionProgress()"></div>
                </div>
            </div>
          </div>

          @if (session()!.theory && session()!.theory.length > 0) {
            <div class="theory-section fade-in">
                <h3>💡 Gut zu wissen</h3>
                <div class="theory-grid">
                    @for (card of session()!.theory; track $index) {
                        <div class="theory-card">
                            <h4>{{ card.title }}</h4>
                            <div [innerHTML]="card.content | markdown"></div>
                        </div>
                    }
                </div>
            </div>
          }
          
          <div class="tasks-list">
            @for (group of groupedTasks(); track group.id) {
               @if (getAppInfo(group.app_id); as app) {
                 <div class="task-item" [class.completed]="!group.pristine">
                    <app-app-card 
                        [app]="app" 
                        [isFavorite]="false"
                        [showFavorite]="false"
                        [allowRemove]="true"
                        (removeClicked)="removeGroup(group)"
                        (appClicked)="group.pristine ? startTask(group, app) : null"
                    ></app-app-card>
                    
                    @if (!group.pristine) {
                        <div class="status-overlay">
                            <span>✅ Erledigt</span>
                        </div>
                    } @else {
                        <div class="task-info-badge">
                            {{ getGroupTaskCount(group) }} Fragen
                        </div>
                    }
                 </div>
               }
            }
          </div>
          
          @if (sessionProgress() === 100) {
              <div class="completion-message fade-in">
                  <h3>🎉 Fantastisch! Du hast alle Aufgaben erledigt.</h3>
                  <button class="generate-btn" (click)="generateSession()">Neuen Plan erstellen</button>
              </div>
          }
        </div>
      } @else if (suggestions()) {
        <!-- Not Enough Data (404 case) -->
        <div class="empty-state fade-in">
          <h2>Keine oder zu wenige Daten verfügbar</h2>
          <p>Wir brauchen mehr Ergebnisse von dir, um einen persönlichen Lernplan zu erstellen.</p>
          
          <h3>Empfohlene Apps:</h3>
          <div class="suggestions-grid">
            @for (app of suggestions(); track app.id) {
              <app-app-card 
                [app]="app" 
                [isFavorite]="false" 
                (appClicked)="openApp(app)"
              ></app-app-card>
            }
          </div>
        </div>
      } @else {
        <!-- Ready to Generate (Null case) -->
        <div class="ready-state fade-in">
            <div class="magic-icon">✨</div>
            <h2>Dein persönlicher Lernplan kann erstellt werden!</h2>
            <p>Basierend auf deinen letzten Übungen kann ich 🤖 eine Lerneinheit für dich zusammenstellen.</p>
            @if (generationError()) {
              <div class="error-message">⚠️ {{ generationError() }}</div>
            }
            <button class="generate-btn" (click)="generateSession()" [disabled]="generating()">
                @if (generating()) {
                    {{ loadingMessage() }}
                } @else {
                    Erstelle eine Lerneinheit
                }
            </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .learning-container {
      padding: 1rem;
      max-width: 1200px;
      margin: 0 auto;
      text-align: center;
    }
    .loading-state, .empty-state, .ready-state, .session-view {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
    }
    .suggestions-grid, .tasks-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.5rem;
      width: 100%;
      margin-top: 2rem;
    }
    .session-header {
      background: linear-gradient(135deg, #6e8efb, #a777e3);
      color: white;
      padding: 2rem;
      border-radius: 16px;
      width: 100%;
      box-shadow: 0 10px 20px rgba(110, 142, 251, 0.2);
    }
    .session-header h2 {
      margin: 0 0 0.5rem 0;
      font-size: 2rem;
    }
    .session-header p {
      margin: 0;
      font-size: 1.1rem;
      opacity: 0.9;
    }
    .progress-bar-container {
        margin-top: 1.5rem;
        background: rgba(255,255,255,0.2);
        border-radius: 10px;
        padding: 1rem;
    }
    .progress-bar {
        height: 10px;
        background: rgba(0,0,0,0.1);
        border-radius: 5px;
        overflow: hidden;
        margin-top: 0.5rem;
    }
    .progress-fill {
        height: 100%;
        background: #fff;
        transition: width 0.5s ease;
    }
    .task-item {
        position: relative;
        transition: opacity 0.3s;
    }
    .task-item.completed {
        opacity: 0.7;
    }
    .status-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255,255,255,0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        border-radius: 16px;
        font-weight: bold;
        color: #4CAF50;
        font-size: 1.2rem;
        backdrop-filter: blur(2px);
    }
    .task-info-badge {
        position: absolute;
        top: 10px;
        left: 10px;
        background: #6e8efb;
        color: white;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: bold;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .completion-message {
        margin-top: 2rem;
        padding: 2rem;
        background: #E8F5E9;
        border-radius: 16px;
        color: #2E7D32;
    }
    .magic-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
        animation: float 3s ease-in-out infinite;
    }
    .generate-btn {
        background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%);
        border: none;
        padding: 1rem 2rem;
        font-size: 1.2rem;
        border-radius: 50px;
        cursor: pointer;
        color: #fff;
        font-weight: bold;
        box-shadow: 0 4px 15px rgba(255, 154, 158, 0.4);
        transition: transform 0.2s, box-shadow 0.2s;
        text-shadow: 0 1px 2px rgba(0,0,0,0.1);
    }
    .generate-btn:hover:not([disabled]) {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(255, 154, 158, 0.6);
    }
    .generate-btn:disabled {
        opacity: 0.7;
        cursor: wait;
    }
    @keyframes float {
        0% { transform: translateY(0px); }
        50% { transform: translateY(-10px); }
        100% { transform: translateY(0px); }
    }
    .error-message {
        background: #FFF3E0;
        color: #E65100;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        border-left: 4px solid #FF9800;
        width: 100%;
        max-width: 500px;
        text-align: left;
        font-size: 0.95rem;
    }
    .fade-in {
        animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .theory-section {
        width: 100%;
        margin-top: 2rem;
        text-align: left;
    }
    .theory-section h3 {
        margin-left: 0.5rem;
        margin-bottom: 1rem;
        color: #555;
    }
    .theory-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1rem;
    }
    .theory-card {
        background: white;
        color: #2c3e50;
        padding: 1.2rem;
        border-radius: 12px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.05);
        border-left: 4px solid #a777e3;
        transition: transform 0.2s;
    }
    .theory-card:hover {
        transform: translateY(-2px);
    }
    .theory-card h4 {
        margin: 0 0 0.5rem 0;
        font-size: 1.1rem;
    }
    .theory-card p {
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.5;
    }
  `]
})
export class LearningViewComponent implements OnInit {
  apiService = inject(ApiService);
  private http = inject(HttpClient);
  router = inject(Router);

  loading = signal(true);
  generating = signal(false);
  generationError = signal<string | null>(null);

  // Timer for generation
  generationSeconds = signal(0);
  loadingMessage = computed(() => {
    const sec = this.generationSeconds();
    if (sec < 5) return "Analysiere deine Lernergebnisse...";
    if (sec < 10) return "Suche passende Übungen...";
    if (sec < 20) return "Erstelle persönliche Aufgaben...";
    if (sec < 25) return "Formuliere Erklärungen...";
    if (sec < 30) return "Überprüfe Rechtschreibung...";
    if (sec < 35) return "Konsultiere andere KI...";
    if (sec < 40) return "Moment, ich brauche mehr Strom...";
    if (sec < 45) return "Ich denke noch etwas weiter über tolle Übungen nach...";
    return "Fast fertig...";
  });

  session = signal<LearningSession | null>(null);
  suggestions = signal<AppInfo[] | null>(null);

  // Computed stats
  totalTasks = computed(() => this.session()?.tasks?.length || 0);
  completedTasks = computed(() => this.session()?.tasks?.filter((t) => !t.pristine).length || 0);
  sessionProgress = computed(() => {
    const total = this.totalTasks();
    return total > 0 ? (this.completedTasks() / total) * 100 : 0;
  });

  groupedTasks = computed(() => {
    const tasks = this.session()?.tasks || [];
    if (tasks.length === 0) return [];

    interface TaskGroup extends SessionTask {
        ids: number[];
        tasks: SessionTask[];
    }

    const groups: TaskGroup[] = [];
    let currentGroup: TaskGroup | null = null;

    for (const task of tasks) {
      if (currentGroup && currentGroup.app_id === task.app_id && currentGroup.pristine === task.pristine) {
        currentGroup.ids.push(task.id);
        currentGroup.tasks.push(task);
      } else {
        currentGroup = {
          ...task,
          ids: [task.id],
          tasks: [task],
        };
        groups.push(currentGroup);
      }
    }
    return groups;
  });

  // We need access to full app list to resolve app_ids
  // In a real app we might fetch this or have a service.
  // For now, we'll rely on what we can get.
  // Ideally Platform passes this, but for isolation let's try to fetch or input.
  // Let's assume we can fetch apps from /api/apps, or we rely on suggestions containing them.
  // But for the SESSION content, we need the app info for the apps in the session.
  // We can fetch all apps on init.
  allApps = signal<Map<string, AppInfo>>(new Map());

  ngOnInit() {
    this.loadAllApps().then(() => {
      this.loadSession();
    });
  }

  async loadAllApps() {
    try {
      const res = await new Promise<{ apps: AppInfo[] }>((resolve, reject) => {
        this.http.get<{ apps: AppInfo[] }>('/api/apps').subscribe({ next: resolve, error: reject });
      });
      if (res.apps) {
        const map = new Map<string, AppInfo>();
        res.apps.forEach((a) => map.set(a.id, a));
        this.allApps.set(map);
      }
    } catch (e) {
      console.error('Failed to load apps map', e);
    }
  }

  async loadSession() {
    this.loading.set(true);
    try {
      const res = await this.apiService.getLearningSession();
      if (res && 'session_id' in res) {
        this.session.set(res as LearningSession);
      } else if (res && 'message' in res) {
        this.suggestions.set((res as NotEnoughDataResponse).suggestedApps as unknown as AppInfo[]);
      } else {
        this.session.set(null);
        this.suggestions.set(null);
      }
    } catch (e) {
      console.error('Error loading learning session', e);
    } finally {
      this.loading.set(false);
    }
  }

  async generateSession() {
    this.generating.set(true);
    this.generationError.set(null);
    this.generationSeconds.set(0);

    const interval = setInterval(() => {
      this.generationSeconds.update(s => s + 1);
    }, 1000);

    try {
      const res = await this.apiService.generateLearningSession();
      this.session.set(res);
    } catch (e: unknown) {
      console.error("Error generating session", e);
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
      this.generationError.set(msg);
      // Reload session to show correct state (suggestions, etc.)
      await this.loadSession();
    } finally {
      clearInterval(interval);
      this.generating.set(false);
    }
  }

  getAppInfo(appId: string): AppInfo | undefined {
    return this.allApps().get(appId);
  }

  openApp(app: AppInfo) {
    this.router.navigate([app.route]);
  }

  async removeGroup(group: { ids: number[]; id: number }) {
    if (!confirm('Möchtest du diese Aufgaben wirklich aus der Sitzung entfernen?')) return;

    // Optimistic update
    this.session.update(current => {
      if (!current) return null;
      const newTasks = current.tasks.filter((t) => !group.ids.includes(t.id));
      return {
        ...current,
        tasks: newTasks
      };
    });

    const success = await this.apiService.completeTask(group.ids);
    if (!success) {
      alert('Fehler beim Entfernen der Aufgaben.');
      // Revert if needed, but for now we assume success or reload on error
      this.loadSession();
    }
  }

  startTask(group: { id: number; ids: number[]; tasks?: SessionTask[]; content?: Record<string, unknown> }, app: AppInfo) {
    // Merge content from all tasks in the group
    let mergedContent: Record<string, unknown> | Record<string, unknown>[] = {};

    const tasks = group.tasks || (group.content ? [group as unknown as SessionTask] : []);

    if (app.id === 'dasdass' || app.id === 'kasus') {
      const allSentences: string[] = [];
      for (const t of tasks) {
        const c = t.content as Record<string, unknown>;
        if (c?.['sentences'] && Array.isArray(c['sentences'])) {
          allSentences.push(...(c['sentences'] as string[]));
        } else if (typeof c?.['originalText'] === 'string') {
          allSentences.push(c['originalText'] as string);
        }
      }
      mergedContent = { sentences: allSentences };
    } else if (app.id === 'textaufgaben') {
      const allItems: Record<string, unknown>[] = [];
      for (const t of tasks) {
        if (Array.isArray(t.content)) {
          allItems.push(...(t.content as Record<string, unknown>[]));
        } else if (t.content) {
          allItems.push(t.content as Record<string, unknown>);
        }
      }
      mergedContent = allItems;
    } else {
      mergedContent = (tasks[0].content as Record<string, unknown>) ?? {};
    }

    this.router.navigate([app.route], {
      state: {
        learningContent: mergedContent,
        sessionId: this.session()!.session_id,
        taskId: group.id, // Primary ID to complete
        taskIds: group.ids // All IDs to complete (if app supports it)
      }
    });
  }

  getGroupTaskCount(group: { tasks?: SessionTask[] }): number {
    const tasks = group.tasks || [];
    let count = 0;
    for (const t of tasks) {
      count += this.getTaskCount(t);
    }
    return count;
  }

  getTaskCount(task: SessionTask): number {
    if (!task.content) return 0;
    const content = task.content as Record<string, unknown>;
    if (Array.isArray(content['sentences'])) return (content['sentences'] as unknown[]).length;
    if (Array.isArray(content['pairs'])) return (content['pairs'] as unknown[]).length;
    if (Array.isArray(content['questions'])) return (content['questions'] as unknown[]).length;
    return 1;
  }
}

