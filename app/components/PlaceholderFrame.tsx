type PlaceholderFrameProps = {
  /**
   * The visible stand-in label, or omitted for a reserved space with no wording.
   *
   * REPAIR-09A: the label is the caller's decision rather than a constant, because
   * "Portrait placeholder" is development chrome. A production page reserves the
   * space and says nothing; a preview page may name the stand-in.
   */
  label?: string;
  /** CSS aspect-ratio value, e.g. "3 / 2" or "4 / 5". */
  ratio?: string;
};

/**
 * A CSS-only stand-in for a photograph. Real images are added in later slices;
 * no private photographs or binary assets are committed to this repository.
 *
 * With no label this is purely presentational: an empty reserved box, hidden from
 * assistive technology rather than announced as an unnamed image.
 */
export function PlaceholderFrame({ label, ratio = "3 / 2" }: PlaceholderFrameProps) {
  if (!label) {
    return <div className="placeholder-frame" style={{ aspectRatio: ratio }} aria-hidden="true" />;
  }

  return (
    <div
      className="placeholder-frame"
      style={{ aspectRatio: ratio }}
      role="img"
      aria-label={`Placeholder image: ${label}`}
    >
      <span aria-hidden="true">{label}</span>
    </div>
  );
}
