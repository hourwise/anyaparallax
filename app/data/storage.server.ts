/**
 * R2-facing storage abstraction.
 *
 * Server-only: this module is imported by upload/serving code (Slice 06+), never
 * by a route module or component, so R2 access cannot enter the client bundle.
 *
 * Two buckets, two rules:
 *   MASTERS — the private archival/print original. Written here, read here, and
 *             never exposed as a public URL.
 *   IMAGES  — public web derivatives and gallery thumbnails.
 *
 * Every operation validates the key's domain before touching a bucket, so a
 * programming mistake (a master key passed to a public read, or a public key
 * written to the private bucket) fails loudly instead of crossing the boundary.
 */
import {
  asMasterRef,
  asPublicImageRef,
  IMAGES_SCHEME,
  MASTERS_SCHEME,
} from "./storage";

/** Minimum R2 bucket surface used by this module. */
export type R2BucketBinding = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<unknown | null>;
  delete(key: string): Promise<void>;
};

export type R2ObjectBodyLike = {
  readonly size?: number;
  readonly httpMetadata?: { readonly contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
};

/** Cloudflare R2 bindings as configured in `wrangler.jsonc`. */
export type StorageBindings = {
  readonly MASTERS: R2BucketBinding;
  readonly IMAGES: R2BucketBinding;
};

const CONTENT_TYPE_FALLBACK = "application/octet-stream";

/** Object key without its domain prefix — this is what R2 stores. */
function objectKeyOf(key: string): string {
  if (MASTERS_SCHEME.length > 0 && key.startsWith(MASTERS_SCHEME)) {
    return key.slice(MASTERS_SCHEME.length);
  }
  if (key.startsWith(IMAGES_SCHEME)) {
    return key.slice(IMAGES_SCHEME.length);
  }
  throw new Error(`Unknown storage key domain: ${key}`);
}

function contentTypeOf(object: R2ObjectBodyLike): string {
  return object.httpMetadata?.contentType ?? CONTENT_TYPE_FALLBACK;
}

export { objectKeyOf };

export class R2ObjectStorage {
  readonly #masters: R2BucketBinding;
  readonly #images: R2BucketBinding;

  constructor(bindings: StorageBindings) {
    this.#masters = bindings.MASTERS;
    this.#images = bindings.IMAGES;
  }

  /** Store a private master. Public keys are rejected. */
  async putMaster(
    key: string,
    bytes: ArrayBuffer | ArrayBufferView,
    contentType: string,
  ): Promise<void> {
    asMasterRef(key);
    await this.#masters.put(objectKeyOf(key), bytes, { httpMetadata: { contentType } });
  }
  /** Read a private master, or null when it does not exist. */
  async readMaster(key: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    asMasterRef(key);
    const object = await this.#masters.get(objectKeyOf(key));
    if (!object) {
      return null;
    }
    return { bytes: await object.arrayBuffer(), contentType: contentTypeOf(object) };
  }

  /** True when a master object exists. Never returns its contents. */
  async masterExists(key: string): Promise<boolean> {
    asMasterRef(key);
    return (await this.#masters.head(objectKeyOf(key))) !== null;
  }

  /**
   * Remove a private master.
   *
   * Exists for ONE purpose: compensating cleanup when an upload's later stages
   * fail, so an upload reported as refused leaves no orphan master behind. It is
   * never called on a master that belongs to an accepted photograph — the caller
   * only ever passes keys built from the id of the attempt that is failing.
   */
  async deleteMaster(key: string): Promise<void> {
    asMasterRef(key);
    await this.#masters.delete(objectKeyOf(key));
  }

  /**
   * Store a public derivative. Master keys are rejected: a private original
   * must never be written to the public bucket.
   */
  async putPublicImage(
    key: string,
    bytes: ArrayBuffer | ArrayBufferView,
    contentType: string,
  ): Promise<void> {
    asPublicImageRef(key);
    await this.#images.put(objectKeyOf(key), bytes, { httpMetadata: { contentType } });
  }

  /**
   * Read a public derivative for serving. Refuses any key that is not in the
   * public images domain — in particular it refuses `originalStorageKey`.
   */
  async readPublicImage(key: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    asPublicImageRef(key);
    const object = await this.#images.get(objectKeyOf(key));
    if (!object) {
      return null;
    }
    return { bytes: await object.arrayBuffer(), contentType: contentTypeOf(object) };
  }

  /** Remove a public derivative. */
  async deletePublicImage(key: string): Promise<void> {
    asPublicImageRef(key);
    await this.#images.delete(objectKeyOf(key));
  }
}

/**
 * Read one PUBLIC derivative directly from a bucket.
 *
 * Exists for the media route, which needs exactly this and nothing else: the
 * route must not be able to construct objects, delete objects, or reach the
 * private bucket, so it is not handed a storage instance with those powers. The
 * key is validated here, so a master key passed by a confused caller throws
 * instead of reading anything.
 *
 * Returns null when the object does not exist.
 */
export async function readPublicImageFrom(
  bucket: R2BucketBinding,
  key: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  asPublicImageRef(key);
  const object = await bucket.get(objectKeyOf(key));
  if (!object) {
    return null;
  }
  return { bytes: await object.arrayBuffer(), contentType: contentTypeOf(object) };
}

/** True when a binding looks like an R2 bucket, so a route can fail closed. */
export function isR2Bucket(value: unknown): value is R2BucketBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

/** In-memory bucket used by the storage checks; implements the R2 surface used here. */
export function createMemoryBuckets(): {
  masters: R2BucketBinding & { readonly size: number };
  images: R2BucketBinding & { readonly size: number };
} {
  const make = (): R2BucketBinding & { readonly size: number } => {
    const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
    return {
      get size() {
        return store.size;
      },
      async put(key, value, options) {
        const bytes =
          typeof value === "string"
            ? new TextEncoder().encode(value)
            : ArrayBuffer.isView(value)
              ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
              : new Uint8Array(value ?? new ArrayBuffer(0));
        store.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
      },
      async get(key) {
        const entry = store.get(key);
        if (!entry) {
          return null;
        }
        return {
          size: entry.bytes.byteLength,
          httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
          async arrayBuffer() {
            return entry.bytes.slice().buffer;
          },
        };
      },
      async head(key) {
        return store.has(key) ? {} : null;
      },
      async delete(key) {
        store.delete(key);
      },
    };
  };

  return { masters: make(), images: make() };
}
