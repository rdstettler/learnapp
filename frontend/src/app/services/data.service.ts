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
     * Generate next learning set using AI Voci endpoint
     */
    generateAiVoci(langCode: string, mode: string, inputMode: string, previousIteration?: any[]): Observable<any> {
        const url = '/api/ai-voci/generate';
        return this.http.post<any>(url, {
            lang_code: langCode,
            mode: mode,
            input_mode: inputMode,
            previous_iteration: previousIteration
        });
    }

    /**
     * Transcribe base64 audio via AI audio endpoint
     */
    transcribeAudio(audioBase64: string, language?: string): Observable<{ text: string }> {
        const url = '/api/ai-voci/audio';
        return this.http.post<{ text: string }>(url, {
            method: 'stt',
            audioBase64,
            language
        });
    }

    /**
     * Synthesize text to audio via AI audio endpoint
     */
    synthesizeAudio(text: string, language?: string): Observable<Blob> {
        const url = '/api/ai-voci/audio';
        return this.http.post(url, { 
            method: 'tts',
            text, 
            language 
        }, { responseType: 'blob' });
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
