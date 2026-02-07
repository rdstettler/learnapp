import { Injectable, inject, signal, computed } from '@angular/core';
import {
    Auth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    GoogleAuthProvider,
    onAuthStateChanged,
    User,
    UserCredential
} from '@angular/fire/auth';
import { FirebaseError } from '@angular/fire/app';
import { Subject } from 'rxjs';

export interface AuthUser {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    provider: 'google' | 'email' | 'anonymous';
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private auth = inject(Auth);
    private googleProvider = new GoogleAuthProvider();

    // Auth state signals
    private _user = signal<AuthUser | null>(null);
    private _loading = signal<boolean>(true);
    private _error = signal<string | null>(null);

    // Event emitter for when user logs in
    private _onUserLogin = new Subject<AuthUser>();
    readonly onUserLogin$ = this._onUserLogin.asObservable();

    // Public readonly signals
    readonly user = this._user.asReadonly();
    readonly loading = this._loading.asReadonly();
    readonly error = this._error.asReadonly();
    readonly isAuthenticated = computed(() => this._user() !== null);

    constructor() {
        // Listen to auth state changes
        onAuthStateChanged(this.auth, (firebaseUser) => {
            if (firebaseUser) {
                const authUser = this.mapFirebaseUser(firebaseUser);
                this._user.set(authUser);
                // Emit login event for database sync
                this._onUserLogin.next(authUser);
            } else {
                this._user.set(null);
            }
            this._loading.set(false);
        });
    }


    private mapFirebaseUser(user: User): AuthUser {
        const providerId = user.providerData[0]?.providerId || 'email';
        return {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            provider: providerId === 'google.com' ? 'google' : 'email'
        };
    }

    // Sign in with Google
    async signInWithGoogle(): Promise<UserCredential | null> {
        this._error.set(null);
        this._loading.set(true);
        try {
            const result = await signInWithPopup(this.auth, this.googleProvider);
            return result;
        } catch (error: unknown) {
            this._error.set(this.getErrorMessage(error instanceof FirebaseError ? error.code : 'unknown'));
            return null;
        } finally {
            this._loading.set(false);
        }
    }

    // Sign in with email/password
    async signInWithEmail(email: string, password: string): Promise<UserCredential | null> {
        this._error.set(null);
        this._loading.set(true);
        try {
            const result = await signInWithEmailAndPassword(this.auth, email, password);
            return result;
        } catch (error: unknown) {
            this._error.set(this.getErrorMessage(error instanceof FirebaseError ? error.code : 'unknown'));
            return null;
        } finally {
            this._loading.set(false);
        }
    }

    // Create account with email/password
    async createAccount(email: string, password: string): Promise<UserCredential | null> {
        this._error.set(null);
        this._loading.set(true);
        try {
            const result = await createUserWithEmailAndPassword(this.auth, email, password);
            return result;
        } catch (error: unknown) {
            this._error.set(this.getErrorMessage(error instanceof FirebaseError ? error.code : 'unknown'));
            return null;
        } finally {
            this._loading.set(false);
        }
    }

    // Sign out
    async signOut(): Promise<void> {
        this._error.set(null);
        try {
            await signOut(this.auth);
        } catch (error: unknown) {
            this._error.set(this.getErrorMessage(error instanceof FirebaseError ? error.code : 'unknown'));
        }
    }

    // Clear error
    clearError(): void {
        this._error.set(null);
    }

    // Map Firebase error codes to user-friendly messages
    private getErrorMessage(code: string): string {
        const errorMessages: Record<string, string> = {
            'auth/email-already-in-use': 'Diese E-Mail-Adresse wird bereits verwendet.',
            'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
            'auth/operation-not-allowed': 'Diese Anmeldemethode ist nicht aktiviert.',
            'auth/weak-password': 'Das Passwort ist zu schwach (mindestens 6 Zeichen).',
            'auth/user-disabled': 'Dieses Konto wurde deaktiviert.',
            'auth/user-not-found': 'Kein Konto mit dieser E-Mail gefunden.',
            'auth/wrong-password': 'Falsches Passwort.',
            'auth/invalid-credential': 'Ungültige Anmeldedaten.',
            'auth/popup-closed-by-user': 'Anmeldung abgebrochen.',
            'auth/network-request-failed': 'Netzwerkfehler. Bitte Verbindung prüfen.'
        };
        return errorMessages[code] || `Anmeldefehler: ${code}`;
    }
}
