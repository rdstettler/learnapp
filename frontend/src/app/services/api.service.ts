import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

export interface LearnResult {
    id?: number;
    appId: string;
    score: number;
    maxScore: number;
    completedAt?: string;
    durationSeconds?: number;
    details?: any;
}

export interface TelemetryEvent {
    appId: string;
    eventType: 'app_open' | 'app_close' | 'quiz_start' | 'quiz_complete' | string;
    metadata?: any;
}

@Injectable({
    providedIn: 'root'
})
export class ApiService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);

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
            await firstValueFrom(this.http.post(`${this.API_BASE}/sync_user`, {
                uid: user.uid,
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
            await firstValueFrom(this.http.post(`${this.API_BASE}/telemetry`, {
                uid: user.uid,
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
    activeSession = signal<any | null>(null);

    /**
     * Get current learning session
     * Returns:
     * - Session object if exists
     * - null if ready to generate (enough data but no active session)
     * - 404 object { message: "Not enough data", suggestedApps: [...] } if not enough data
     */
    async getLearningSession(): Promise<any> {
        const user = this.authService.user();
        if (!user) return null;

        try {
            const session = await firstValueFrom(this.http.get(`${this.API_BASE}/learning-session?user_uid=${user.uid}`));
            this.activeSession.set(session);
            return session;
        } catch (error: any) {
            if (error.status === 404) {
                return error.error; // Return the body which contains suggestedApps
            }
            console.error('Failed to get learning session:', error);
            throw error;
        }
    }

    /**
     * Generate a new learning session
     */
    async generateLearningSession(): Promise<any> {
        const user = this.authService.user();
        if (!user) throw new Error("User not logged in");

        const session = await firstValueFrom(this.http.post(`${this.API_BASE}/learning-session`, {
            user_uid: user.uid
        }));

        // Refresh session after generation
        await this.getLearningSession();

        return session;
    }

    /**
     * Get a task from the active session for a specific app
     */
    getSessionTask(appId: string): any | null {
        const session = this.activeSession();
        if (!session || !session.tasks) return null;

        // Find the first pristine (not completed) task for this app
        return session.tasks.find((t: any) => t.app_id === appId && t.pristine);
    }

    /**
     * Mark a session task as completed
     */
    async completeTask(taskId: number | number[]): Promise<boolean> {
        const user = this.authService.user();
        if (!user) return false;

        const payload = Array.isArray(taskId)
            ? { user_uid: user.uid, taskIds: taskId }
            : { user_uid: user.uid, taskId: taskId };

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
        content?: any;
        comment: string;
        errorType: string;
        sessionId?: string;
    }): Promise<boolean> {
        const user = this.authService.user();
        // Allow anonymous feedback if needed, but for now fallback to user check or specific handling?
        // Let's allow generic feedback but require user_uid if logged in.
        const uid = user ? user.uid : 'anonymous';

        try {
            await firstValueFrom(this.http.post(`${this.API_BASE}/feedback`, {
                user_uid: uid,
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
}
