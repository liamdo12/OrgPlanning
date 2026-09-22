import { DeferredAction } from "../../_components/deferred-action";

/**
 * "Can't find exactly what you need?" Lines 743–753.
 *
 * The band is drawn as the canvas draws it; its button is not a link, because
 * the brief screen it points at belongs to a later plan. A control that says
 * so is better than one that 404s, and better than one quietly removed — the
 * product does offer quotes, and the band is where that is said.
 *
 * The subcopy is `--color-on-role-muted`: the canvas's own `#DCE8CE` clears AA
 * on the role fill, where the two lighter greens it uses elsewhere do not.
 */
export function QuoteNudge() {
  return (
    <section className="mt-[26px] flex flex-wrap items-center justify-between gap-[18px] rounded-panel bg-role p-[24px] text-surface">
      <div>
        <h2 className="m-0 mb-[5px] text-[19px] font-bold">
          Can&rsquo;t find exactly what you need?
        </h2>
        <p className="m-0 text-[14px] text-on-role-muted">
          Describe it once and get quotes from up to 5 Toronto vendors.
        </p>
      </div>

      <DeferredAction
        reason="Sending one brief to several vendors is planned, and is not built yet."
        className="oc-button oc-button--md rounded-pill border-0 bg-[#F4F1E9] text-[14.5px] font-bold text-ink"
      >
        Get quotes
      </DeferredAction>
    </section>
  );
}
