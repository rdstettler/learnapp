import { Injectable } from '@angular/core';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

@Injectable({
    providedIn: 'root'
})
export class OnboardingService {
    private readonly STORAGE_KEY = 'has_seen_onboarding_v1';

    constructor() { }

    public startTour() {
        if (this.hasSeenOnboarding()) {
            return;
        }

        const driverObj = driver({
            showProgress: true,
            animate: true,
            allowClose: true,
            doneBtnText: 'Fertig',
            nextBtnText: 'Weiter',
            prevBtnText: 'Zurück',
            steps: [
                {
                    element: '#auth-btn',
                    popover: {
                        title: 'Anmelden',
                        description: 'Melde dich an, um deinen Fortschritt zu speichern und coole Features freizuschalten. Du kannst die App aber auch ohne Account nutzen!',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#category-filters',
                    popover: {
                        title: 'Kategorien',
                        description: 'Hier kannst du die Apps nach Kategorien filtern, um schneller zu finden, was du suchst.',
                        side: 'bottom',
                        align: 'start'
                    }
                },
                {
                    element: '#settings-btn',
                    popover: {
                        title: 'Einstellungen',
                        description: 'Hier kannst du dein Profil anpassen und weitere Einstellungen vornehmen.',
                        side: 'bottom',
                        align: 'start'
                    }
                }
            ],
            onDestroyStarted: () => {
                this.markAsSeen();
                driverObj.destroy();
            }
        });

        driverObj.drive();
    }

    private hasSeenOnboarding(): boolean {
        return localStorage.getItem(this.STORAGE_KEY) === 'true';
    }

    private markAsSeen() {
        localStorage.setItem(this.STORAGE_KEY, 'true');
    }
}
