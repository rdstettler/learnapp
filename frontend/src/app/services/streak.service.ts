import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';

export interface StreakData {
    currentStreak: number;
    longestStreak: number;
    totalActiveDays: number;
    lastActivityDate: string | null;
}

@Injectable({ providedIn: 'root' })
export class StreakService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);

    readonly streak = signal<StreakData>({
        currentStreak: 0,
        longestStreak: 0,
        totalActiveDays: 0,
        lastActivityDate: null
    });

    readonly loading = signal(false);

    /** Whether the user was active today (streak is "alive") */
    get isActiveToday(): boolean {
        const last = this.streak().lastActivityDate;
        if (!last) return false;
        return last === new Date().toISOString().slice(0, 10);
    }

    async loadStreak(): Promise<void> {
        const user = this.authService.user();
        if (!user) return;

        this.loading.set(true);
        try {
            const data = await firstValueFrom(
                this.http.get<StreakData>('/api/user?type=streak')
            );
            this.streak.set(data);
        } catch (error) {
            console.error('Failed to load streak:', error);
        } finally {
            this.loading.set(false);
        }
    }
}
