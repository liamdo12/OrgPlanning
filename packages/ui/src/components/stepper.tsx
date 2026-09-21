"use client";

import { useId } from "react";
import { cx } from "../lib/cx";

/**
 * A number with a minus and a plus, line 359.
 *
 * The value is **live**: pressing a button changes a number somewhere on the
 * screen, and without an announcement a count that moves silently is unusable
 * without sight. The prototype has no concept of this — it renders a `<span>`
 * — and it has three consumers here, so the announcement belongs in the
 * component rather than in each of them.
 *
 * `role="status"` rather than an `aria-live` region built by hand, and on the
 * value itself rather than a duplicate off-screen: one element, announced when
 * it changes, and visible so that what is read is what is shown.
 *
 * Clamping happens here too. A caller that clamps for itself has to repeat the
 * bounds in the disabled state, and the two drift — a button that is not
 * disabled at the limit is a control that appears broken.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  label,
  decrementLabel,
  incrementLabel,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Names the control, e.g. "Guests". Not rendered — the panel's legend is. */
  label: string;
  /** e.g. "Fewer guests". The prototype's own wording, line 360. */
  decrementLabel: string;
  incrementLabel: string;
  onChange: (next: number) => void;
  className?: string;
}) {
  const valueId = useId();
  const atMin = value <= min;
  const atMax = value >= max;

  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  return (
    <div
      // A group rather than a `spinbutton`: the value is not typeable here, and
      // announcing a spinbutton promises arrow keys that do nothing.
      role="group"
      aria-label={label}
      className={cx(
        "flex items-center overflow-hidden rounded-card border border-glass-edge-soft",
        className,
      )}
    >
      <StepButton
        label={decrementLabel}
        glyph="−"
        disabled={atMin}
        onPress={() => onChange(clamp(value - step))}
        controls={valueId}
      />
      <span
        id={valueId}
        role="status"
        aria-live="polite"
        className="min-w-[62px] text-center text-[16px] font-bold"
      >
        {value}
      </span>
      <StepButton
        label={incrementLabel}
        glyph="+"
        disabled={atMax}
        onPress={() => onChange(clamp(value + step))}
        controls={valueId}
      />
    </div>
  );
}

/** 46px square, line 360 — comfortably over the 44px touch target. */
function StepButton({
  label,
  glyph,
  disabled,
  onPress,
  controls,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onPress: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-controls={controls}
      disabled={disabled}
      onClick={onPress}
      className="size-[46px] flex-none cursor-pointer border-0 bg-field text-[19px] disabled:cursor-not-allowed disabled:opacity-[0.55]"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
