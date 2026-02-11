import { Component, inject, signal, computed, OnInit, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BadgeService, BadgeInfo } from '../../../services/badge.service';
import { StreakService } from '../../../services/streak.service';

@Component({
    selector: 'app-badge-showcase',
    standalone: true,
    imports: [DatePipe],
    templateUrl: './badge-showcase.component.html',
    styleUrl: './badge-showcase.component.css'
})
export class BadgeShowcaseComponent implements OnInit {
    private badgeService = inject(BadgeService);
    streakService = inject(StreakService);

    closed = output<void>();

    readonly badges = this.badgeService.badges;
    readonly loading = this.badgeService.loading;

    readonly selectedCategory = signal<string>('all');

    readonly categories = computed(() => {
        const cats = new Set(this.badges().map(b => b.category));
        return ['all', ...Array.from(cats)];
    });

    readonly filteredBadges = computed(() => {
        const cat = this.selectedCategory();
        const all = this.badges();
        if (cat === 'all') return all;
        return all.filter(b => b.category === cat);
    });

    readonly earnedCount = computed(() => this.badges().filter(b => b.earned).length);
    readonly totalCount = computed(() => this.badges().length);

    readonly progressPercent = computed(() => {
        const total = this.totalCount();
        if (total === 0) return 0;
        return Math.round((this.earnedCount() / total) * 100);
    });

    ngOnInit(): void {
        this.badgeService.loadBadges();
        this.streakService.loadStreak();
    }

    selectCategory(cat: string): void {
        this.selectedCategory.set(cat);
    }

    getCategoryLabel(cat: string): string {
        const labels: Record<string, string> = {
            'all': 'Alle',
            'first-steps': '🌱 Erste Schritte',
            'mastery': '🏅 Meisterschaft',
            'explorer': '🗺️ Entdecker',
            'streak': '🔥 Ausdauer',
            'special': '💎 Besondere'
        };
        return labels[cat] || cat;
    }

    getTierClass(tier: string): string {
        return `tier-${tier}`;
    }

    close(): void {
        this.closed.emit();
    }
}
