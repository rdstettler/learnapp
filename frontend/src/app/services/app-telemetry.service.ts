import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class AppTelemetryService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private readonly API_BASE = '/api';

    /**
     * Track question-level progress (success/failure) for personalized content.
     * Only sends if user is logged in.
     */
    async trackProgress(appId: string, appContentId: number, isCorrect: boolean): Promise<void> {
        const user = this.authService.user();
        if (!user) return;

        try {
            await firstValueFrom(
                this.http.post(`${this.API_BASE}/events`, {
                    type: 'question_progress',
                    appId,
                    appContentId,
                    isCorrect
                })
            );
        } catch (error) {
            console.error('Failed to track progress:', error);
        }
    }

    /**
     * Generates a simple session ID for an app session
     */
    generateSessionId(): string {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
}
