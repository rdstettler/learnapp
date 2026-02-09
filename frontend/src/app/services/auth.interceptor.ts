import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { from, switchMap, catchError } from 'rxjs';

/**
 * HTTP interceptor that attaches the Firebase ID token as a Bearer token
 * to all outgoing API requests. Public endpoints simply ignore the header.
 *
 * Uses authStateReady() to wait for Firebase Auth to finish initializing
 * before checking currentUser, preventing 401s on early requests.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    // Only attach tokens to our own API calls
    if (!req.url.startsWith('/api')) {
        return next(req);
    }

    const auth = inject(Auth);

    // Wait for Firebase Auth to finish initializing before reading currentUser
    return from(auth.authStateReady()).pipe(
        switchMap(() => {
            const currentUser = auth.currentUser;
            if (!currentUser) {
                return next(req);
            }

            // Resolve token first, then send the request.
            // catchError only wraps getIdToken() so that HTTP errors
            // (400, 404, etc.) propagate normally instead of being
            // swallowed and retried without the auth header.
            return from(currentUser.getIdToken()).pipe(
                catchError(() => {
                    // Token fetch failed — return null so we skip the header
                    return from([null as string | null]);
                }),
                switchMap((token) => {
                    if (!token) {
                        return next(req);
                    }
                    const cloned = req.clone({
                        setHeaders: {
                            Authorization: `Bearer ${token}`,
                        },
                    });
                    return next(cloned);
                })
            );
        })
    );
};
