import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';


type AuthMode = 'login' | 'register';

@Component({
    selector: 'app-auth-modal',
    standalone: true,
    imports: [FormsModule],
    template: `
        @if (visible()) {
        <div class="auth-overlay" (click)="close()">
            <div class="auth-modal" (click)="$event.stopPropagation()">
                <button class="close-btn" (click)="close()">✕</button>
                
                <h2>{{ mode() === 'login' ? 'Anmelden' : 'Registrieren' }}</h2>
                
                <!-- Google Sign In -->
                <button class="google-btn" (click)="signInWithGoogle()" [disabled]="authService.loading()">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Mit Google anmelden
                </button>

                <div class="divider">
                    <span>oder</span>
                </div>

                <!-- Email/Password Form -->
                <form (ngSubmit)="submitForm()">
                    <div class="form-group">
                        <input 
                            type="email" 
                            [(ngModel)]="email" 
                            name="email"
                            placeholder="E-Mail-Adresse"
                            required
                            [disabled]="authService.loading()">
                    </div>
                    <div class="form-group">
                        <input 
                            type="password" 
                            [(ngModel)]="password" 
                            name="password"
                            placeholder="Passwort"
                            required
                            minlength="6"
                            [disabled]="authService.loading()">
                    </div>

                    @if (authService.error()) {
                    <div class="error-message">{{ authService.error() }}</div>
                    }

                    <button type="submit" class="submit-btn" [disabled]="authService.loading()">
                        {{ mode() === 'login' ? 'Anmelden' : 'Konto erstellen' }}
                    </button>
                </form>

                <p class="toggle-mode">
                    @if (mode() === 'login') {
                        Noch kein Konto? 
                        <button (click)="toggleMode()">Registrieren</button>
                    } @else {
                        Bereits registriert? 
                        <button (click)="toggleMode()">Anmelden</button>
                    }
                </p>
            </div>
        </div>
        }
    `,
    styles: [`
        .auth-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            animation: fadeIn 0.2s ease;
        }

        .auth-modal {
            background: #1a1a2e;
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 32px;
            width: 90%;
            max-width: 400px;
            position: relative;
            animation: slideUp 0.3s ease;
        }

        .close-btn {
            position: absolute;
            top: 16px;
            right: 16px;
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 1.2rem;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }

        .close-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text-primary);
        }

        h2 {
            text-align: center;
            margin-bottom: 24px;
            background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .google-btn {
            width: 100%;
            padding: 14px 20px;
            border-radius: 12px;
            border: 1px solid var(--border-color);
            background: var(--bg-card);
            color: var(--text-primary);
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            transition: all 0.2s;
            font-family: inherit;
        }

        .google-btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.1);
            transform: translateY(-2px);
        }

        .google-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .divider {
            display: flex;
            align-items: center;
            margin: 24px 0;
            color: var(--text-muted);
            font-size: 0.9rem;
        }

        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--border-color);
        }

        .divider span {
            padding: 0 16px;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-group input {
            width: 100%;
            padding: 14px 16px;
            border-radius: 12px;
            border: 1px solid var(--border-color);
            background: var(--bg-card);
            color: var(--text-primary);
            font-size: 1rem;
            font-family: inherit;
            transition: all 0.2s;
            box-sizing: border-box;
        }

        .form-group input:focus {
            outline: none;
            border-color: var(--accent-1);
        }

        .form-group input:disabled {
            opacity: 0.5;
        }

        .error-message {
            background: rgba(239, 68, 68, 0.15);
            color: var(--error);
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 0.9rem;
        }

        .submit-btn {
            width: 100%;
            padding: 14px 20px;
            border-radius: 12px;
            border: none;
            background: linear-gradient(135deg, var(--accent-1), var(--accent-2));
            color: white;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }

        .submit-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4);
        }

        .submit-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toggle-mode {
            text-align: center;
            margin-top: 20px;
            color: var(--text-secondary);
            font-size: 0.9rem;
        }

        .toggle-mode button {
            background: none;
            border: none;
            color: var(--accent-1);
            cursor: pointer;
            font-size: inherit;
            font-family: inherit;
            text-decoration: underline;
        }

        .toggle-mode button:hover {
            color: var(--accent-2);
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    `]
})
export class AuthModalComponent {
    authService = inject(AuthService);

    visible = signal(false);
    mode = signal<AuthMode>('login');

    email = '';
    password = '';

    open(authMode: AuthMode = 'login'): void {
        this.mode.set(authMode);
        this.visible.set(true);
        this.authService.clearError();
        this.email = '';
        this.password = '';
    }

    close(): void {
        this.visible.set(false);
        this.authService.clearError();
    }

    toggleMode(): void {
        this.mode.set(this.mode() === 'login' ? 'register' : 'login');
        this.authService.clearError();
    }

    async signInWithGoogle(): Promise<void> {
        const result = await this.authService.signInWithGoogle();
        if (result) {
            this.close();
        }
    }

    async submitForm(): Promise<void> {
        if (!this.email || !this.password) return;

        let result;
        if (this.mode() === 'login') {
            result = await this.authService.signInWithEmail(this.email, this.password);
        } else {
            result = await this.authService.createAccount(this.email, this.password);
        }

        if (result) {
            this.close();
        }
    }
}
