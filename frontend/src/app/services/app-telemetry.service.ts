import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { BadgeService } from './badge.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class AppTelemetryService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private badgeService = inject(BadgeService);
    private readonly API_BASE = '/api';

    /**
     * Track question-level progress (success/failure) for personalized content.
     * Only sends if user is logged in.
     */
    async trackProgress(appId: string, appContentId: number, isCorrect: boolean, mode?: string): Promise<void> {
        const user = this.authService.user();
        if (!user) return;

        try {
            await firstValueFrom(
                this.http.post(`${this.API_BASE}/events`, {
                    type: 'question_progress',
                    appId,
                    appContentId,
                    isCorrect,
                    ...(mode ? { mode } : {})
                })
            );

            // Check for newly earned badges after recording progress
            setTimeout(() => this.badgeService.checkBadges(), 500);
        } catch (error) {
            console.error('Failed to track progress:', error);
        }
    }

    /**
     * Track progress for procedural apps (kopfrechnen, umrechnen, zeitrechnen)
     * that generate questions dynamically instead of using app_content entries.
     * The backend auto-creates app_content entries per category.
     */
    async trackCategoryProgress(appId: string, category: string, isCorrect: boolean, mode?: string): Promise<void> {
        const user = this.authService.user();
        if (!user) return;

        try {
            await firstValueFrom(
                this.http.post(`${this.API_BASE}/events`, {
                    type: 'question_progress',
                    appId,
                    category,
                    isCorrect,
                    ...(mode ? { mode } : {})
                })
            );

            setTimeout(() => this.badgeService.checkBadges(), 500);
        } catch (error) {
            console.error('Failed to track category progress:', error);
        }
    }
}
