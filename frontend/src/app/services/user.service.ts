import { Injectable, signal, computed } from '@angular/core';

export interface AppMetrics {
    openCount: number;
    lastOpened: string | null;
}

export interface UserMetrics {
    [appId: string]: AppMetrics;
}

@Injectable({
    providedIn: 'root'
})
export class UserService {
    private readonly STORAGE_KEY_USER_ID = 'learnapp_user_id';
    private readonly STORAGE_KEY_METRICS = 'learnapp_metrics';

    private _userId = signal<string>(this.loadOrCreateUserId());
    private _metrics = signal<UserMetrics>(this.loadMetrics());

    readonly userId = this._userId.asReadonly();
    readonly metrics = this._metrics.asReadonly();

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

    private saveMetrics(): void {
        localStorage.setItem(this.STORAGE_KEY_METRICS, JSON.stringify(this._metrics()));
    }

    recordAppOpen(appId: string): void {
        const current = this._metrics();
        const appMetrics = current[appId] || { openCount: 0, lastOpened: null };

        this._metrics.set({
            ...current,
            [appId]: {
                openCount: appMetrics.openCount + 1,
                lastOpened: new Date().toISOString()
            }
        });

        this.saveMetrics();
    }

    getAppMetrics(appId: string): AppMetrics {
        return this._metrics()[appId] || { openCount: 0, lastOpened: null };
    }

    getDisplayUserId(): string {
        return this._userId().slice(0, 8) + '...';
    }
}
