export {
  createCoreContext,
  CoreContextError,
  type AppTier,
  type CoreConfig,
  type CoreContext,
} from "./context.js";

export type {
  AuthPort,
  AuthUser,
  ClockOverride,
  ClockPort,
  EmailMessage,
  EmailPort,
  StripePort,
} from "./ports.js";

export {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "./errors.js";

export {
  ANONYMOUS,
  SELF_ASSIGNABLE_ROLES,
  belongsToVendor,
  hasRole,
  isAdmin,
  isAuthenticated,
  isUsable,
  type Actor,
  type RoleName,
  type UserStatus,
} from "./identity/actor.js";

export {
  endVendorStaffSessions,
  getActor,
  grantRole,
  markEmailVerified,
  parseSelfAssignableRole,
  reinstateUser,
  requireAdmin,
  requireRole,
  requireUser,
  revokeRole,
  signUp,
  suspendUser,
  type SignUpInput,
} from "./identity/service.js";

export {
  assertCanActOnOrder,
  assertCanActOnUser,
  assertCanActOnVendor,
  assertCanReadEvent,
  assertCanReadOrder,
  assertCanReadUser,
  assertCanReadVendorPrivately,
  type EventRef,
  type OrderParties,
  type UserRef,
  type VendorRef,
} from "./identity/policies.js";

export { safeRedirectPath } from "./identity/safe-redirect.js";

export {
  LOGIN_RULE,
  PASSWORD_RESET_RULE,
  clearAttempts,
  consumeAttempt,
  type RateLimitRule,
} from "./identity/rate-limit.js";

export {
  acceptAdminInvite,
  inviteAdmin,
  revokeAdminInvite,
  type AdminInvite,
} from "./identity/invites.js";

export { record as recordAudit, type AuditEntry } from "./audit/service.js";

// `createTestCoreContext` is intentionally absent: it lives at
// `@occasion/core/testing` so that pulling fakes into application code is a
// visible import rather than an autocomplete away.
