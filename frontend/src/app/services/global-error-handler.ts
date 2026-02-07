import { ErrorHandler, Injectable, inject } from '@angular/core';
import { NotificationService } from './notification.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
    private notification = inject(NotificationService);

    handleError(error: unknown): void {
        // Always log the full error for debugging
        console.error('[GlobalErrorHandler]', error);

        // Extract a user-friendly message
        const message = this.extractMessage(error);

        // Show a non-intrusive toast (avoid spamming identical messages)
        this.notification.show(message, 'error');
    }

    private extractMessage(error: unknown): string {
        if (error instanceof Error) {
            // Filter out common Angular/network noise into friendlier messages
            if (error.message.includes('Http failure response')) {
                return 'Netzwerkfehler — bitte Verbindung prüfen.';
            }
            if (error.message.includes('ChunkLoadError') || error.message.includes('Loading chunk')) {
                return 'Update verfügbar — bitte Seite neu laden.';
            }
            return error.message.length > 120
                ? error.message.slice(0, 117) + '…'
                : error.message;
        }

        if (typeof error === 'string') {
            return error.length > 120 ? error.slice(0, 117) + '…' : error;
        }

        return 'Ein unerwarteter Fehler ist aufgetreten.';
    }
}
