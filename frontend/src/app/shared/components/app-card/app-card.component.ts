
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
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
    app = input.required<AppInfo>();
    metrics = input<AppMetrics>({ openCount: 0, lastOpened: null });
    isFavorite = input(false);
    allowRemove = input(false);
    showFavorite = input(true);

    appClicked = output<void>();
    favoriteToggled = output<boolean>();
    removeClicked = output<void>();

    onCardClick(event: Event): void {
        this.appClicked.emit();
    }

    onFavoriteClick(event: Event): void {
        event.stopPropagation(); // Prevent card click
        this.favoriteToggled.emit(!this.isFavorite());
    }

    onRemoveClick(event: Event): void {
        event.stopPropagation();
        this.removeClicked.emit();
    }

    formatDate(isoDate: string | null): string {
        if (!isoDate) return 'Nie';
        return new Date(isoDate).toLocaleDateString();
    }
}
