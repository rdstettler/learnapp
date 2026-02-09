import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

export interface BadgeInfo {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    tier: string;
    earned: boolean;
    awardedAt: string | null;
}

export interface NewBadge {
    id: string;
    name: string;
    icon: string;
    tier: string;
}

@Injectable({ providedIn: 'root' })
export class BadgeService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private readonly API_BASE = '/api';

    /** All badge definitions with earned status */
    readonly badges = signal<BadgeInfo[]>([]);

    /** Queue of newly awarded badges waiting to be shown as toasts */
    readonly pendingNotifications = signal<NewBadge[]>([]);

    /** Whether we're currently loading badges */
    readonly loading = signal(false);

    /** Count of earned badges */
    get earnedCount(): number {
        return this.badges().filter(b => b.earned).length;
    }

    /** Load all badges + earned status from backend */
    async loadBadges(): Promise<void> {
        const user = this.authService.user();
        if (!user) return;

        this.loading.set(true);
        try {
            const res = await firstValueFrom(
                this.http.get<{ badges: BadgeInfo[] }>(`${this.API_BASE}/user?type=badges`)
            );
            this.badges.set(res.badges);
        } catch (error) {
            console.error('Failed to load badges:', error);
        } finally {
            this.loading.set(false);
        }
    }

    /**
     * Check for newly earned badges.
     * Call this after submitting question progress or completing tasks.
     * Returns the newly earned badges and queues them for toast display.
     */
    async checkBadges(): Promise<NewBadge[]> {
        const user = this.authService.user();
        if (!user) return [];

        try {
            const res = await firstValueFrom(
                this.http.post<{ newBadges: NewBadge[] }>(`${this.API_BASE}/user`, { type: 'badges' })
            );

            if (res.newBadges && res.newBadges.length > 0) {
                // Queue notifications
                this.pendingNotifications.update(pending => [...pending, ...res.newBadges]);
                // Refresh full badge list
                await this.loadBadges();
            }

            return res.newBadges || [];
        } catch (error) {
            console.error('Failed to check badges:', error);
            return [];
        }
    }

    /** Dismiss the oldest pending notification */
    dismissNotification(): void {
        this.pendingNotifications.update(pending => pending.slice(1));
    }

    /** Dismiss a specific notification by badge id */
    dismissNotificationById(badgeId: string): void {
        this.pendingNotifications.update(pending => pending.filter(b => b.id !== badgeId));
    }
}
