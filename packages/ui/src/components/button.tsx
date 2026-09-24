import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * Buttons.
 *
 * Four intents, taken from what the prototype actually does rather than from a
 * standard set:
 *
 *   primary   solid role fill, one per screen (line 566)
 *   secondary glass with a role-coloured edge on hover (line 515)
 *   ghost     an outline until hovered, for repeated row actions (line 1685)
 *   danger    a warm outline, never a red fill (line 2629)
 *
 * The last one is the prototype's judgement and worth keeping: "Suspend" sits
 * in a list next to five other buttons, and a red fill on each would make the
 * page look like an emergency.
 */

export type ButtonIntent = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  intent?: ButtonIntent;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({
  intent = "secondary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // Explicit, because a button inside a form defaults to `submit` and a
      // row action that quietly submits its form is a bug nobody sees coming.
      type={type}
      className={cx("oc-button", `oc-button--${intent}`, `oc-button--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
