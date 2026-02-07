import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { from, switchMap, catchError, of } from 'rxjs';

/**
 * HTTP interceptor that attaches the Firebase ID token as a Bearer token
 * to all outgoing API requests. Public endpoints simply ignore the header.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    // Only attach tokens to our own API calls
    if (!req.url.startsWith('/api')) {
        return next(req);
    }

    const auth = inject(Auth);
    const currentUser = auth.currentUser;

    if (!currentUser) {
        return next(req);
    }

    return from(currentUser.getIdToken()).pipe(
        switchMap((token) => {
            const cloned = req.clone({
                setHeaders: {
                    Authorization: `Bearer ${token}`,
                },
            });
            return next(cloned);
        }),
        catchError(() => {
            // If token fetch fails, proceed without auth header
            return next(req);
        })
    );
};
