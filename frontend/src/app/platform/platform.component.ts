import { Component, inject, signal, computed, ChangeDetectorRef, OnInit, ViewChild, effect, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { OnboardingService } from '../services/onboarding.service';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { BadgeService } from '../services/badge.service';
import { AuthModalComponent, AppCardComponent } from '../shared';
import { BadgeShowcaseComponent } from '../shared/components/badge-showcase/badge-showcase.component';
import { LearningViewComponent } from './learning-view/learning-view.component';
import { PropertiesModalComponent } from './properties-modal/properties-modal.component';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { catchError, of } from 'rxjs';
import { AppInfo } from '../shared/components/app-card/app-card.component'; // Import from shared

interface AppsConfig {
    apps: AppInfo[];
}

@Component({
    selector: 'app-platform',
    standalone: true,
    imports: [AuthModalComponent, AppCardComponent, LearningViewComponent, PropertiesModalComponent, BadgeShowcaseComponent],
    templateUrl: './platform.component.html',
    styleUrl: './platform.component.css'
})
export class PlatformComponent implements OnInit, AfterViewInit {
    private router = inject(Router);
    private http = inject(HttpClient);
    userService = inject(UserService);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService);
    private sanitizer = inject(DomSanitizer);
    private onboardingService = inject(OnboardingService);
    badgeService = inject(BadgeService);

    // Auth
    authService = inject(AuthService);

    // User Properties Modal
    showPropertiesModal = signal(false);

    // Badge Showcase Modal
    showBadgeShowcase = signal(false);

    constructor() {
        // Load metrics and profile from backend when user logs in
        effect(() => {
            const user = this.authService.user();
            if (user) {
                this.userService.loadMetricsFromBackend();
                this.userService.loadProfileFromBackend();
                this.badgeService.loadBadges();
            }
        });

        // Check for missing properties
        effect(() => {
            const profile = this.userService.profile();
            if (profile) {
                // If either is null/undefined (and not -1), show modal
                const skillMissing = profile.skillLevel === null || profile.skillLevel === undefined;
                const learnMissing = profile.learnLevel === null || profile.learnLevel === undefined;

                // If set to -1, it means refused, so don't show
                const skillRefused = profile.skillLevel === -1;
                const learnRefused = profile.learnLevel === -1;

                if ((skillMissing && !skillRefused) || (learnMissing && !learnRefused)) {
                    if (!this.showPropertiesModal()) {
                        this.showPropertiesModal.set(true);
                    }
                }
            }
        });
        // Check view access on auth change
        effect(() => {
            const user = this.authService.user();
            const view = this.currentView();
            // If logged out and on a protected view, switch to 'all'
            if (!user && (view === 'favorites' || view === 'ai')) {
                this.setView('all');
            }
        }, { allowSignalWrites: true });

        // Load favorites if user is logged in
        effect(() => {
            const user = this.authService.user();
            if (user) {
                // Use untracked if loadFavorites reads other signals to avoid loops, 
                // but here it just makes an HTTP call.
                this.loadFavorites();
            } else {
                this.favorites.set(new Set());
            }
        }, { allowSignalWrites: true });
    }

    // Modal Actions
    closePropertiesModal(): void {
        this.showPropertiesModal.set(false);
    }

    @ViewChild(AuthModalComponent) authModal!: AuthModalComponent;



    // View State
    currentView = signal<'all' | 'favorites' | 'ai'>(
        (typeof localStorage !== 'undefined' && localStorage.getItem('dashboard_view') as 'all' | 'favorites' | 'ai') || 'all'
    );

    favorites = signal<Set<string>>(new Set());

    // Apps loaded from config
    readonly apps = signal<AppInfo[]>([]);

    readonly categories = computed(() => {
        const cats = new Set(this.apps().map(a => a.category));
        return ['all', ...Array.from(cats)];
    });

    currentCategory = signal<string>('all');

    readonly filteredApps = computed(() => {
        const view = this.currentView();
        const category = this.currentCategory();
        let apps = this.apps();

        // 1. Filter by View
        if (view === 'favorites') {
            apps = apps.filter(a => this.favorites().has(a.id));
        } else if (view === 'ai') {
            // Filter by skill level compatibility
            const profile = this.userService.profile();
            if (profile && profile.skillLevel !== null && profile.skillLevel !== -1) {
                apps = apps.filter(a => a.featured);
            } else {
                // No profile, show featured
                apps = apps.filter(a => a.featured);
            }
        }

        // 2. Filter by Category
        if (category !== 'all') {
            apps = apps.filter(a => a.category === category);
        }

        // 3. Sort
        return [...apps].sort((a, b) => {
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

    ngAfterViewInit(): void {
        // Start tour after view is initialized so elements exist
        // Small delay to ensure rendering
        setTimeout(() => {
            this.onboardingService.startTour();
        }, 1000);
    }

    private loadAppsConfig(): void {
        // Fallback Strategy: Try fetching from API, if it fails, load local config
        this.http.get<{ apps: AppInfo[] }>('/api/apps').pipe(
            catchError((err) => {
                console.warn('Failed to load apps from API, falling back to local config:', err);
                return this.http.get<AppsConfig>('/assets/apps.config.json');
            })
        ).subscribe({
            next: (data) => {
                // API returns { apps: [...] }
                const appsList = data.apps;
                if (Array.isArray(appsList)) {
                    this.apps.set(appsList);
                }
            },
            error: (err) => {
                console.error('Failed to load apps config (API and fallback failed):', err);
            }
        });
    }

    favoritesLoading = signal(false);

    private loadFavorites(): void {
        this.favoritesLoading.set(true);
        this.http.get<{ favorites: string[] }>('/api/favorites').subscribe({
            next: (res) => {
                const favSet = new Set(res.favorites);
                this.favorites.set(favSet);

                // If we have favorites and current view is default 'all', switch to favorites
                // Only do this on initial load to avoid jumping around if user is browsing
                if (favSet.size > 0 && this.currentView() === 'all') {
                    this.setView('favorites');
                }
                this.favoritesLoading.set(false);
            },
            error: (err) => {
                console.error('Error loading favorites:', err);
                this.favoritesLoading.set(false);
            }
        });
    }

    toggleFavorite(appId: string): void {
        const user = this.authService.user();
        if (!user) {
            this.openAuthModal();
            return;
        }

        const isFav = this.favorites().has(appId);
        // Optimistic update
        const newFavs = new Set(this.favorites());
        if (isFav) newFavs.delete(appId);
        else newFavs.add(appId);
        this.favorites.set(newFavs);

        this.http.post('/api/favorites', {
            app_id: appId,
            is_favorite: !isFav
        }).subscribe({
            error: (err) => {
                console.error('Error toggling favorite:', err);
                // Revert on error
                const revertFavs = new Set(this.favorites());
                if (isFav) revertFavs.add(appId);
                else revertFavs.delete(appId);
                this.favorites.set(revertFavs);
            }
        });
    }

    setView(view: 'all' | 'favorites' | 'ai'): void {
        this.currentView.set(view);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('dashboard_view', view);
        }
    }

    selectCategory(category: string): void {
        this.currentCategory.set(category);
    }

    openApp(app: AppInfo): void {
        // Legacy method, replaced by navigateToApp logic mostly, but used by AppCard output
        this.navigateToApp(app);
    }

    navigateToApp(app: AppInfo): void {
        const uid = this.authService.user()?.uid;
        this.userService.recordAppOpen(app.id, uid);

        // Track in database if user is authenticated
        this.apiService.trackAppOpen(app.id);

        // Use the router properly - navigate returns a promise
        this.router.navigate([app.route]).then(success => {
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
        if (!isoDate) return 'Nie';
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

    openBadgeShowcase(): void {
        if (!this.authService.user()) {
            this.openAuthModal();
            return;
        }
        this.showBadgeShowcase.set(true);
    }

    closeBadgeShowcase(): void {
        this.showBadgeShowcase.set(false);
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


