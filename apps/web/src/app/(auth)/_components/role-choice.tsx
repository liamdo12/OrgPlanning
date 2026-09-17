/**
 * The two roles a person may give themselves.
 *
 * Source: the prototype's `authRoles`, line 2253. Shared by the signup form and
 * by the page that finishes a provider sign-in, because both have to ask the
 * same question — and because the server validates against the same closed set
 * either way. Nothing here grants anything; the chip is a request.
 */

export const ROLE_CHOICES = [
  { value: "customer", label: "Plan an event" },
  { value: "vendor", label: "Offer services" },
] as const;

export function RoleChoice({ error }: { error?: string | undefined }) {
  return (
    <fieldset>
      <legend className="oc-label">How will you use Occasion?</legend>
      <div className="flex gap-2">
        {ROLE_CHOICES.map((choice, index) => (
          <label
            key={choice.value}
            // The chip shape from line 1669; `has-checked` tints the whole
            // label rather than showing a radio next to it.
            className="oc-chip flex-1 text-center has-checked:border-role has-checked:bg-role has-checked:text-surface"
          >
            <input
              type="radio"
              name="role"
              value={choice.value}
              defaultChecked={index === 0}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
      {error ? <p className="oc-error">Choose one to continue.</p> : null}
    </fieldset>
  );
}
