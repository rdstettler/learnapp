import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, shareReplay } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class DataService {
    private http = inject(HttpClient);
    private cache = new Map<string, Observable<any>>();

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
