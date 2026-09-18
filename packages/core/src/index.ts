export {
  createCoreContext,
  CoreContextError,
  type AppTier,
  type CoreConfig,
  type CoreContext,
  type DbExecutor,
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
  ROLE_NAMES,
  SELF_ASSIGNABLE_ROLES,
  belongsToVendor,
  hasRole,
  isAdmin,
  isAuthenticated,
  isUsable,
  parseRoleName,
  selectActiveRole,
  type Actor,
  type RoleName,
  type UserStatus,
} from "./identity/actor.js";

export {
  clearSecondFactor,
  endVendorStaffSessions,
  findUserIdByEmail,
  getActor,
  markEmailVerified,
  parseSelfAssignableRole,
  requireAdmin,
  requireRole,
  requireUser,
  setSecondFactorEnrolled,
  signUp,
  type SignUpInput,
} from "./identity/service.js";

// `grantRole`, `revokeRole`, `suspendUser` and `reinstateUser` are deliberately
// absent. They are the unguarded originals: no self-action policy, no check
// that the role is one an administrator may move, and no typed confirmation for
// an admin grant. `identity/admin-service.ts` is the way in, and keeping the
// other pair off the barrel is what stops a future screen autocompleting past
// every rule this phase added.

export {
  actionFor,
  approveUser,
  getUserDetail,
  grantRoleToUser,
  listUsersForAdmin,
  reinstateAccount,
  resendVerification,
  revokeRoleFromUser,
  suspendAccount,
  type AdminUserList,
  type AdminUserListItem,
  type UserAction,
  type UserDetail,
} from "./identity/admin-service.js";

export type { UserFilter } from "./identity/admin-repo.js";

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
  SECOND_FACTOR_RULE,
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

export {
  VENDOR_STATUSES,
  canTransition,
  parseVendorStatus,
  payoutAllowed,
  publiclyListable,
  reasonRequiredOnEntering,
  type VendorStatus,
} from "./vendors/transitions.js";

export {
  approveVendor,
  assertVendorMayBePaid,
  blockVendor,
  getVendorDetail,
  listVendorsForAdmin,
  markUnderReview,
  reinstateVendor,
  suspendVendor,
  type AdminVendorList,
  type AdminVendorRow,
  type OnboardingStep,
  type StatusChange,
  type VendorDetail,
  type VendorFilter,
} from "./vendors/service.js";

export {
  getPublicService,
  listPublicServices,
  type PublicService,
} from "./catalog/service.js";

export { record as recordAudit, type AuditEntry } from "./audit/service.js";

// `createTestCoreContext` is intentionally absent: it lives at
// `@occasion/core/testing` so that pulling fakes into application code is a
// visible import rather than an autocomplete away.
