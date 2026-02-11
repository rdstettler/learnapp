import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AuthService } from './auth.service';
import { BadgeService } from './badge.service';
import { firstValueFrom } from 'rxjs';
import { LearningSession, SessionTask, NotEnoughDataResponse, LearningPlan, PlanNotEnoughDataResponse } from '../shared/models/learning-session.model';

export interface LearnResult {
    id?: number;
    appId: string;
    score: number;
    maxScore: number;
    completedAt?: string;
    durationSeconds?: number;
    details?: Record<string, unknown>;
}

export interface TelemetryEvent {
    appId: string;
    eventType: 'app_open' | 'app_close' | 'quiz_start' | 'quiz_complete' | string;
    metadata?: Record<string, unknown>;
}

@Injectable({
    providedIn: 'root'
})
export class ApiService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private badgeService = inject(BadgeService);

    // Use relative path - works in both dev and prod
    private readonly API_BASE = '/api';

    constructor() {
        // Sync user to database on every login
        this.authService.onUserLogin$.subscribe(() => {
            this.syncUser();
        });
    }


    /**
     * Sync user to database on login
     */
    async syncUser(): Promise<boolean> {
        const user = this.authService.user();
        if (!user) return false;

        try {
            await firstValueFrom(this.http.post(`${this.API_BASE}/user`, {
                type: 'sync',
                email: user.email,
                displayName: user.displayName,
                photoUrl: user.photoURL
            }));
            return true;
        } catch (error) {
            console.error('Failed to sync user:', error);
            return false;
        }
    }

    /**
     * Track telemetry event
     */
    async trackEvent(event: TelemetryEvent): Promise<boolean> {
        const user = this.authService.user();
        if (!user) return false;

        try {
            await firstValueFrom(this.http.post(`${this.API_BASE}/events`, {
                type: 'telemetry',
                appId: event.appId,
                eventType: event.eventType,
                metadata: event.metadata
            }));
            return true;
        } catch (error) {
            console.error('Failed to track event:', error);
            return false;
        }
    }

    /**
     * Track app open
     */
    async trackAppOpen(appId: string): Promise<boolean> {
        return this.trackEvent({ appId, eventType: 'app_open' });
    }

    // State for the active learning session
    activeSession = signal<LearningSession | null>(null);

    /**
     * Get current learning session
     * Returns:
     * - Session object if exists
     * - null if ready to generate (enough data but no active session)
     * - 404 object { message: "Not enough data", suggestedApps: [...] } if not enough data
     */
    async getLearningSession(): Promise<LearningSession | NotEnoughDataResponse | null> {
        const user = this.authService.user();
        if (!user) return null;

        try {
            const session = await firstValueFrom(this.http.get<LearningSession>(`${this.API_BASE}/learning-session`));
            this.activeSession.set(session);
            return session;
        } catch (error: unknown) {
            if (error instanceof HttpErrorResponse && error.status === 404) {
                return error.error as NotEnoughDataResponse; // Return the body which contains suggestedApps
            }
            console.error('Failed to get learning session:', error);
            throw error;
        }
    }

    /**
     * Generate a new learning session
     */
    async generateLearningSession(): Promise<LearningSession> {
        const user = this.authService.user();
        if (!user) throw new Error("User not logged in");

        try {
            const session = await firstValueFrom(this.http.post<LearningSession>(`${this.API_BASE}/learning-session`, {}));

            // Refresh session after generation
            await this.getLearningSession();

            return session;
        } catch (error: unknown) {
            if (error instanceof HttpErrorResponse && error.status === 400) {
                // No new results to process — rethrow with a user-friendly message
                throw new Error(error.error?.error || 'Keine neuen Ergebnisse zum Verarbeiten vorhanden.');
            }
            throw error;
        }
    }

    /**
     * Get a task from the active session for a specific app
     */
    getSessionTask(appId: string): SessionTask | null {
        const session = this.activeSession();
        if (!session || !session.tasks) return null;

        // Find the first pristine (not completed) task for this app
        return session.tasks.find((t) => t.app_id === appId && t.pristine) ?? null;
    }

    /**
     * Mark a session task as completed
     */
    async completeTask(taskId: number | number[]): Promise<boolean> {
        const user = this.authService.user();
        if (!user) return false;

        const payload = Array.isArray(taskId)
            ? { taskIds: taskId }
            : { taskId: taskId };

        try {
            await firstValueFrom(this.http.put(`${this.API_BASE}/learning-session`, payload));

            // Refresh session to update UI
            await this.getLearningSession();
            return true;
        } catch (error) {
            console.error('Failed to complete task(s):', error);
            return false;
        }
    }
    /**
     * Submit feedback/error report
     */
    async submitFeedback(feedback: {
        appId: string;
        content?: Record<string, unknown>;
        comment: string;
        errorType: string;
        sessionId?: string;
    }): Promise<boolean> {
        const user = this.authService.user();
        // Allow anonymous feedback if needed, but for now fallback to user check or specific handling?
        // Let's allow generic feedback but require user_uid if logged in.
        try {
            await firstValueFrom(this.http.post(`${this.API_BASE}/feedback`, {
                app_id: feedback.appId,
                session_id: feedback.sessionId || this.activeSession()?.session_id,
                content: feedback.content,
                comment: feedback.comment,
                error_type: feedback.errorType
            }));
            return true;
        } catch (error) {
            console.error('Failed to submit feedback:', error);
            return false;
        }
    }
    /**
     * Add new app content (Admin only)
     */
    async addAppContent(appId: string, content: object, level?: number | null): Promise<boolean> {
        const user = this.authService.user();
        if (!user) throw new Error("Unauthorized");

        try {
            await firstValueFrom(this.http.post(`${this.API_BASE}/admin/add-content`, {
                app_id: appId,
                content: content,
                ...(level != null && { level })
            }));
            return true;
        } catch (error: unknown) {
            console.error('Failed to add app content:', error);
            throw new Error(error instanceof HttpErrorResponse ? error.error?.error : 'Failed to add content');
        }
    }

    /**
     * Get app content with per-question stats (Admin only)
     */
    async getAppContent(appId: string, page = 1, limit = 50): Promise<{ items: any[]; total: number; page: number; limit: number }> {
        return firstValueFrom(this.http.get<any>(`${this.API_BASE}/admin/add-content?app_id=${appId}&page=${page}&limit=${limit}`));
    }

    /**
     * Update app content (Admin only)
     */
    async updateAppContent(id: number, data: object, level?: number | null, humanVerified?: boolean): Promise<boolean> {
        try {
            await firstValueFrom(this.http.put(`${this.API_BASE}/admin/add-content`, {
                id, data,
                ...(level != null && { level }),
                ...(humanVerified != null && { human_verified: humanVerified })
            }));
            return true;
        } catch (error: unknown) {
            console.error('Failed to update app content:', error);
            throw new Error(error instanceof HttpErrorResponse ? error.error?.error : 'Failed to update content');
        }
    }

    /**
     * Delete app content (Admin only)
     */
    async deleteAppContent(id: number): Promise<boolean> {
        try {
            await firstValueFrom(this.http.request('DELETE', `${this.API_BASE}/admin/add-content`, { body: { id } }));
            return true;
        } catch (error: unknown) {
            console.error('Failed to delete app content:', error);
            throw new Error(error instanceof HttpErrorResponse ? error.error?.error : 'Failed to delete content');
        }
    }

    /**
     * Submit question progress and check for new badges.
     * Call this after a user answers a question.
     */
    async submitQuestionProgress(appId: string, appContentId: number, isCorrect: boolean): Promise<void> {
        const user = this.authService.user();
        if (!user) return;

        try {
            await firstValueFrom(this.http.post(`${this.API_BASE}/events`, {
                type: 'question_progress',
                appId,
                appContentId,
                isCorrect
            }));

            // Fire-and-forget badge check after a short delay
            // (gives DB a moment to settle, avoids blocking the UI)
            setTimeout(() => this.badgeService.checkBadges(), 500);
        } catch (error) {
            console.error('Failed to submit question progress:', error);
        }
    }

    // ═══════════════════════════════════════
    //  Learning Plan
    // ═══════════════════════════════════════

    activePlan = signal<LearningPlan | null>(null);

    /**
     * Get current learning plan.
     * Returns:
     * - LearningPlan if one exists
     * - null if ready to generate (enough data)
     * - PlanNotEnoughDataResponse if not enough data (404)
     */
    async getLearningPlan(): Promise<LearningPlan | PlanNotEnoughDataResponse | null> {
        const user = this.authService.user();
        if (!user) return null;

        try {
            const plan = await firstValueFrom(
                this.http.get<LearningPlan>(`${this.API_BASE}/learning-session?type=plan`)
            );
            this.activePlan.set(plan);
            return plan;
        } catch (error: unknown) {
            if (error instanceof HttpErrorResponse && error.status === 404) {
                return error.error as PlanNotEnoughDataResponse;
            }
            console.error('Failed to get learning plan:', error);
            throw error;
        }
    }

    /**
     * Generate a new learning plan via AI.
     * @param days Number of days (1-7, default 3)
     */
    async generateLearningPlan(days = 3): Promise<LearningPlan> {
        const user = this.authService.user();
        if (!user) throw new Error("User not logged in");

        const plan = await firstValueFrom(
            this.http.post<LearningPlan>(`${this.API_BASE}/learning-session?type=plan`, { days })
        );
        this.activePlan.set(plan);
        return plan;
    }

    /**
     * Mark plan task(s) as completed.
     */
    async completePlanTask(taskId: number | number[]): Promise<boolean> {
        const user = this.authService.user();
        if (!user) return false;

        const payload = Array.isArray(taskId)
            ? { taskIds: taskId }
            : { taskId: taskId };

        try {
            await firstValueFrom(
                this.http.put(`${this.API_BASE}/learning-session?type=plan`, payload)
            );
            // Refresh plan state
            await this.getLearningPlan();
            return true;
        } catch (error) {
            console.error('Failed to complete plan task:', error);
            return false;
        }
    }

    /**
     * Abandon the active plan.
     */
    async abandonPlan(): Promise<boolean> {
        const user = this.authService.user();
        if (!user) return false;

        try {
            await firstValueFrom(
                this.http.delete(`${this.API_BASE}/learning-session?type=plan`)
            );
            this.activePlan.set(null);
            return true;
        } catch (error) {
            console.error('Failed to abandon plan:', error);
            return false;
        }
    }
}
