import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../services/auth.service';
import { UserService, UserProfile } from '../services/user.service';

// Avatar configuration types
interface AvatarPart {
    name: string;
    options: string[];
}

interface AvatarConfig {
    skinTone: string;
    hairStyle: string;
    hairColor: string;
    eyes: string;
    eyebrows: string;
    mouth: string;
    accessories: string;
    facialHair: string;
    backgroundColor: string;
}

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [FormsModule],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit {
    private router = inject(Router);
    private sanitizer = inject(DomSanitizer);
    authService = inject(AuthService);
    userService = inject(UserService);

    // Form fields
    displayName = signal<string>('');
    saving = signal<boolean>(false);
    saveSuccess = signal<boolean>(false);
    saveError = signal<string | null>(null);

    // Avatar configuration
    avatarConfig = signal<AvatarConfig>({
        skinTone: '#ffdbb4',
        hairStyle: 'short',
        hairColor: '#4a3728',
        eyes: 'normal',
        eyebrows: 'normal',
        mouth: 'smile',
        accessories: 'none',
        facialHair: 'none',
        backgroundColor: '#6366f1'
    });

    // Avatar customization options
    readonly skinTones = ['#ffdbb4', '#edb98a', '#d08b5b', '#ae5d29', '#614335'];
    readonly hairStyles = ['short', 'medium', 'long', 'curly', 'bald', 'buzz', 'spiky'];
    readonly hairColors = ['#4a3728', '#2c1810', '#8b4513', '#d4a574', '#1a1a1a', '#8b0000', '#ffd700', '#c0c0c0'];
    readonly eyeStyles = ['normal', 'happy', 'wink', 'surprised', 'sleepy'];
    readonly eyebrowStyles = ['normal', 'raised', 'angry', 'sad', 'unibrow'];
    readonly mouthStyles = ['smile', 'serious', 'laugh', 'open', 'sad'];
    readonly accessoryOptions = ['none', 'glasses', 'sunglasses', 'earrings'];
    readonly facialHairOptions = ['none', 'stubble', 'beard', 'mustache', 'goatee'];
    readonly backgroundColors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#64748b'];

    // Current tab
    activeTab = signal<'profile' | 'avatar' | 'learning'>('profile');

    // Computed SVG avatar
    avatarSvg = computed(() => this.generateAvatarSvg(this.avatarConfig()));

    // Safe SVG for template
    avatarSvgSafe = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.avatarSvg()));

    // Safe Profile SVG
    profileAvatarSvgSafe = computed(() => {
        const svg = this.userService.profile()?.avatarSvg;
        return svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : null;
    });

    // User Properties
    skillLevel = signal<number | null>(null);
    learnLevel = signal<number | null>(null);
    optedOut = computed(() => this.skillLevel() === -1 || this.learnLevel() === -1);

    // Derived UI state for learn level
    schoolType = signal<string>('Primarschule');
    grade = signal<number>(1);

    readonly schoolTypes = ['Kindergarten', 'Primarschule', 'Sekundarschule', 'Gymnasium'];

    get gradesForType(): number[] {
        switch (this.schoolType()) {
            case 'Kindergarten': return [1, 2];
            case 'Primarschule': return [1, 2, 3, 4, 5, 6];
            case 'Sekundarschule': return [1, 2, 3];
            case 'Gymnasium': return [1, 2, 3, 4, 5, 6];
            default: return [];
        }
    }

    ngOnInit(): void {
        // Load existing profile
        const profile = this.userService.profile();
        if (profile) {
            this.displayName.set(profile.displayName || '');
            if (profile.avatarConfig) {
                this.avatarConfig.set(profile.avatarConfig);
            }

            // Load User Properties
            if (profile.skillLevel !== undefined && profile.skillLevel !== null) {
                this.skillLevel.set(profile.skillLevel);
            }
            if (profile.learnLevel !== undefined && profile.learnLevel !== null) {
                this.learnLevel.set(profile.learnLevel);
                this.reverseMapLearnLevel(profile.learnLevel, profile.skillLevel);
            }
        } else if (this.authService.user()) {
            this.displayName.set(this.authService.user()?.displayName || '');
        }
    }

    private reverseMapLearnLevel(level: number, skill: number | null | undefined): void {
        if (level === -1) return; // Opted out

        if (level <= 2) {
            this.schoolType.set('Kindergarten');
            this.grade.set(level);
        } else if (level <= 8) {
            this.schoolType.set('Primarschule');
            this.grade.set(level - 2);
        } else {
            // Level >= 9
            // Distinguish Sek vs Gym based on skill level heuristic or default
            // Sek: 0.3, Gym: 0.8
            const isGym = (skill ?? 0.5) > 0.6;
            this.schoolType.set(isGym ? 'Gymnasium' : 'Sekundarschule');
            this.grade.set(level - 8);
        }
    }

    updateSchoolType(type: string): void {
        this.schoolType.set(type);
        this.grade.set(1); // Reset grade
    }

    updateGrade(g: number): void {
        this.grade.set(g);
    }

    toggleOptOut(optOut: boolean): void {
        if (optOut) {
            this.skillLevel.set(-1);
            this.learnLevel.set(-1);
        } else {
            // Reset to defaults
            this.skillLevel.set(0.5);
            this.learnLevel.set(3); // Primar 1
            this.schoolType.set('Primarschule');
            this.grade.set(1);
        }
    }

    setTab(tab: 'profile' | 'avatar' | 'learning'): void {
        this.activeTab.set(tab);
    }

    updateAvatarPart(part: keyof AvatarConfig, value: string): void {
        this.avatarConfig.update(config => ({
            ...config,
            [part]: value
        }));
    }

    randomizeAvatar(): void {
        const randomPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

        this.avatarConfig.set({
            skinTone: randomPick(this.skinTones),
            hairStyle: randomPick(this.hairStyles),
            hairColor: randomPick(this.hairColors),
            eyes: randomPick(this.eyeStyles),
            eyebrows: randomPick(this.eyebrowStyles),
            mouth: randomPick(this.mouthStyles),
            accessories: randomPick(this.accessoryOptions),
            facialHair: randomPick(this.facialHairOptions),
            backgroundColor: randomPick(this.backgroundColors)
        });
    }

    async saveProfile(): Promise<void> {
        this.saving.set(true);
        this.saveSuccess.set(false);
        this.saveError.set(null);

        try {
            // Calculate final learn level
            let finalLearnLevel = this.learnLevel();
            let finalSkillLevel = this.skillLevel();

            if (!this.optedOut()) {
                const type = this.schoolType();
                const grade = this.grade();

                switch (type) {
                    case 'Kindergarten': finalLearnLevel = grade; break;
                    case 'Primarschule': finalLearnLevel = grade + 2; break;
                    case 'Sekundarschule': finalLearnLevel = grade + 8; break;
                    case 'Gymnasium': finalLearnLevel = grade + 8; break;
                }

                // Note: We are NOT auto-adjusting skill level here like in the modal
                // because the user might have manually set the slider in the settings.
                // We trust the slider value (this.skillLevel()) unless it was never touched?
                // Actually, let's trust the slider.
            }

            const uid = this.authService.user()?.uid;
            const success = await this.userService.updateProfile({
                displayName: this.displayName(),
                avatarConfig: this.avatarConfig(),
                avatarSvg: this.avatarSvg(),
                skillLevel: finalSkillLevel,
                learnLevel: finalLearnLevel
            }, uid);

            if (success) {
                this.saveSuccess.set(true);
                setTimeout(() => this.saveSuccess.set(false), 3000);
            } else {
                this.saveError.set('Fehler beim Speichern. Bitte versuche es erneut.');
            }
        } catch (error) {
            console.error(error);
            this.saveError.set('Ein unerwarteter Fehler ist aufgetreten.');
        } finally {
            this.saving.set(false);
        }
    }

    goBack(): void {
        this.router.navigate(['/']);
    }

    private generateAvatarSvg(config: AvatarConfig): string {
        const { skinTone, hairStyle, hairColor, eyes, eyebrows, mouth, accessories, facialHair, backgroundColor } = config;

        // Hair path based on style
        const hairPaths: Record<string, string> = {
            short: `<path d="M25 25 Q50 5 75 25 Q80 35 75 45 L75 40 Q50 20 25 40 L25 45 Q20 35 25 25" fill="${hairColor}"/>`,
            medium: `<path d="M20 30 Q50 0 80 30 Q85 50 80 70 L75 50 Q50 25 25 50 L20 70 Q15 50 20 30" fill="${hairColor}"/>`,
            long: `<path d="M15 35 Q50 -5 85 35 Q90 60 85 90 L75 55 Q50 20 25 55 L15 90 Q10 60 15 35" fill="${hairColor}"/>`,
            curly: `<path d="M20 30 Q30 10 50 15 Q70 10 80 30 Q90 45 85 60 Q80 40 70 35 Q60 30 50 32 Q40 30 30 35 Q20 40 15 60 Q10 45 20 30" fill="${hairColor}"/><circle cx="25" cy="35" r="8" fill="${hairColor}"/><circle cx="75" cy="35" r="8" fill="${hairColor}"/><circle cx="50" cy="20" r="8" fill="${hairColor}"/>`,
            bald: '',
            buzz: `<path d="M28 32 Q50 18 72 32 Q75 38 72 42 L72 38 Q50 28 28 38 L28 42 Q25 38 28 32" fill="${hairColor}" opacity="0.7"/>`,
            spiky: `<path d="M30 35 L25 15 L35 30 L40 5 L45 28 L50 8 L55 28 L60 5 L65 30 L75 15 L70 35 Q50 25 30 35" fill="${hairColor}"/>`
        };

        // Eye variations
        const eyePaths: Record<string, string> = {
            normal: `<circle cx="38" cy="50" r="4" fill="#1a1a1a"/><circle cx="62" cy="50" r="4" fill="#1a1a1a"/><circle cx="39" cy="49" r="1.5" fill="white"/><circle cx="63" cy="49" r="1.5" fill="white"/>`,
            happy: `<path d="M34 50 Q38 54 42 50" stroke="#1a1a1a" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M58 50 Q62 54 66 50" stroke="#1a1a1a" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
            wink: `<circle cx="38" cy="50" r="4" fill="#1a1a1a"/><circle cx="39" cy="49" r="1.5" fill="white"/><path d="M58 50 Q62 54 66 50" stroke="#1a1a1a" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
            surprised: `<circle cx="38" cy="50" r="5" fill="#1a1a1a"/><circle cx="62" cy="50" r="5" fill="#1a1a1a"/><circle cx="38" cy="50" r="2" fill="white"/><circle cx="62" cy="50" r="2" fill="white"/>`,
            sleepy: `<path d="M34 50 Q38 48 42 50" stroke="#1a1a1a" stroke-width="2" fill="none"/><path d="M58 50 Q62 48 66 50" stroke="#1a1a1a" stroke-width="2" fill="none"/>`
        };

        // Eyebrow variations
        const eyebrowPaths: Record<string, string> = {
            normal: `<path d="M33 42 Q38 40 43 42" stroke="#4a3728" stroke-width="2" fill="none"/><path d="M57 42 Q62 40 67 42" stroke="#4a3728" stroke-width="2" fill="none"/>`,
            raised: `<path d="M33 38 Q38 36 43 40" stroke="#4a3728" stroke-width="2" fill="none"/><path d="M57 40 Q62 36 67 38" stroke="#4a3728" stroke-width="2" fill="none"/>`,
            angry: `<path d="M33 42 Q38 38 43 40" stroke="#4a3728" stroke-width="2" fill="none"/><path d="M57 40 Q62 38 67 42" stroke="#4a3728" stroke-width="2" fill="none"/>`,
            sad: `<path d="M33 40 Q38 42 43 42" stroke="#4a3728" stroke-width="2" fill="none"/><path d="M57 42 Q62 42 67 40" stroke="#4a3728" stroke-width="2" fill="none"/>`,
            unibrow: `<path d="M33 42 Q50 36 67 42" stroke="#4a3728" stroke-width="2.5" fill="none"/>`
        };

        // Mouth variations
        const mouthPaths: Record<string, string> = {
            smile: `<path d="M40 68 Q50 76 60 68" stroke="#c44" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
            serious: `<line x1="42" y1="70" x2="58" y2="70" stroke="#c44" stroke-width="2.5" stroke-linecap="round"/>`,
            laugh: `<path d="M38 66 Q50 80 62 66" fill="#1a1a1a"/><path d="M42 72 Q50 76 58 72" fill="#c44"/>`,
            open: `<ellipse cx="50" cy="70" rx="6" ry="4" fill="#1a1a1a"/>`,
            sad: `<path d="M40 72 Q50 66 60 72" stroke="#c44" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
        };

        // Accessories
        const accessoryPaths: Record<string, string> = {
            none: '',
            glasses: `<circle cx="38" cy="50" r="10" stroke="#333" stroke-width="2" fill="none"/><circle cx="62" cy="50" r="10" stroke="#333" stroke-width="2" fill="none"/><line x1="48" y1="50" x2="52" y2="50" stroke="#333" stroke-width="2"/><line x1="28" y1="50" x2="22" y2="48" stroke="#333" stroke-width="2"/><line x1="72" y1="50" x2="78" y2="48" stroke="#333" stroke-width="2"/>`,
            sunglasses: `<path d="M28 45 L48 45 L48 56 Q38 60 28 56 Z" fill="#1a1a1a"/><path d="M52 45 L72 45 L72 56 Q62 60 52 56 Z" fill="#1a1a1a"/><line x1="48" y1="50" x2="52" y2="50" stroke="#333" stroke-width="2"/><line x1="28" y1="48" x2="22" y2="46" stroke="#333" stroke-width="2"/><line x1="72" y1="48" x2="78" y2="46" stroke="#333" stroke-width="2"/>`,
            earrings: `<circle cx="22" cy="58" r="3" fill="#ffd700"/><circle cx="78" cy="58" r="3" fill="#ffd700"/>`
        };

        // Facial hair
        const facialHairPaths: Record<string, string> = {
            none: '',
            stubble: `<g fill="${hairColor}" opacity="0.4"><circle cx="35" cy="72" r="1"/><circle cx="40" cy="75" r="1"/><circle cx="45" cy="73" r="1"/><circle cx="50" cy="76" r="1"/><circle cx="55" cy="73" r="1"/><circle cx="60" cy="75" r="1"/><circle cx="65" cy="72" r="1"/></g>`,
            beard: `<path d="M30 65 Q30 85 50 90 Q70 85 70 65 Q60 70 50 68 Q40 70 30 65" fill="${hairColor}" opacity="0.9"/>`,
            mustache: `<path d="M38 65 Q43 62 50 65 Q57 62 62 65 Q57 70 50 68 Q43 70 38 65" fill="${hairColor}"/>`,
            goatee: `<path d="M44 72 Q50 70 56 72 Q56 82 50 85 Q44 82 44 72" fill="${hairColor}" opacity="0.9"/>`
        };

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
            <!-- Background -->
            <circle cx="50" cy="50" r="50" fill="${backgroundColor}"/>
            
            <!-- Face -->
            <ellipse cx="50" cy="55" rx="28" ry="32" fill="${skinTone}"/>
            
            <!-- Ears -->
            <ellipse cx="22" cy="55" rx="5" ry="7" fill="${skinTone}"/>
            <ellipse cx="78" cy="55" rx="5" ry="7" fill="${skinTone}"/>
            
            <!-- Hair (behind face for some styles) -->
            ${hairPaths[hairStyle] || ''}
            
            <!-- Eyebrows -->
            ${eyebrowPaths[eyebrows] || eyebrowPaths['normal']}
            
            <!-- Eyes -->
            ${eyePaths[eyes] || eyePaths['normal']}
            
            <!-- Nose -->
            <path d="M48 55 Q50 62 52 55" stroke="${skinTone}" stroke-width="2" fill="none" filter="brightness(0.85)"/>
            
            <!-- Mouth -->
            ${mouthPaths[mouth] || mouthPaths['smile']}
            
            <!-- Facial Hair -->
            ${facialHairPaths[facialHair] || ''}
            
            <!-- Accessories -->
            ${accessoryPaths[accessories] || ''}
        </svg>`;
    }

    getAvatarDataUrl(): string {
        return 'data:image/svg+xml;base64,' + btoa(this.avatarSvg());
    }
}
