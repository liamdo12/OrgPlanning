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
  ClockPort,
  EmailMessage,
  EmailPort,
  PaymentIntentStatus,
  ProviderAccount,
  ProviderEvent,
  ProviderPaymentIntent,
  ProviderRefund,
  ProviderTransfer,
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
  assertCanPayOrder,
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

export { getPublicService, listPublicServices, type PublicService } from "./catalog/service.js";

export {
  ORDER_STATES,
  canTransition as canTransitionOrder,
  capacityIn,
  isTerminal,
  jobsOnEntering,
  parseOrderState,
  payoutAllowed as orderPayoutAllowed,
  releasesCapacity,
  type CapacityEffect,
  type OrderState,
  type ScheduledJob,
  type ScheduledJobType,
} from "./ordering/transitions.js";

export {
  DEFAULT_TIMEZONE,
  eventEndInstant,
  eventStartInstant,
  shiftCalendarDays,
} from "./ordering/schedule.js";

export {
  DEFAULT_ORDERING_POLICY,
  applyTransition,
  autoComplete,
  cancelOrder,
  createCheckout,
  getOrder,
  markFulfilled,
  raiseIssue,
  resolveIssue,
  type CheckoutLine,
  type CheckoutRequest,
  type CheckoutResult,
  type OrderChange,
  type OrderDetail,
  type OrderingPolicy,
} from "./ordering/service.js";

export {
  allocate,
  applyBps,
  computeOrderMoney,
  formatMoney,
  sliceOrderMoney,
  type MoneySlice,
  type OrderMoney,
} from "./payments/money.js";

export {
  paymentLabel,
  type PaymentLabel,
  type PaymentLabelKind,
} from "./ordering/payment-label.js";

export {
  getOrderDetail,
  listOrderVendors,
  listOrdersForAdmin,
  markOrderFulfilled,
  orderStateLabel,
  recordDashboardRefund,
  refundCoolingWindow,
  resolveOrderIssue,
  retryBalance,
  type AdminOrderDetail,
  type AdminOrderList,
  type AdminOrderListItem,
  type OrderActions,
  type OrderFilters,
  type OrderMoneyBreakdown,
  type RetryBalanceResult,
} from "./ordering/admin-service.js";

export {
  PAYMENT_FILTERS,
  type AuditRow as OrderAuditRow,
  type PaymentFilter,
  type PolicyRow as OrderPolicyRow,
  type VendorOption,
} from "./ordering/admin-repo.js";

export type { PaymentRow, RefundRow, TransferRow } from "./payments/repo.js";

export { buildPaymentPlan, type PaymentPlan, type PaymentPlanKind } from "./payments/plan.js";

export {
  parsePaymentLinkToken,
  paymentLinkState,
  type PaymentLinkState,
} from "./payments/payment-links.js";

export {
  UnknownOrderError,
  applyWebhook,
  chargeBalance,
  chargeDeposit,
  confirmFromWebhook,
  getOrderMoney,
  openPaymentLink,
  startLinkCheckout,
  recordExternalRefund,
  refreshConnectStatus,
  refundWithinCoolingWindow,
  startConnectOnboarding,
  sweepParkedWebhooks,
  transferShare,
  type BalanceResult,
  type DepositResult,
  type LinkCheckout,
  type PaymentLinkView,
  type RefundResult,
  type TransferResult,
  type WebhookSweep,
} from "./payments/service.js";

export {
  listUnprocessedWebhooks,
  markWebhookFailed,
  markWebhookProcessed,
  recordWebhook,
  vendorIdForStripeAccount,
} from "./payments/repo.js";

export {
  OVERRIDE_TTL_MINUTES,
  assertOverrideAllowed,
  clearAllOverrides,
  previewNow,
  readOverride,
  type StoredOverride,
} from "./clock/override.js";

export { demoClockStates, type DemoClockState } from "./clock/demo-states.js";

export {
  BATCH_LIMIT,
  runDueJobs,
  type JobResult,
  type RunOptions,
  type RunSummary,
  type RunTrigger,
} from "./jobs/runner.js";

export { describeJob } from "./jobs/handlers.js";

// `SYSTEM`, `isSystem` and the queue's raw `enqueue` are deliberately absent,
// for the same reason `createTestCoreContext` is. `SYSTEM` passes the three
// order policies, so one import of it from a server action turns them off for
// whatever it is handed; `enqueue` is the widest write into the queue — any
// type, any payload, any demo flag — and the payload is what the runner then
// trusts to name an order. Both are reachable from `identity/actor.js` and
// `jobs/repo.js` inside this package, which is where their callers are.

export {
  MAX_ATTEMPTS,
  type JobRow,
  type JobRunRow,
  type JobStatus,
  type JobType,
} from "./jobs/repo.js";

export {
  assertReseedAllowed,
  clearClockOverride,
  getOpsView,
  requeueJob,
  reseedBlockers,
  runDemoJobs,
  setClockOverride,
  type OpsView,
  type QueuedJob,
  type ReseedBlocker,
} from "./jobs/admin-service.js";

export { expireQuoteRequest, type QuoteExpiry } from "./quotes/service.js";

export { record as recordAudit, type AuditEntry } from "./audit/service.js";

// `createTestCoreContext` is intentionally absent: it lives at
// `@occasion/core/testing` so that pulling fakes into application code is a
// visible import rather than an autocomplete away.
