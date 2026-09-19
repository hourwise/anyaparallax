type PlaceholderFrameProps = {
  label: string;
  /** CSS aspect-ratio value, e.g. "3 / 2" or "4 / 5". */
  ratio?: string;
};

/**
 * A CSS-only stand-in for a photograph. Real images are added in later slices;
 * no private photographs or binary assets are committed to this repository.
 */
export function PlaceholderFrame({ label, ratio = "3 / 2" }: PlaceholderFrameProps) {
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
