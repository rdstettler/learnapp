import { Component, inject, signal, computed, ChangeDetectorRef, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';

export interface AppInfo {
    id: string;
    name: string;
    description: string;
    category: string;
    route: string;
    icon: string;
    tags: string[];
}

interface AppsConfig {
    apps: AppInfo[];
}

@Component({
    selector: 'app-platform',
    standalone: true,
    imports: [],
    templateUrl: './platform.component.html',
    styleUrl: './platform.component.css'
})
export class PlatformComponent implements OnInit {
    private router = inject(Router);
    private http = inject(HttpClient);
    private userService = inject(UserService);
    private cdr = inject(ChangeDetectorRef);

    // Apps loaded from config
    readonly apps = signal<AppInfo[]>([]);

    readonly categories = computed(() => {
        const cats = new Set(this.apps().map(a => a.category));
        return ['all', ...Array.from(cats)];
    });

    currentCategory = signal<string>('all');

    readonly filteredApps = computed(() => {
        const category = this.currentCategory();
        const filtered = category === 'all'
            ? this.apps()
            : this.apps().filter(a => a.category === category);

        // Sort by usage count (most used first)
        return [...filtered].sort((a, b) => {
            const metricsA = this.userService.getAppMetrics(a.id);
            const metricsB = this.userService.getAppMetrics(b.id);
            return metricsB.openCount - metricsA.openCount;
        });
    });

    get displayUserId(): string {
        return this.userService.getDisplayUserId();
    }

    ngOnInit(): void {
        this.loadAppsConfig();
    }

    private loadAppsConfig(): void {
        this.http.get<AppsConfig>('/assets/apps.config.json').subscribe({
            next: (config) => {
                this.apps.set(config.apps);
            },
            error: (err) => {
                console.error('Failed to load apps config:', err);
            }
        });
    }

    selectCategory(category: string): void {
        this.currentCategory.set(category);
    }

    openApp(app: AppInfo): void {
        console.log('Opening app:', app.id, 'route:', app.route);
        this.userService.recordAppOpen(app.id);
        this.router.navigateByUrl(app.route).then(
            success => console.log('Navigation success:', success),
            error => console.error('Navigation error:', error)
        );
    }

    navigateToApp(app: AppInfo): void {
        console.log('navigateToApp called:', app.id, app.route);
        this.userService.recordAppOpen(app.id);

        // Use the router properly - navigate returns a promise
        this.router.navigate([app.route]).then(success => {
            console.log('Navigation result:', success);
            if (success) {
                this.cdr.markForCheck();
            }
        }).catch(err => {
            console.error('Navigation error:', err);
        });
    }

    recordAppUsage(appId: string): void {
        this.userService.recordAppOpen(appId);
    }

    getAppMetrics(appId: string) {
        return this.userService.getAppMetrics(appId);
    }

    formatDate(isoDate: string | null): string {
        if (!isoDate) return 'Never';
        return new Date(isoDate).toLocaleDateString();
    }
}

