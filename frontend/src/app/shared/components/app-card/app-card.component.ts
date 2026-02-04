
import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

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

export interface AppMetrics {
    openCount: number;
    lastOpened: string | null;
}

@Component({
    selector: 'app-app-card',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './app-card.component.html',
    styleUrl: './app-card.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppCardComponent {
    @Input({ required: true }) app!: AppInfo;
    @Input() metrics: AppMetrics = { openCount: 0, lastOpened: null };
    @Input() isFavorite = false;

    @Output() appClicked = new EventEmitter<void>();
    @Output() favoriteToggled = new EventEmitter<boolean>();

    onCardClick(event: Event): void {
        this.appClicked.emit();
    }

    onFavoriteClick(event: Event): void {
        event.stopPropagation(); // Prevent card click
        this.favoriteToggled.emit(!this.isFavorite);
    }

    formatDate(isoDate: string | null): string {
        if (!isoDate) return 'Nie';
        return new Date(isoDate).toLocaleDateString();
    }
}
