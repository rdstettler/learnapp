import { Injectable, signal, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface ThemeConfig {
    mode: 'dark' | 'light';
    accentColor: string;
    customOverrides: Record<string, string>;
}

const DEFAULT_THEME: ThemeConfig = {
    mode: 'dark',
    accentColor: '#6366f1',
    customOverrides: {}
};

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private readonly STORAGE_KEY = 'learnapp_theme';
    private platformId = inject(PLATFORM_ID);

    private _theme = signal<ThemeConfig>(this.loadTheme());
    readonly theme = this._theme.asReadonly();

    constructor() {
        // Apply theme changes to DOM when signal updates
        effect(() => {
            this.applyTheme(this._theme());
        });
    }

    private loadTheme(): ThemeConfig {
        if (!isPlatformBrowser(this.platformId)) {
            return DEFAULT_THEME;
        }
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? { ...DEFAULT_THEME, ...JSON.parse(stored) } : DEFAULT_THEME;
    }

    private saveTheme(): void {
        if (isPlatformBrowser(this.platformId)) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._theme()));
        }
    }

    private applyTheme(config: ThemeConfig): void {
        if (!isPlatformBrowser(this.platformId)) return;

        const root = document.documentElement;

        // Apply mode (dark/light)
        if (config.mode === 'light') {
            root.style.setProperty('--bg-primary', '#f5f5f7');
            root.style.setProperty('--bg-card', 'rgba(0, 0, 0, 0.04)');
            root.style.setProperty('--text-primary', '#1a1a1f');
            root.style.setProperty('--text-secondary', '#606070');
            root.style.setProperty('--border-color', 'rgba(0, 0, 0, 0.1)');
        } else {
            root.style.setProperty('--bg-primary', '#0a0a0f');
            root.style.setProperty('--bg-card', 'rgba(255, 255, 255, 0.04)');
            root.style.setProperty('--text-primary', '#ffffff');
            root.style.setProperty('--text-secondary', '#a0a0b0');
            root.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.1)');
        }

        // Apply accent color
        root.style.setProperty('--accent-1', config.accentColor);

        // Apply custom overrides
        Object.entries(config.customOverrides).forEach(([key, value]) => {
            root.style.setProperty(key, value);
        });
    }

    setMode(mode: 'dark' | 'light'): void {
        this._theme.update(t => ({ ...t, mode }));
        this.saveTheme();
    }

    setAccentColor(color: string): void {
        this._theme.update(t => ({ ...t, accentColor: color }));
        this.saveTheme();
    }

    setCustomOverride(variable: string, value: string): void {
        this._theme.update(t => ({
            ...t,
            customOverrides: { ...t.customOverrides, [variable]: value }
        }));
        this.saveTheme();
    }

    resetToDefaults(): void {
        this._theme.set(DEFAULT_THEME);
        this.saveTheme();
    }
}
