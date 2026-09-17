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
      <legend className="mb-2 text-sm font-medium">How will you use Occasion?</legend>
      <div className="flex gap-2">
        {ROLE_CHOICES.map((choice, index) => (
          <label
            key={choice.value}
            className="flex-1 cursor-pointer rounded-full border border-black/10 px-4 py-2 text-center text-sm has-checked:border-black/40 has-checked:font-semibold"
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
      {error ? <p className="mt-2 text-sm text-red-700">Choose one to continue.</p> : null}
    </fieldset>
  );
}
