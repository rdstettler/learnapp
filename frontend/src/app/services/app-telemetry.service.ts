import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { UserService } from './user.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class AppTelemetryService {
    private http = inject(HttpClient);
    private userService = inject(UserService);
    private readonly API_BASE = '/api';

    /**
     * Track an error or event in an app.
     * Only sends data if the user has opted in (learn_level > 0).
     */
    async trackError(appId: string, content: string, sessionId: string): Promise<void> {
        // specific check: only send if appTelemetry is enabled (learn_level > 0)
        if (!this.userService.appTelemetry()) {
            return;
        }

        const uid = this.userService.userId();
        
        try {
            await firstValueFrom(
                this.http.post(`${this.API_BASE}/app_results`, {
                    appId,
                    uid,
                    sessionId,
                    content
                })
            );
        } catch (error) {
            console.error('Failed to send app telemetry:', error);
        }
    }

    /**
     * Generates a simple session ID for an app session
     */
    generateSessionId(): string {
       return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
}
