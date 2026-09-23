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
  AgreementMismatchError,
  AppError,
  BookingLiveError,
  CapacityConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
  type AgreedFigures,
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
  assertCanActOnEvent,
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

export {
  serviceAvailability,
  SERVICE_DAY_STATES,
  type ServiceDayAvailability,
  type ServiceDayState,
} from "./catalog/availability.js";

export { listCategoriesForBrowse, type BrowseCategory } from "./catalog/categories.js";

export {
  getServiceDetail,
  type ServiceDetail,
  type ServiceDetailMedia,
  type ServiceDetailPackage,
  type ServiceDetailReview,
  type VendorPublicFacts,
} from "./catalog/detail.js";

export {
  guestBand,
  listPublicEventFeed,
  PUBLIC_FEED_SIZE,
  type PublicEvent,
} from "./catalog/feed.js";

export {
  quoteCheckout,
  type CheckoutQuote,
  type QuotedLine,
  type QuotedOrder,
} from "./catalog/quote-checkout.js";

export { listSaved, toggleSaved, type SavedService, type SaveResult } from "./catalog/saved.js";

export {
  DEFAULT_SERVICE_SORT,
  SEARCH_FILTER_FIELDS,
  searchServices,
  type ServiceCard,
  type ServiceCardMedia,
  type ServicePage,
  type ServiceSearchFilter,
  type ServiceSort,
} from "./catalog/search.js";

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

// `applyTransition` is deliberately absent, for the same reason `enqueue` is.
// It is the only function that writes an order state, and it decides nothing:
// it takes the move it is given, queues the work that move implies, sends the
// message that move sends, and signs the audit row with whichever actor it was
// handed. Every legitimate caller has already run a policy on the order before
// reaching it, and it is reachable from `ordering/service.js` inside this
// package, where those callers are. On the barrel it would be one import away
// from a server action that could walk any order to any state.

export {
  DEFAULT_ORDERING_POLICY,
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
  type OrderDetail,
  type OrderingPolicy,
} from "./ordering/service.js";

export { type CheckoutExpectation } from "./ordering/agreement.js";

export {
  extendCheckoutWindow,
  getOrderForCustomer,
  listOrdersForCustomer,
  type CustomerOrderDetail,
  type CustomerOrderRow,
  type CustomerPayment,
  type CustomerRefund,
} from "./ordering/customer-service.js";

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

export {
  addItemToPlan,
  cancelEvent,
  createEvent,
  eventHub,
  getEvent,
  listEventsForOwner,
  removeItemFromPlan,
  updateEvent,
  type AddItemInput,
  type CreateEventInput,
  type EventDetail,
  type EventHub,
  type EventPayments,
  type EventSummary,
  type EventVisibility,
  type PlanItem,
  type UpdateEventInput,
} from "./planning/service.js";

// `planning/repo.js` stays off, for the reason the ordering repository does: it
// takes an executor and asks nobody's permission. The three modules below are
// pure projections over rows a caller has already been allowed to read.

export { eventBudget, lineSubtotal, type BudgetLine, type EventBudget } from "./planning/budget.js";

export { dayOfSchedule, type ScheduleEntry, type ScheduleItem } from "./planning/schedule.js";

export { slotState, type QuoteState, type SlotFacts, type SlotState } from "./planning/slots.js";

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

// `effectivePricing` is deliberately absent too, for a milder reason than the
// rest: it takes no actor because it reads the platform's own rates rather than
// anybody's row, and a server action has no use for it — the checkout reads it
// for itself. On the barrel it would be a new ungated export earning its place
// by being convenient in a test.

// `expireQuoteRequest` is deliberately absent. It closes a quote request by id
// and expires the offers standing against it, and it asks nobody's permission —
// the actor it takes is there to sign the audit row, not to be checked. Its one
// caller is the `quote_expiry` job handler, inside this package. Exported, it
// would let any signed-in account close any other customer's open request and
// withdraw a vendor's live offers, with that account's name on the entry.

export {
  SECOND_CONFIRMATION_ABOVE,
  getEmailView,
  listTemplates,
  liveTemplate,
  previewTemplate,
  recordDeliveryEvent as recordEmailDeliveryEvent,
  saveTemplate,
  sendBroadcast,
  setMarketingConsent,
  sendTest,
  setAutoSend,
  unsubscribe,
  type BroadcastInput,
  type BroadcastResult,
  type EmailView,
  type LiveTemplate,
  type MarketingConsent,
  type Preview,
  type SaveTemplateInput,
  type SentSummary,
} from "./email/service.js";

// `queueTransactional`, `deliverSend` and `marketingConsentFor` are
// deliberately absent. The first is how the lifecycle attaches a message to a
// move and takes no actor at all — reachable from a server action, it is a way
// to send any template to any account with no authority check. The second is
// the job's delivery step and calls the provider. The third reads one account's
// consent record by id and asks nobody's permission; the screen that shows it
// gets it from `getUserDetail`, which does. All three are reachable from
// `email/service.js` inside this package, which is where their callers are.

export {
  ACTIVE_WINDOW_DAYS,
  audienceLabel,
  describeScope,
  parseAudience,
  type Audience,
  type Recipient,
  type Scope,
} from "./email/audience.js";

export {
  MERGE_FIELDS,
  isRestricted,
  mergeField,
  parseFieldName,
  sampleValues,
  type FieldClass,
  type MergeField,
} from "./email/fields.js";

export {
  TEMPLATE_CLASSES,
  classLabel,
  parseTemplateAudience,
  parseTemplateClass,
  type EmailTemplate,
  type TemplateAudience,
  type TemplateClass,
} from "./email/template.js";

export { builtInTemplate, builtInTemplates, type TemplateKey } from "./email/templates/index.js";

export { escapeHtml, templateHash, type RenderedEmail } from "./email/render.js";

export { emailOnEntering, type EmailOnTransition } from "./ordering/transitions.js";

export {
  DISPUTE_RESOLUTIONS,
  DISPUTE_STATES,
  canTransition as canTransitionDispute,
  disputeResolutionLabel,
  disputeStateLabel,
  isOpen as disputeIsOpen,
  parseDisputeResolution,
  parseDisputeState,
  type DisputeResolution,
  type DisputeState,
} from "./disputes/transitions.js";

export {
  addDisputeNote,
  assignDispute,
  getDispute,
  listDisputes,
  listDisputesForOrder,
  openDispute,
  resolveDispute,
  startDisputeReview,
  type DisputeDetail,
  type DisputeFilter,
  type DisputeList,
  type DisputeSummary,
  type ResolveDisputeInput,
  type ResolveDisputeResult,
} from "./disputes/service.js";

export type { DisputeNote } from "./disputes/repo.js";

// `closeDisputesForOrder` is deliberately absent, for the same reason
// `applyTransition` is. It closes every open case against an order without
// asking anybody's permission and signs the entries with whichever actor it is
// handed; its one caller is the orders screen's own "resolve issue", which has
// already run the order policy. On the barrel it would be a way to mark another
// customer's complaint settled under that account's name.

export {
  CONTENT_DECISIONS,
  CONTENT_TARGETS,
  REMOVED_TEXT,
  decisionLabel as contentDecisionLabel,
  decisionsFor,
  parseContentDecision,
  parseContentTarget,
  targetLabel as contentTargetLabel,
  type ContentDecision,
  type ContentTarget,
} from "./moderation/targets.js";

export {
  decideReport,
  getReport,
  listReports,
  reportContent,
  type DecideResult,
  type ReportDetail,
  type ReportFilter,
  type ReportList,
  type ReportSummary,
} from "./moderation/service.js";

export type { ReportCounts, ReportRow, TargetContent } from "./moderation/repo.js";

export {
  SETTING_KEYS,
  SETTING_SPECS,
  formatSettingValue,
  parseSettingValue,
  specFor as settingSpecFor,
  type SettingKey,
  type SettingKind,
  type SettingSpec,
} from "./reference/settings.js";

export {
  createCategory,
  deleteCategory,
  listCategories as listCategoriesForAdmin,
  listSettings as listPlatformSettings,
  moveCategory,
  slugify,
  updateCategory,
  updateSetting,
  type AdminCategory,
  type AdminSetting,
} from "./reference/service.js";

export {
  PERIODS,
  getAnalytics,
  parsePeriod,
  periodLabel,
  windowFor,
  type Period,
  type PlatformAnalytics,
  type Rate as AnalyticsRate,
} from "./analytics/service.js";

export { record as recordAudit, type AuditEntry } from "./audit/service.js";

// `createTestCoreContext` is intentionally absent: it lives at
// `@occasion/core/testing` so that pulling fakes into application code is a
// visible import rather than an autocomplete away.
