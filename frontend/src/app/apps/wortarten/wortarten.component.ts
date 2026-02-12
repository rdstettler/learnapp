import { Component, signal, computed, inject, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs';
import { shuffle } from '../../shared/utils/array.utils';
import { AppTelemetryService } from '../../services/app-telemetry.service';
import { UserService } from '../../services/user.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';

/** Tag codes used in the annotated text */
type WordTag = 'n' | 'v' | 'a' | 'pr' | 'pa' | 'av';

/** Human-readable category labels matching the tag codes */
interface WortartCategory {
    tag: WordTag;
    label: string;
    color: string;           // CSS color token
    bgClass: string;         // utility class name for bg highlight
}

/** A single token from a parsed sentence */
interface DisplayToken {
    text: string;
    index: number;
    tag: WordTag | null;      // null = unmarked plain word
}

type Screen = 'welcome' | 'quiz' | 'results';

interface TextItem {
    text: string;
    _contentId?: number;
}

const ALL_CATEGORIES: WortartCategory[] = [
    { tag: 'n', label: 'Nomen', color: '#8B5E3C', bgClass: 'tag-n' },
    { tag: 'v', label: 'Verb', color: '#3B82F6', bgClass: 'tag-v' },
    { tag: 'a', label: 'Adjektiv', color: '#EAB308', bgClass: 'tag-a' },
    { tag: 'av', label: 'Adverb', color: '#22C55E', bgClass: 'tag-av' },
    { tag: 'pr', label: 'Pronomen', color: '#F97316', bgClass: 'tag-pr' },
    { tag: 'pa', label: 'Partikel', color: '#22C55E', bgClass: 'tag-pa' },
];

/** Which categories are enabled at which skill thresholds */
const BASE_TAGS: WordTag[] = ['n', 'v', 'a'];
const EXTENDED_TAGS: WordTag[] = ['n', 'v', 'a', 'av', 'pr', 'pa'];

@Component({
    selector: 'app-wortarten',
    standalone: true,
    imports: [LearningAppLayoutComponent],
    templateUrl: './wortarten.component.html',
    styleUrl: './wortarten.component.css'
})
export class WortartenComponent {
    private http = inject(HttpClient);
    private cdr = inject(ChangeDetectorRef);
    private telemetryService = inject(AppTelemetryService);
    private userService = inject(UserService);

    /** Level <= 3 keeps capitalization; > 3 or null → lowercase */
    lowercaseMode = computed(() => {
        const level = this.userService.profile()?.learnLevel;
        return level === null || level === undefined || level > 3;
    });

    /** All raw texts from DB */
    allTexts = signal<TextItem[]>([]);
    /** Shuffled subset for current quiz run */
    texts = signal<TextItem[]>([]);
    currentIndex = signal(0);

    screen = signal<Screen>('welcome');

    /** Currently active category the user is tagging */
    activeTag = signal<WordTag | null>(null);

    /** Which categories are available (based on difficulty toggle) */
    enabledTags = signal<WordTag[]>(BASE_TAGS);
    advancedMode = signal(false);

    /** Parsed tokens of the current sentence */
    tokens = signal<DisplayToken[]>([]);

    /** Map: tokenIndex -> tag the user assigned */
    userTags = signal<Map<number, WordTag>>(new Map());

    checked = signal(false);

    totalCorrect = signal(0);
    totalWrong = signal(0);

    /** Available categories to show in the selector (filtered by enabledTags) */
    categories = computed(() =>
        ALL_CATEGORIES.filter(c => this.enabledTags().includes(c.tag))
    );

    progress = computed(() =>
        this.texts().length > 0 ? (this.currentIndex() / this.texts().length) * 100 : 0
    );

    percentage = computed(() => {
        const total = this.totalCorrect() + this.totalWrong();
        return total > 0 ? Math.round((this.totalCorrect() / total) * 100) : 0;
    });

    dataLoaded = computed(() => this.allTexts().length > 0);

    constructor() {
        this.loadData();
    }

    private loadData(): void {
        this.http.get<{ content: { id: number; data: any }[] }>('/api/apps?app_id=wortarten').pipe(
            map(res => res.content.map(row => ({
                text: typeof row.data === 'string' ? row.data : String(row.data),
                _contentId: row.id
            })))
        ).subscribe({
            next: (data) => this.allTexts.set(data),
            error: (err) => console.error('Error loading wortarten data:', err)
        });
    }

    // ─── Welcome ───

    toggleAdvanced(): void {
        this.advancedMode.update(v => !v);
        this.enabledTags.set(this.advancedMode() ? EXTENDED_TAGS : BASE_TAGS);
    }

    startQuiz(): void {
        this.texts.set(shuffle(this.allTexts()));
        this.currentIndex.set(0);
        this.totalCorrect.set(0);
        this.totalWrong.set(0);
        this.screen.set('quiz');
        this.renderText();
    }

    // ─── Parsing ───

    private parseText(raw: string): DisplayToken[] {
        // Pattern: [tag]word[/tag]  where tag ∈ {n, v, a, pr, pa, av}
        const regex = /\[(n|v|a|pr|pa|av)\](.*?)\[\/\1\]/g;
        const tokens: DisplayToken[] = [];
        let lastIndex = 0;
        let tokenIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(raw)) !== null) {
            // Plain text before this tag
            const before = raw.slice(lastIndex, match.index);
            if (before) {
                for (const word of this.splitWords(before)) {
                    tokens.push({ text: word.text, index: tokenIndex++, tag: null });
                }
            }

            // Tagged word
            tokens.push({
                text: match[2],
                index: tokenIndex++,
                tag: match[1] as WordTag
            });

            lastIndex = regex.lastIndex;
        }

        // Trailing text
        const tail = raw.slice(lastIndex);
        if (tail) {
            for (const word of this.splitWords(tail)) {
                tokens.push({ text: word.text, index: tokenIndex++, tag: null });
            }
        }

        return tokens;
    }

    /** Split a plain segment into individual word tokens (skip pure whitespace) */
    private splitWords(segment: string): { text: string }[] {
        return segment.split(/(\s+)/).filter(s => s.trim().length > 0).map(s => ({ text: s }));
    }

    private renderText(): void {
        const item = this.texts()[this.currentIndex()];
        if (!item) return;
        const parsed = this.parseText(item.text);
        if (this.lowercaseMode()) {
            for (const token of parsed) {
                token.text = token.text.toLowerCase();
            }
        }
        this.tokens.set(parsed);
        this.userTags.set(new Map());
        this.checked.set(false);
        this.activeTag.set(null);
        this.cdr.markForCheck();
    }

    // ─── Interaction ───

    selectCategory(tag: WordTag): void {
        if (this.checked()) return;
        this.activeTag.set(this.activeTag() === tag ? null : tag);
    }

    toggleWord(token: DisplayToken): void {
        if (this.checked() || !this.activeTag()) return;

        const map = new Map(this.userTags());
        if (map.get(token.index) === this.activeTag()) {
            map.delete(token.index);
        } else {
            map.set(token.index, this.activeTag()!);
        }
        this.userTags.set(map);
    }

    getTokenClass(token: DisplayToken): string {
        const userTag = this.userTags().get(token.index);
        const enabled = this.enabledTags();

        if (!this.checked()) {
            return userTag ? `tag-${userTag}` : '';
        }

        // After check
        const isRelevant = token.tag !== null && enabled.includes(token.tag);

        if (userTag && isRelevant && userTag === token.tag) {
            return `tag-${token.tag} token-correct`;
        }
        if (userTag && (!isRelevant || userTag !== token.tag)) {
            return `tag-${userTag} token-wrong`;
        }
        if (isRelevant && !userTag) {
            return `tag-${token.tag} token-missed`;
        }
        return '';
    }

    getTokenHint(token: DisplayToken): string | null {
        if (!this.checked()) return null;
        const cat = ALL_CATEGORIES.find(c => c.tag === token.tag);
        return cat ? cat.label : null;
    }

    // ─── Check / Advance ───

    checkText(): void {
        const enabled = this.enabledTags();
        const userMap = this.userTags();
        let correct = 0;
        let wrong = 0;

        for (const token of this.tokens()) {
            const isRelevant = token.tag !== null && enabled.includes(token.tag);
            const userTag = userMap.get(token.index);

            if (isRelevant) {
                if (userTag === token.tag) correct++;
                else wrong++;
            } else if (userTag) {
                wrong++;
            }
        }

        this.totalCorrect.update(c => c + correct);
        this.totalWrong.update(w => w + wrong);
        this.checked.set(true);

        const item = this.texts()[this.currentIndex()];
        if (item?._contentId) {
            this.telemetryService.trackProgress('wortarten', item._contentId, wrong === 0);
        }
    }

    nextText(): void {
        if (this.currentIndex() >= this.texts().length - 1) {
            this.screen.set('results');
            if (this.percentage() === 100) launchConfetti();
        } else {
            this.currentIndex.update(i => i + 1);
            this.renderText();
        }
    }

    restartQuiz(): void {
        this.screen.set('welcome');
    }

    getCategoryLabel(tag: WordTag): string {
        return ALL_CATEGORIES.find(c => c.tag === tag)?.label ?? tag;
    }
}
