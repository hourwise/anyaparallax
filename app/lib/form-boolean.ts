/**
 * Strict parsing for HTML checkbox controls — pure (REPAIR APV1C-05).
 *
 * A browser sends a checkbox field ONLY when it is ticked, with a fixed value (`on` unless
 * the markup says otherwise). That gives exactly three legitimate cases, and this module
 * accepts exactly those:
 *
 *   * the field is ABSENT        → false
 *   * the field carries `on`     → true
 *   * the field carries anything else → REFUSED
 *
 * WHY REFUSING MATTERS. The obvious implementation — `form.get(name) === "on"` — reads
 * every other value as `false`, so a direct POST of `published=hacked` is silently
 * treated as "do not publish". That is a lie about what was submitted: the request asked
 * for something this application does not understand, and quietly doing the opposite is
 * how a security field ends up reporting a state nobody chose. A refused submission
 * changes nothing and says so.
 *
 * The parser is deliberately shared rather than re-implemented per route: the upload form
 * has four such controls and a second, weaker reading of the same protocol is exactly the
 * kind of drift this repair exists to remove.
 */

/** The shape this needs from a parsed form: `getAll` for duplicate-value detection. */
export type CheckboxForm = {
  getAll(name: string): readonly unknown[];
};

export type CheckboxVerdict =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * Read one checkbox control.
 *
 * `label` is the field's human name, used in the refusal so the operator is told which
 * control was not understood. `expected` defaults to the browser's own value for a
 * checkbox without a `value` attribute.
 */
export function parseCheckbox(
  form: CheckboxForm,
  name: string,
  label: string,
  expected = "on",
): CheckboxVerdict {
  const values = form.getAll(name).map((value) => String(value));
  if (values.length === 0) {
    return { ok: true, value: false };
  }
  if (values.length === 1 && values[0] === expected) {
    return { ok: true, value: true };
  }
  return {
    ok: false,
    error: `${label} sent a value this form does not understand, so nothing was changed.`,
  };
}

/** Read several controls at once, collecting every refusal. */
export function parseCheckboxes(
  form: CheckboxForm,
  controls: readonly { readonly name: string; readonly label: string }[],
): { readonly ok: true; readonly values: Readonly<Record<string, boolean>> } | { readonly ok: false; readonly errors: readonly string[] } {
  const values: Record<string, boolean> = {};
  const errors: string[] = [];
  for (const control of controls) {
    const verdict = parseCheckbox(form, control.name, control.label);
    if (verdict.ok) {
      values[control.name] = verdict.value;
    } else {
      errors.push(verdict.error);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}
