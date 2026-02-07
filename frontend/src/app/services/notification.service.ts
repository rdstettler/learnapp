import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
    id: number;
    text: string;
    type: 'error' | 'warning' | 'info';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
    private nextId = 0;
    readonly messages = signal<ToastMessage[]>([]);

    show(text: string, type: ToastMessage['type'] = 'error', durationMs = 6000): void {
        const id = this.nextId++;
        this.messages.update(msgs => [...msgs, { id, text, type }]);

        setTimeout(() => this.dismiss(id), durationMs);
    }

    dismiss(id: number): void {
        this.messages.update(msgs => msgs.filter(m => m.id !== id));
    }
}
