/**
 * @antigravity/shared — public API
 *
 * This barrel export is consumed by federated remotes AND the host shell.
 * Everything exported here is configured as a singleton shared dependency
 * in the Native Federation config so that there is exactly one instance
 * of each service/component at runtime.
 *
 * Path: libs/shared/src/index.ts
 * Re-exports from: frontend/src/app/shared/ and frontend/src/app/services/
 */

// ── Components ──────────────────────────────────────────────
export { LearningAppLayoutComponent } from '../../../frontend/src/app/shared/components/learning-app-layout/learning-app-layout.component';
export { ErrorReporterComponent } from '../../../frontend/src/app/shared/components/error-reporter/error-reporter.component';
export { AppCardComponent } from '../../../frontend/src/app/shared/components/app-card/app-card.component';
export type { AppInfo, AppMetrics as AppCardMetrics } from '../../../frontend/src/app/shared/components/app-card/app-card.component';
export { AuthModalComponent } from '../../../frontend/src/app/shared/components/auth-modal/auth-modal.component';
export { ToastContainerComponent } from '../../../frontend/src/app/shared/components/toast-container/toast-container.component';
export { BadgeNotificationComponent } from '../../../frontend/src/app/shared/components/badge-notification/badge-notification.component';
export { BadgeShowcaseComponent } from '../../../frontend/src/app/shared/components/badge-showcase/badge-showcase.component';

// ── Services ────────────────────────────────────────────────
export { DataService } from '../../../frontend/src/app/services/data.service';
export { AppTelemetryService } from '../../../frontend/src/app/services/app-telemetry.service';
export { UserService } from '../../../frontend/src/app/services/user.service';
export type { UserProfile, UserMetrics, AvatarConfig } from '../../../frontend/src/app/services/user.service';
export { AuthService } from '../../../frontend/src/app/services/auth.service';
export type { AuthUser } from '../../../frontend/src/app/services/auth.service';
export { ApiService } from '../../../frontend/src/app/services/api.service';
export type { LearnResult } from '../../../frontend/src/app/services/api.service';
export { NotificationService } from '../../../frontend/src/app/services/notification.service';
export type { ToastMessage } from '../../../frontend/src/app/services/notification.service';
export { BadgeService } from '../../../frontend/src/app/services/badge.service';
export type { BadgeInfo, NewBadge } from '../../../frontend/src/app/services/badge.service';
export { StreakService } from '../../../frontend/src/app/services/streak.service';
export type { StreakData } from '../../../frontend/src/app/services/streak.service';
export { ThemeService } from '../../../frontend/src/app/services/theme.service';
export type { ThemeConfig } from '../../../frontend/src/app/services/theme.service';
export { OnboardingService } from '../../../frontend/src/app/services/onboarding.service';
export { GlobalErrorHandler } from '../../../frontend/src/app/services/global-error-handler';
export { authInterceptor } from '../../../frontend/src/app/services/auth.interceptor';
export { authGuard } from '../../../frontend/src/app/services/auth.guard';

// ── Utilities ───────────────────────────────────────────────
export { launchConfetti } from '../../../frontend/src/app/shared/confetti';
export { shuffle } from '../../../frontend/src/app/shared/utils/array.utils';
export { normalizeGermanText } from '../../../frontend/src/app/shared/utils/text.utils';

// ── Pipes ───────────────────────────────────────────────────
export { MarkdownPipe } from '../../../frontend/src/app/shared/pipes/markdown.pipe';

// ── Models ──────────────────────────────────────────────────
export type {
    LearningSession,
    SessionTask,
    TheoryCard,
    SuggestedApp,
    NotEnoughDataResponse,
    LearningPlan,
    PlanDay,
    PlanTask,
    PlanNotEnoughDataResponse
} from '../../../frontend/src/app/shared/models/learning-session.model';

// ── Contracts (shell ↔ remote) ──────────────────────────────
// export type { FederatedAppManifest, FederatedRemoteEntry } from './lib/contracts/federation.contracts';
