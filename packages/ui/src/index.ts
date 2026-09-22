/**
 * Glass design system.
 *
 * Every value is transcribed from `design/Event Marketplace Glass.dc.html` and
 * cites the line it came from; the tokens live in
 * `@occasion/config/tailwind/preset.css` and the surfaces in `src/styles/`.
 *
 * This package may never import `@occasion/core` or `@occasion/db` — domain
 * data arrives as props, which is what keeps a component reusable by the
 * customer and vendor views that have not been built yet.
 */

/**
 * The class-name join, exported because the app composes these too.
 *
 * One implementation rather than a second small one per consumer: `className`
 * assembled by hand is where a conditional class quietly becomes the string
 * "false".
 */
export { cx } from "./lib/cx.js";

export { ROLES, type Role } from "./theme/roles.js";
export { RoleTheme } from "./theme/role-theme.js";

export { AppBackground } from "./components/app-background.js";
export { GlassPanel, GlassCard, GlassChrome } from "./components/glass.js";
export {
  Button,
  type ButtonProps,
  type ButtonIntent,
  type ButtonSize,
} from "./components/button.js";
export { StatusBadge, Pill, type StatusTone } from "./components/status-badge.js";
export { FilterChip, FilterBar } from "./components/filter-chip.js";
export { Avatar, AVATAR_TONES, initialsOf } from "./components/avatar.js";
export { Swatch, SWATCH_TONES } from "./components/swatch.js";
export {
  DataTable,
  type Column,
  type ColumnSlot,
  type DataTableProps,
} from "./components/data-table.js";
export { ListRow, ListStack } from "./components/list-row.js";
export { PageHeader, Toolbar } from "./components/page-header.js";
export { PriceLockup, type PriceRow } from "./components/price-lockup.js";
export { Rating } from "./components/rating.js";
export { SectionNav, type SectionItem, type LinkProps } from "./components/section-nav.js";
export { Dialog, Sheet, useDismissable } from "./components/overlay.js";
export {
  SearchPill,
  SearchButton,
  SearchPanelGroup,
  SearchOption,
  type SearchSegment,
} from "./components/search-field.js";
export { Stepper } from "./components/stepper.js";
export {
  Input,
  Textarea,
  Select,
  Checkbox,
  Switch,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type CheckboxProps,
  type SwitchProps,
} from "./components/fields.js";
export { EmptyState, Skeleton, SkeletonRows, Toast, ToastRegion } from "./components/feedback.js";
export {
  BottomTabBar,
  NAV_ICONS,
  type TabBarItem,
  type TabLinkProps,
} from "./components/bottom-tab-bar.js";
