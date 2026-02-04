import { Component, inject, signal, computed, ChangeDetectorRef, OnInit, ViewChild, effect, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { OnboardingService } from '../services/onboarding.service';
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
export class PlatformComponent implements OnInit, AfterViewInit {
    private router = inject(Router);
    private http = inject(HttpClient);
    userService = inject(UserService);
    private cdr = inject(ChangeDetectorRef);
    private apiService = inject(ApiService);
    private sanitizer = inject(DomSanitizer);
    private onboardingService = inject(OnboardingService);

    // Auth
    authService = inject(AuthService);

    // User Properties Modal
    showPropertiesModal = signal(false);
    propertiesStep = signal<1 | 2 | 3 | 4>(1);

    // Form values
    tempSkillLevel = signal<number>(0.5);
    tempSchoolType = signal<string | null>(null);
    tempLearnLevel = signal<number | null>(null);

    // School types for step 3
    readonly schoolTypes = ['Kindergarten', 'Primarschule', 'Sekundarschule', 'Gymnasium'];

    // Grades for step 4 based on school type
    get gradesForType(): number[] {
        const type = this.tempSchoolType();
        switch (type) {
            case 'Kindergarten': return [1, 2];
            case 'Primarschule': return [1, 2, 3, 4, 5, 6];
            case 'Sekundarschule': return [1, 2, 3];
            case 'Gymnasium': return [1, 2, 3, 4, 5, 6];
            default: return [];
        }
    }

    constructor() {
        // Load metrics and profile from backend when user logs in
        effect(() => {
            const user = this.authService.user();
            if (user) {
                this.userService.loadMetricsFromBackend(user.uid);
                this.userService.loadProfileFromBackend(user.uid);
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
                    // Only open if not already open/handled to avoid loops or flashing
                    // Use untracked if needed, but here we just check if it's already true
                    if (!this.showPropertiesModal()) {
                        this.showPropertiesModal.set(true);
                    }
                }
            }
        });
    }

    // Modal Actions
    refuseProperties(): void {
        const uid = this.authService.user()?.uid;
        if (uid) {
            this.userService.updateProfile({ skillLevel: -1, learnLevel: -1 }, uid);
        }
        this.showPropertiesModal.set(false);
    }

    nextStep(): void {
        this.propertiesStep.update(s => (s < 4 ? s + 1 : s) as 1 | 2 | 3 | 4);
    }

    setSkillLevel(event: Event): void {
        const val = (event.target as HTMLInputElement).value;
        this.tempSkillLevel.set(parseFloat(val));
    }

    selectSchoolType(type: string): void {
        this.tempSchoolType.set(type);
        this.nextStep();
    }

    selectGrade(grade: number): void {
        this.tempLearnLevel.set(grade);
        this.saveProperties();
    }

    saveProperties(): void {
        const type = this.tempSchoolType();
        let grade = this.tempLearnLevel() || 1;
        let skill = this.tempSkillLevel();

        // Calculate stored learn level
        // Kindergarten 1-2 -> 1, 2 is OK? User: "start with 0 for pre-kindergarten, then 1-2 for kindergarten"
        // Primarschule 1-6 -> 3-8 (So +2)
        // Sekundarschule 1-3 -> 9-11 (So +8). User said "store 9-12" for 1-3? 1->9. 
        // Gymnasium 1-6 -> 9-14 (So +8). User said "store 9-15".

        let finalLearnLevel = 0;

        switch (type) {
            case 'Kindergarten':
                finalLearnLevel = grade; // 1-2
                break;
            case 'Primarschule':
                finalLearnLevel = grade + 2; // 1->3, 6->8
                break;
            case 'Sekundarschule':
                finalLearnLevel = grade + 8; // 1->9
                // Adjust skill level if user didn't change it or just based on rule
                if (skill === 0.5) skill = 0.3;
                break;
            case 'Gymnasium':
                finalLearnLevel = grade + 8; // 1->9
                // Adjust skill level
                if (skill === 0.5) skill = 0.8;
                break;
        }

        const uid = this.authService.user()?.uid;
        if (uid) {
            this.userService.updateProfile({ skillLevel: skill, learnLevel: finalLearnLevel }, uid);
        }
        this.showPropertiesModal.set(false);
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


