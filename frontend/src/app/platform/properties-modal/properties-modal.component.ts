import { Component, inject, signal, output } from '@angular/core';
import { UserService } from '../../services/user.service';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-properties-modal',
    standalone: true,
    templateUrl: './properties-modal.component.html',
    styleUrl: './properties-modal.component.css'
})
export class PropertiesModalComponent {
    private userService = inject(UserService);
    private authService = inject(AuthService);

    /** Emitted when the modal should close */
    closed = output<void>();

    step = signal<1 | 2 | 3 | 4 | 5 | 6>(1);

    // Form values
    tempDisplayName = signal<string>('');
    tempLanguage = signal<'swiss' | 'standard'>('swiss');
    tempSkillLevel = signal<number>(0.5);
    tempSchoolType = signal<string | null>(null);
    tempLearnLevel = signal<number | null>(null);

    // School types for step 4
    readonly schoolTypes = ['Kindergarten', 'Primarschule', 'Sekundarschule', 'Gymnasium'];

    // Grades based on school type
    get gradesForType(): number[] {
        const type = this.tempSchoolType();
        switch (type) {
            case 'Kindergarten': return [1, 2];
            case 'Primarschule': return [1, 2, 3, 4, 5, 6];
            case 'Sekundarschule': return [1, 2, 3];
            case 'Gymnasium': return [1, 2, 3, 4, 5, 6];
            default: return [];
        }
    }

    /** Initialize with the current display name */
    initWithName(name: string): void {
        this.tempDisplayName.set(name);
    }

    refuseProperties(): void {
        const uid = this.authService.user()?.uid;
        if (uid) {
            this.userService.updateProfile({ skillLevel: -1, learnLevel: -1 }, uid);
        }
        this.closed.emit();
    }

    nextStep(): void {
        this.step.update(s => (s < 6 ? s + 1 : s) as 1 | 2 | 3 | 4 | 5 | 6);
    }

    updateName(event: Event): void {
        const val = (event.target as HTMLInputElement).value;
        this.tempDisplayName.set(val);
    }

    saveNameAndNext(): void {
        const name = this.tempDisplayName();
        if (name && name.trim() !== '') {
            const uid = this.authService.user()?.uid;
            if (uid) {
                this.userService.updateProfile({ displayName: name }, uid);
            }
        }
        this.nextStep();
    }

    selectLanguage(lang: 'swiss' | 'standard'): void {
        this.tempLanguage.set(lang);
        this.nextStep();
    }

    setSkillLevel(event: Event): void {
        const val = (event.target as HTMLInputElement).value;
        this.tempSkillLevel.set(parseFloat(val));
    }

    selectSchoolType(type: string): void {
        this.tempSchoolType.set(type);
        this.nextStep();
    }

    selectGrade(grade: number): void {
        this.tempLearnLevel.set(grade);
        this.saveProperties();
    }

    saveProperties(): void {
        const type = this.tempSchoolType();
        let grade = this.tempLearnLevel() || 1;
        let skill = this.tempSkillLevel();
        const language = this.tempLanguage();

        let finalLearnLevel = 0;

        switch (type) {
            case 'Kindergarten':
                finalLearnLevel = grade; // 1-2
                break;
            case 'Primarschule':
                finalLearnLevel = grade + 2; // 1->3, 6->8
                break;
            case 'Sekundarschule':
                finalLearnLevel = grade + 8; // 1->9
                if (skill === 0.5) skill = 0.3;
                break;
            case 'Gymnasium':
                finalLearnLevel = grade + 8; // 1->9
                if (skill === 0.5) skill = 0.8;
                break;
        }

        const uid = this.authService.user()?.uid;
        if (uid) {
            this.userService.updateProfile({
                skillLevel: skill,
                learnLevel: finalLearnLevel,
                languageVariant: language
            }, uid);
        }
        this.nextStep();
    }

    close(): void {
        this.closed.emit();
    }

    getDisplayName(): string {
        const profile = this.userService.profile();
        if (profile?.displayName) {
            return profile.displayName;
        }
        return this.authService.user()?.displayName || this.authService.user()?.email || '';
    }
}
