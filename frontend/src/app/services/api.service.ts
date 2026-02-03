import { Injectable, inject } from '@angular/core';
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

    /**
     * Save quiz result
     */
    async saveResult(result: Omit<LearnResult, 'id' | 'completedAt'>): Promise<number | null> {
        const user = this.authService.user();
        if (!user) return null;

        try {
            const response = await firstValueFrom(this.http.post<{ success: boolean; id: number }>(
                `${this.API_BASE}/results`,
                {
                    uid: user.uid,
                    appId: result.appId,
                    score: result.score,
                    maxScore: result.maxScore,
                    durationSeconds: result.durationSeconds,
                    details: result.details
                }
            ));
            return response.id;
        } catch (error) {
            console.error('Failed to save result:', error);
            return null;
        }
    }

    /**
     * Get user's results
     */
    async getResults(appId?: string, limit: number = 10): Promise<LearnResult[]> {
        const user = this.authService.user();
        if (!user) return [];

        try {
            let url = `${this.API_BASE}/results?uid=${user.uid}&limit=${limit}`;
            if (appId) {
                url += `&appId=${appId}`;
            }

            const response = await firstValueFrom(this.http.get<{ results: LearnResult[] }>(url));
            return response.results;
        } catch (error) {
            console.error('Failed to get results:', error);
            return [];
        }
    }
}
