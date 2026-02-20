import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, shareReplay, map } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private http = inject(HttpClient);
    private cache = new Map<string, Observable<unknown>>();

    /**
     * Load JSON data from assets folder.
     * Data is cached to avoid repeated network requests.
     * 
     * In the future, this can be swapped to use backend API endpoints.
     */
    loadData<T>(filename: string): Observable<T> {
        const path = `/assets/data/${filename}`;

        if (!this.cache.has(path)) {
            const request = this.http.get<T>(path).pipe(
                shareReplay(1)
            );
            this.cache.set(path, request);
        }

        return this.cache.get(path) as Observable<T>;
    }

    /**
     * Load app content from API
     * Returns full content rows including id, data, and mastery info (if logged in)
     */
    loadAppContent<T>(appId: string, mode?: string): Observable<(T & { _contentId?: number; _mastery?: string })[]> {
        let url = `/api/apps?app_id=${appId}`;
        if (mode) url += `&mode=${mode}`;

        if (!this.cache.has(url)) {
            const request = this.http.get<{ content: { id: number; data: T; mastery?: string; success_count?: number; failure_count?: number }[] }>(url).pipe(
                map(res => res.content.map(row => ({
                    ...row.data,
                    _contentId: row.id,
                    _mastery: row.mastery
                }))),
                shareReplay(1)
            );
            this.cache.set(url, request);
        }
        return this.cache.get(url) as Observable<(T & { _contentId?: number; _mastery?: string })[]>;
    }

    /**
     * Clear cached data (useful for testing or when data updates)
     */
    clearCache(filename?: string): void {
        if (filename) {
            this.cache.delete(`/assets/data/${filename}`);
        } else {
            this.cache.clear();
        }
    }
}
