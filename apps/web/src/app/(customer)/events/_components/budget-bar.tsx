import { GlassPanel } from "@occasion/ui";
import { formatMoney, type EventBudget } from "@occasion/core";
import { ProgressBar } from "./progress-bar";

/**
 * Budget over committed, line 894.
 *
 * The figures are the domain's, unrounded and unclamped. `remaining` may be
 * negative and is shown that way: a customer who has committed past their
 * budget has done so, and a bar that stopped at full would hide the one number
 * they need.
 *
 * An event with no budget set gets the committed line and **no track**. A
 * progress bar with no maximum has nothing to be a proportion of, and drawing
 * an empty one would say "nothing spent" over a figure that says otherwise.
 */
export function BudgetBar({ budget, currency }: { budget: EventBudget; currency: string }) {
  const committed = formatMoney(budget.committed, currency);

  if (budget.budget === null) {
    return (
      <GlassPanel className="mb-[18px] p-[18px]">
        <p className="m-0 flex flex-wrap justify-between gap-2 text-[14px]">
          <span className="font-bold">No budget set</span>
          <span className="text-body">{committed} committed</span>
        </p>
      </GlassPanel>
    );
  }

  const total = formatMoney(budget.budget, currency);
  const remaining = budget.remaining ?? 0n;
  const over = remaining < 0n;

  return (
    <GlassPanel className="mb-[18px] p-[18px]">
      <p className="m-0 mb-[9px] flex flex-wrap justify-between gap-2 text-[14px]">
        <span className="font-bold">Budget {total}</span>
        <span className="text-body">
          {committed} committed ·{" "}
          {over ? `${formatMoney(-remaining, currency)} over` : `${formatMoney(remaining, currency)} left`}
        </span>
      </p>

      {/*
        The bar's proportion is the one place a `number` is right: it is a
        ratio for a width, not an amount. Every figure a customer reads is
        formatted from the `bigint` above, so nothing shown here has been
        through a double.
      */}
      <ProgressBar
        value={Number(budget.committed)}
        max={Number(budget.budget)}
        label="Budget committed"
        valueText={
          over
            ? `${committed} committed of ${total} — ${formatMoney(-remaining, currency)} over budget`
            : `${committed} committed of ${total}`
        }
      />
    </GlassPanel>
  );
}
