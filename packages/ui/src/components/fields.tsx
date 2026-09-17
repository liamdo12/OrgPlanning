import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "../lib/cx";

/**
 * Form controls.
 *
 * Line 263 for the surface: a faint glass fill, a soft edge, 16px radius,
 * 13px padding. Line 351 for the checkbox, which the prototype tints with
 * `accent-color` rather than rebuilding — the right instinct, since a rebuilt
 * checkbox loses the native keyboard and screen-reader behaviour for nothing.
 *
 * The wrapper is what makes these usable: a label bound by `htmlFor`, a hint
 * and an error both referenced by `aria-describedby`, and `aria-invalid` on the
 * control. Without it every form here would have a floating label and an error
 * message nothing announces.
 */

type FieldShellProps = {
  /** Required: an unlabelled control is unusable, so there is no way to skip it. */
  label: ReactNode;
  // `| undefined` because this package compiles with
  // `exactOptionalPropertyTypes`: passing an absent optional prop through to
  // another component is only legal if the target admits `undefined`.
  hint?: ReactNode | undefined;
  error?: ReactNode | undefined;
  className?: string | undefined;
};

type ControlProps = {
  id: string;
  name?: string;
};

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const parts = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    // No margin of its own: a field in a stack is spaced by the stack, and a
    // field in a toolbar row must not be pushed out of alignment by a margin
    // the caller then has to fight with a utility.
    <div className={cx(className)}>
      <label htmlFor={id} className="oc-label">
        {label}
      </label>

      {children}

      {hint ? (
        <p id={`${id}-hint`} className="oc-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        // A live region, not just a described-by target: after a failed submit
        // focus stays on the button, so nothing would ever read this out.
        <p id={`${id}-error`} role="alert" className="oc-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = FieldShellProps &
  ControlProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

export function Input({ label, hint, error, className, id, ...rest }: InputProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <input
        {...rest}
        id={id}
        className="oc-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
    </FieldShell>
  );
}

export type TextareaProps = FieldShellProps &
  ControlProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">;

export function Textarea({ label, hint, error, className, id, rows = 4, ...rest }: TextareaProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        {...rest}
        id={id}
        rows={rows}
        className="oc-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
    </FieldShell>
  );
}

export type SelectProps = FieldShellProps &
  ControlProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> & {
    options: ReadonlyArray<{ value: string; label: string }>;
  };

export function Select({ label, hint, error, className, id, options, ...rest }: SelectProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <select
        {...rest}
        id={id}
        className="oc-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export type CheckboxProps = ControlProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "className"> & {
    label: ReactNode;
    className?: string;
  };

/** The label wraps the control, so the text is part of the hit area. Line 351. */
export function Checkbox({ id, label, className, ...rest }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cx("flex cursor-pointer items-center gap-[9px] text-row text-body", className)}
    >
      <input id={id} type="checkbox" className="oc-check" {...rest} />
      {label}
    </label>
  );
}

export type SwitchProps = CheckboxProps;

/**
 * A switch, which the prototype does not have.
 *
 * Built from a checkbox rather than a styled `div`: it keeps Space, it keeps
 * the checked state in the accessibility tree, and it posts in a form. Only the
 * appearance is ours.
 */
export function Switch({ id, label, className, ...rest }: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={cx("flex cursor-pointer items-center gap-[10px] text-row text-body", className)}
    >
      <input id={id} type="checkbox" role="switch" className="oc-switch" {...rest} />
      {label}
    </label>
  );
}
