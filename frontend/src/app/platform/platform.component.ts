import { Component, inject, signal, computed, ChangeDetectorRef, OnInit, ViewChild, effect } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { AuthModalComponent } from '../shared';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { catchError, of } from 'rxjs';

export interface AppInfo {
    id: string;
    name: string;
    description: string;
    category: string;
    route: string;
    icon: string;
    tags: string[];
    featured?: boolean;
}

interface AppsConfig {
    apps: AppInfo[];
}

@Component({
    selector: 'app-platform',
    standalone: true,
    imports: [AuthModalComponent],
    templateUrl: './platform.component.html',
    styleUrl: './platform.component.css'
})
export class PlatformComponent implements OnInit {
    private router = inject(Router);
    private http = inject(HttpClient);
    userService = inject(UserService);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService);
    private sanitizer = inject(DomSanitizer);

    // Auth
    authService = inject(AuthService);

    constructor() {
        // Load metrics and profile from backend when user logs in
        effect(() => {
            const user = this.authService.user();
            if (user) {
                this.userService.loadMetricsFromBackend(user.uid);
                this.userService.loadProfileFromBackend(user.uid);
            }
        });
    }
    @ViewChild(AuthModalComponent) authModal!: AuthModalComponent;



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
        // Also prioritize featured apps if desired
        return [...filtered].sort((a, b) => {
            // Logic: Featured first? Or purely usage?
            // For now sticking to usage as per existing logic, but we can verify featured property presence
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
        // Fallback Strategy: Try fetching from API, if it fails, load local config
        this.http.get<{ apps: AppInfo[] }>('/api/apps').pipe(
            catchError((err) => {
                console.warn('Failed to load apps from API, falling back to local config:', err);
                return this.http.get<AppsConfig>('/assets/apps.config.json');
            })
        ).subscribe({
            next: (config) => {
                if (config && config.apps) {
                    this.apps.set(config.apps);
                }
            },
            error: (err) => {
                console.error('Failed to load apps config (API and fallback failed):', err);
            }
        });
    }

    selectCategory(category: string): void {
        this.currentCategory.set(category);
    }

    openApp(app: AppInfo): void {
        console.log('Opening app:', app.id, 'route:', app.route);
        const uid = this.authService.user()?.uid;
        this.userService.recordAppOpen(app.id, uid);
        this.router.navigateByUrl(app.route).then(
            success => console.log('Navigation success:', success),
            error => console.error('Navigation error:', error)
        );
    }

    navigateToApp(app: AppInfo): void {
        console.log('navigateToApp called:', app.id, app.route);
        const uid = this.authService.user()?.uid;
        this.userService.recordAppOpen(app.id, uid);

        // Track in database if user is authenticated
        this.apiService.trackAppOpen(app.id);

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

    openAuthModal(): void {
        this.authModal.open('login');
    }

    signOut(): void {
        this.authService.signOut();
    }

    openSettings(): void {
        this.router.navigate(['/settings']);
    }

    getDisplayName(): string {
        const profile = this.userService.profile();
        if (profile?.displayName) {
            return profile.displayName;
        }
        return this.authService.user()?.displayName || this.authService.user()?.email || '';
    }

    getSafeAvatarSvg(): SafeHtml | null {
        const svg = this.userService.getAvatarSvg();
        return svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : null;
    }
}


