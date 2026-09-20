/**
 * HTTP upload request boundary (Slice 06 repair 02) — server only.
 *
 * This is where the memory policy is enforced, and the distinction it draws is
 * the whole point of the module:
 *
 *   * `Content-Length` is checked from the HEADERS, before the body is parsed.
 *     A request that is already too large is refused without anyone allocating
 *     anything for it.
 *   * Once the body is parsed, the batch policy is applied to the parsed Files'
 *     METADATA (`size`, count) — still before a single `arrayBuffer()` is called.
 *   * File bodies are then read ONE AT A TIME, by the orchestration loop, through
 *     a lazy source. No array of `Uint8Array`s is ever built.
 *
 * The honest limitation: `Request.formData()` parses the whole multipart body and
 * holds the file parts. There is no bounded streaming multipart parser here, so
 * the guarantee is NOT "the body is never buffered" — it is:
 *
 *   1. an oversized request is refused from `Content-Length` alone, before parsing;
 *   2. a request without a usable `Content-Length` is refused outright, because
 *      its size is unknown and an unknown-size upload cannot be bounded. Chunked
 *      encoding is therefore not accepted for uploads;
 *   3. after parsing, the DECLARED per-file and total sizes are checked before any
 *      file body is read;
 *   4. at most ONE file body is materialised at a time.
 *
 * Steps 3 and 4 are what the previous revision lacked: it read every file body
 * concurrently and only then applied the batch policy, so the policy could not
 * prevent the allocation it existed to prevent.
 */
import { assertBatchWithinPolicy, MAX_BATCH_BYTES, UploadError } from "./upload-validation";
import { declaredContentLength } from "../lib/request-bound";

/**
 * `declaredContentLength` lives in `app/lib/request-bound.ts` (REPAIR-09D) because the
 * public form endpoints need the same header-only reading, and one definition of "how
 * a declared length is parsed" is what keeps them consistent. It is re-exported here
 * so this module's surface — and every existing caller — is unchanged.
 */
export { declaredContentLength };

/**
 * Allowance above the file budget for multipart framing and non-file fields.
 *
 * Boundary markers, part headers and the ordinary form fields cost bytes that
 * are not part of any file. 256 KiB is far more than the admin form's fields can
 * need and small enough that the envelope stays bounded.
 */
export const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;

/** The largest request body this application will parse at all. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_BATCH_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

/** A lazy file source: metadata now, bytes only when the caller asks. */
export type UploadFileSource = {
  readonly filename: string;
  readonly declaredType: string;
  /** Size as declared by the request, available without reading the body. */
  readonly size: number;
  /** Read the bytes. Called at most once, sequentially, by the orchestration loop. */
  readBytes(): Promise<Uint8Array>;
};

/**
 * Refuse an upload request from its HEADERS alone, before the body is parsed.
 *
 * Two refusals, both deliberate:
 *
 *   * a length above {@link MAX_UPLOAD_REQUEST_BYTES} — the request is already
 *     too large, so there is nothing to learn by reading it;
 *   * NO usable length at all — a chunked or malformed-length request has no
 *     bound, and this application cannot promise a memory ceiling for a request
 *     whose size it does not know. Refusing is the only honest answer short of
 *     writing a bounded streaming multipart parser, which this slice does not do.
 */
export function assertRequestWithinLimit(request: Request): number {
  const length = declaredContentLength(request);
  if (length === null) {
    throw new UploadError(
      "length-required",
      "An upload must declare its size. Send the form with a Content-Length header.",
    );
  }
  if (length > MAX_UPLOAD_REQUEST_BYTES) {
    const megabytes = (length / (1024 * 1024)).toFixed(1);
    throw new UploadError(
      "request-too-large",
      `The request is ${megabytes} MB; at most ${
        MAX_UPLOAD_REQUEST_BYTES / (1024 * 1024)
      } MB is accepted.`,
    );
  }
  return length;
}

/** True for a parsed part that is a real uploaded file rather than a text field. */
function isUploadedFile(entry: unknown): entry is File {
  return typeof File !== "undefined" && entry instanceof File;
}

/**
 * Turn parsed multipart parts into LAZY file sources.
 *
 * No bytes are read here. The metadata check happens first, so a submission that
 * cannot be accepted is refused while every file is still just a name, a type and
 * a number — which is what makes the policy effective rather than decorative.
 */
export function fileSourcesFrom(form: FormData, field = "photos"): readonly UploadFileSource[] {
  const files = form.getAll(field).filter(isUploadedFile).filter((file) => file.size > 0);
  assertBatchWithinPolicy(files.map((file) => ({ size: file.size })));
  return files.map((file) => ({
    filename: file.name,
    declaredType: file.type,
    size: file.size,
    readBytes: async () => new Uint8Array(await file.arrayBuffer()),
  }));
}
