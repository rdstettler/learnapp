import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (auth.isAuthenticated()) {
        return true;
    }

    // Still loading — wait for auth to resolve
    if (auth.loading()) {
        return new Promise<boolean>((resolve) => {
            const interval = setInterval(() => {
                if (!auth.loading()) {
                    clearInterval(interval);
                    if (auth.isAuthenticated()) {
                        resolve(true);
                    } else {
                        router.navigate(['/']);
                        resolve(false);
                    }
                }
            }, 50);
        });
    }

    router.navigate(['/']);
    return false;
};
