import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface AppMetrics {
    openCount: number;
    lastOpened: string | null;
}

export interface UserMetrics {
    [appId: string]: AppMetrics;
}

export interface AvatarConfig {
    skinTone: string;
    hairStyle: string;
    hairColor: string;
    eyes: string;
    eyebrows: string;
    mouth: string;
    accessories: string;
    facialHair: string;
    backgroundColor: string;
}

export interface UserProfile {
    displayName: string | null;
    avatarConfig: AvatarConfig | null;
    avatarSvg: string | null;
    skillLevel?: number | null;
    learnLevel?: number | null;
    languageVariant?: 'swiss' | 'standard';
}

@Injectable({
    providedIn: 'root'
})
export class UserService {
    private http = inject(HttpClient);

    private readonly STORAGE_KEY_USER_ID = 'learnapp_user_id';
    private readonly STORAGE_KEY_METRICS = 'learnapp_metrics';
    private readonly STORAGE_KEY_PROFILE = 'learnapp_profile';
    private readonly API_BASE = '/api';

    private _userId = signal<string>(this.loadOrCreateUserId());
    private _metrics = signal<UserMetrics>(this.loadMetrics());
    private _profile = signal<UserProfile | null>(this.loadProfile());
    private _metricsLoaded = signal<boolean>(false);

    readonly userId = this._userId.asReadonly();
    readonly metrics = this._metrics.asReadonly();
    readonly profile = this._profile.asReadonly();
    readonly metricsLoaded = this._metricsLoaded.asReadonly();

    readonly appTelemetry = computed(() => {
        const profile = this._profile();
        if (!profile || profile.learnLevel === undefined || profile.learnLevel === null) {
            return false;
        }
        return profile.learnLevel > 0;
    });



    private loadOrCreateUserId(): string {
        let id = localStorage.getItem(this.STORAGE_KEY_USER_ID);
        if (!id) {
            id = this.generateUUID();
            localStorage.setItem(this.STORAGE_KEY_USER_ID, id);
        }
        return id;
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    private loadMetrics(): UserMetrics {
        const stored = localStorage.getItem(this.STORAGE_KEY_METRICS);
        return stored ? JSON.parse(stored) : {};
    }

    private saveMetricsLocal(): void {
        localStorage.setItem(this.STORAGE_KEY_METRICS, JSON.stringify(this._metrics()));
    }

    private loadProfile(): UserProfile | null {
        const stored = localStorage.getItem(this.STORAGE_KEY_PROFILE);
        return stored ? JSON.parse(stored) : null;
    }

    private saveProfileLocal(): void {
        const profile = this._profile();
        if (profile) {
            localStorage.setItem(this.STORAGE_KEY_PROFILE, JSON.stringify(profile));
        }
    }

    /**
     * Load metrics from backend for authenticated user
     */
    async loadMetricsFromBackend(uid: string): Promise<void> {
        try {
            const response = await firstValueFrom(
                this.http.get<{ metrics: UserMetrics }>(`${this.API_BASE}/user?type=metrics&uid=${uid}`)
            );
            if (response.metrics) {
                this._metrics.set(response.metrics);
                this.saveMetricsLocal(); // Cache locally
            }
            this._metricsLoaded.set(true);
        } catch (error) {
            console.error('Failed to load metrics from backend:', error);
            // Fall back to local metrics
            this._metricsLoaded.set(true);
        }
    }

    /**
     * Load profile from backend for authenticated user
     */
    async loadProfileFromBackend(uid: string): Promise<void> {
        try {
            const response = await firstValueFrom(
                this.http.get<{ profile: UserProfile }>(`${this.API_BASE}/user?type=profile&uid=${uid}`)
            );
            if (response.profile) {
                this._profile.set(response.profile);
                this.saveProfileLocal(); // Cache locally
            }
        } catch (error) {
            console.error('Failed to load profile from backend:', error);
        }
    }

    /**
     * Record app open - saves to local and syncs to backend
     */
    recordAppOpen(appId: string, uid?: string): void {
        const current = this._metrics();
        const appMetrics = current[appId] || { openCount: 0, lastOpened: null };

        const newMetrics = {
            ...current,
            [appId]: {
                openCount: appMetrics.openCount + 1,
                lastOpened: new Date().toISOString()
            }
        };

        this._metrics.set(newMetrics);
        this.saveMetricsLocal();

        // Sync to backend if user is authenticated
        if (uid) {
            this.syncMetricsToBackend(uid, newMetrics);
        }
    }

    /**
     * Sync metrics to backend
     */
    private async syncMetricsToBackend(uid: string, metrics: UserMetrics): Promise<void> {
        try {
            await firstValueFrom(
                this.http.post(`${this.API_BASE}/user`, { type: 'metrics', uid, metrics })
            );
        } catch (error) {
            console.error('Failed to sync metrics to backend:', error);
        }
    }

    /**
     * Update user profile
     */
    async updateProfile(profile: Partial<UserProfile>, uid?: string): Promise<boolean> {
        const currentProfile = this._profile() || { displayName: null, avatarConfig: null, avatarSvg: null };
        const newProfile = { ...currentProfile, ...profile };

        this._profile.set(newProfile);
        this.saveProfileLocal();

        // Sync to backend if user is authenticated
        if (uid) {
            try {
                await firstValueFrom(
                    this.http.post(`${this.API_BASE}/user`, { type: 'profile', uid, profile: newProfile })
                );
                return true;
            } catch (error) {
                console.error('Failed to sync profile to backend:', error);
                return false;
            }
        }

        return true;
    }

    getAppMetrics(appId: string): AppMetrics {
        return this._metrics()[appId] || { openCount: 0, lastOpened: null };
    }

    getDisplayUserId(): string {
        return this._userId().slice(0, 8) + '...';
    }

    getDisplayName(): string | null {
        return this._profile()?.displayName || null;
    }

    getAvatarSvg(): string | null {
        return this._profile()?.avatarSvg || null;
    }
}
