import { Component, inject } from '@angular/core';
import { BadgeService } from '../../../services/badge.service';

@Component({
    selector: 'app-badge-notification',
    standalone: true,
    templateUrl: './badge-notification.component.html',
    styleUrl: './badge-notification.component.css'
})
export class BadgeNotificationComponent {
    badgeService = inject(BadgeService);

    readonly pending = this.badgeService.pendingNotifications;

    dismiss(badgeId: string): void {
        this.badgeService.dismissNotificationById(badgeId);
    }
}
