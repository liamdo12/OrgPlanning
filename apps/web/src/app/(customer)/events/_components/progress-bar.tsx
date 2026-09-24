/**
 * A 9px track with a filled portion, line 895.
 *
 * Route-local: the budget bar is its only consumer, and a bar that exists once
 * belongs beside the screen that draws it rather than in the shared kit.
 *
 * The prototype draws a bare pair of spans, which says nothing at all without
 * sight — the number beside it is a separate sentence with no relationship to
 * the bar. `role="progressbar"` with a value and a spoken equivalent is what
 * makes the two one control.
 */
export function ProgressBar({
  value,
  max,
  label,
  valueText,
}: {
  /** Clamped into the track; the text beside it still states the real figure. */
  value: number;
  max: number;
  /** Names the bar, e.g. "Budget committed". */
  label: string;
  /**
   * What the bar means, in words and money.
   *
   * A percentage read aloud is not the answer to "how much have I spent" — the
   * figures are, and they are what the sighted reader sees beside the track.
   */
  valueText: string;
}) {
  const filled = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuetext={valueText}
      className="block h-[9px] overflow-hidden rounded-pill bg-track"
    >
      <span aria-hidden="true" className="block h-full bg-role" style={{ width: `${filled}%` }} />
    </span>
  );
}
