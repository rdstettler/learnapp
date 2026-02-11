import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { StreakService } from '../services/streak.service';
import { firstValueFrom } from 'rxjs';

interface AppAccuracy {
    appId: string;
    appName: string;
    appIcon: string;
    correct: number;
    total: number;
    accuracy: number;
}

interface WeakArea {
    appId: string;
    appName: string;
    appIcon: string;
    preview: string;
    successCount: number;
    failureCount: number;
}

interface StatsData {
    overview: {
        totalAnswers: number;
        totalCorrect: number;
        accuracy: number;
        appsUsed: number;
        totalActiveDays: number;
    };
    perApp: AppAccuracy[];
    heatmap: string[];
    weakAreas: WeakArea[];
}

@Component({
    selector: 'app-stats',
    standalone: true,
    templateUrl: './stats.component.html',
    styleUrl: './stats.component.css'
})
export class StatsComponent implements OnInit {
    private router = inject(Router);
    private http = inject(HttpClient);
    authService = inject(AuthService);
    streakService = inject(StreakService);

    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly stats = signal<StatsData | null>(null);

    // Heatmap grid: 90 days, grouped into weeks
    readonly heatmapGrid = computed(() => {
        const data = this.stats();
        if (!data) return [];

        const activeDates = new Set(data.heatmap);
        const today = new Date();
        const cells: { date: string; active: boolean; dayOfWeek: number }[] = [];

        for (let i = 89; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            cells.push({
                date: dateStr,
                active: activeDates.has(dateStr),
                dayOfWeek: d.getDay()
            });
        }

        // Group into weeks (columns)
        const weeks: { date: string; active: boolean; dayOfWeek: number }[][] = [];
        let currentWeek: { date: string; active: boolean; dayOfWeek: number }[] = [];

        for (const cell of cells) {
            if (cell.dayOfWeek === 1 && currentWeek.length > 0) {
                weeks.push(currentWeek);
                currentWeek = [];
            }
            currentWeek.push(cell);
        }
        if (currentWeek.length > 0) weeks.push(currentWeek);

        return weeks;
    });

    ngOnInit(): void {
        if (!this.authService.isAuthenticated()) {
            this.router.navigate(['/']);
            return;
        }
        this.loadStats();
        this.streakService.loadStreak();
    }

    async loadStats(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);

        try {
            const data = await firstValueFrom(
                this.http.get<StatsData>('/api/user?type=stats')
            );
            this.stats.set(data);
        } catch (e) {
            console.error('Failed to load stats:', e);
            this.error.set('Statistiken konnten nicht geladen werden.');
        } finally {
            this.loading.set(false);
        }
    }

    getAccuracyColor(accuracy: number): string {
        if (accuracy >= 80) return '#22c55e';
        if (accuracy >= 60) return '#eab308';
        if (accuracy >= 40) return '#f97316';
        return '#ef4444';
    }

    formatDate(dateStr: string): string {
        const d = new Date(dateStr);
        return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
    }

    goBack(): void {
        this.router.navigate(['/']);
    }
}
