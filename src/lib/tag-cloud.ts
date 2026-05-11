/**
 * Tag-cloud sizing.
 *
 * Linear sizing against raw counts means a single very-popular tag
 * (e.g. `fantasy: 129`) renders ~3× the size of the next-tier tag
 * (`scifi: ~40`), drowning out everything below it. We clamp the
 * visual ratio between the smallest and largest font size to roughly
 * 2× regardless of how skewed the underlying counts are.
 *
 * Approach: map each count through `Math.log1p` (so a count of 1 maps
 * to a finite value, not -∞), then linearly scale into a fixed
 * `[MIN_SIZE_REM, MAX_SIZE_REM]` range using the corpus min/max as
 * the endpoints. With the constants below the largest tag is exactly
 * 2× the smallest tag, regardless of whether the skew is 1-vs-10 or
 * 1-vs-10000.
 *
 * Behaviour:
 * - All-equal counts → all sizes equal (the function returns MIN_SIZE_REM,
 *   the floor — there's no spread to scale across).
 * - count=1 vs count=1000 → ratio == MAX_SIZE_REM / MIN_SIZE_REM == 2.
 * - Higher count → ≥ size (monotonic non-decreasing).
 */

export const MIN_SIZE_REM = 0.85;
export const MAX_SIZE_REM = 1.7;

/**
 * Compute the font size in rem for a single tag in a cloud.
 *
 * @param count    the tag's frequency in the corpus
 * @param minCount the smallest frequency in the corpus
 * @param maxCount the largest frequency in the corpus
 */
export function tagCloudSizeRem(count: number, minCount: number, maxCount: number): number {
  // Guard the all-equal case: no spread means everything pins to the
  // floor. (Pinning to MIN avoids a single-tag cloud rendering at MAX.)
  if (maxCount <= minCount) return MIN_SIZE_REM;

  const minLog = Math.log1p(minCount);
  const maxLog = Math.log1p(maxCount);
  const span = maxLog - minLog;
  // Clamp `count` into the [min, max] window before mapping, so
  // out-of-range inputs don't escape the size envelope.
  const clamped = Math.min(maxCount, Math.max(minCount, count));
  const t = (Math.log1p(clamped) - minLog) / span;
  return MIN_SIZE_REM + t * (MAX_SIZE_REM - MIN_SIZE_REM);
}
