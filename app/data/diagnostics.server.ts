/**
 * Manager-only diagnostics (Slice 05).
 *
 * Assembled exclusively for the `/manager` surface, which is authorised before
 * any of this runs. Everything here is deliberately low-sensitivity: binding
 * presence, row counts, object counts and configuration STATE. No secrets, no
 * tokens, no bucket credentials, no environment values are read or returned —
 * the audience tag and team domain are reported as configured/not configured
 * rather than echoed, so the page stays safe to screenshot.
 *
 * Server-only. Public routes never import it.
 */
import { identityModeFor, type IdentityMode } from "../auth/identity";
import type { AppBindings } from "./context";
import type { D1DatabaseBinding } from "./repository.d1.server";

/** One line of the diagnostics tables: a label, its state, and optional detail. */
export type DiagnosticEntry = {
  readonly label: string;
  readonly state: string;
  readonly detail?: string;
};

export type ManagerDiagnostics = {
  readonly identity: {
    readonly mode: IdentityMode;
    readonly entries: readonly DiagnosticEntry[];
  };
  readonly database: {
    readonly bound: boolean;
    readonly entries: readonly DiagnosticEntry[];
  };
  readonly storage: {
    readonly entries: readonly DiagnosticEntry[];
  };
  readonly configuration: readonly DiagnosticEntry[];
};

function isD1Binding(value: unknown): value is D1DatabaseBinding {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

/** Minimal R2 surface needed for an object count. */
type R2BucketLike = {
  list(options?: { readonly limit?: number }): Promise<{
    readonly objects?: readonly unknown[];
    readonly truncated?: boolean;
  }>;
};

function isR2Binding(value: unknown): value is R2BucketLike {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { list?: unknown }).list === "function"
  );
}

const COUNTED_TABLES: readonly { readonly table: string; readonly label: string }[] = [
  { table: "users", label: "Authorised accounts" },
  { table: "photos", label: "Photographs" },
  { table: "galleries", label: "Galleries" },
  { table: "photo_tags", label: "Tag links" },
  { table: "likes", label: "Likes" },
  { table: "share_events", label: "Share events" },
  { table: "enquiries", label: "Enquiries" },
];

/** How many objects a bucket count will read before reporting a lower bound. */
const OBJECT_COUNT_LIMIT = 1000;

async function databaseEntries(db: D1DatabaseBinding): Promise<readonly DiagnosticEntry[]> {
  const entries: DiagnosticEntry[] = [];
  for (const { table, label } of COUNTED_TABLES) {
    try {
      const result = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).all<{
        total?: unknown;
      }>();
      const total = result.results?.[0]?.total;
      entries.push({ label, state: typeof total === "number" ? String(total) : "unreadable" });
    } catch {
      // A missing table means migrations have not been applied to this database.
      entries.push({ label, state: "unavailable", detail: "table missing" });
    }
  }
  return entries;
}

async function bucketEntry(label: string, bucket: unknown): Promise<DiagnosticEntry> {
  if (!isR2Binding(bucket)) {
    return { label, state: "not bound", detail: "binding missing" };
  }
  try {
    const listing = await bucket.list({ limit: OBJECT_COUNT_LIMIT });
    const objects = listing.objects?.length ?? 0;
    return {
      label,
      state: listing.truncated ? `${objects}+` : String(objects),
      detail: listing.truncated ? `at least ${OBJECT_COUNT_LIMIT} objects` : "objects",
    };
  } catch {
    return { label, state: "unreadable" };
  }
}

/** Collect the manager diagnostics snapshot. Never throws for a missing binding. */
export async function loadManagerDiagnostics(
  env: AppBindings | undefined,
): Promise<ManagerDiagnostics> {
  const db = env?.DB;
  const bound = isD1Binding(db);

  const identityMode = identityModeFor(env);
  const identityEntries: readonly DiagnosticEntry[] = [
    {
      label: "Identity verification",
      state:
        identityMode === "cloudflare-access"
          ? "Cloudflare Access"
          : identityMode === "development"
            ? "development header"
            : "closed",
      detail:
        identityMode === "cloudflare-access"
          ? "assertions are verified against the Access key set"
          : identityMode === "development"
            ? "loopback requests only; not valid in a deployment"
            : "no identity mechanism is configured, so protected routes deny",
    },
    {
      label: "Access team domain",
      state: env?.ACCESS_TEAM_DOMAIN ? "configured" : "not set",
    },
    {
      label: "Access application audience",
      state: env?.ACCESS_AUD ? "configured" : "not set",
    },
    {
      label: "Authorised-user source",
      state: bound ? "D1 users table" : env?.ALLOW_DEVELOPMENT_SEED === "true" ? "seed users" : "none",
    },
  ];

  return {
    identity: { mode: identityMode, entries: identityEntries },
    database: {
      bound,
      entries: bound
        ? await databaseEntries(db)
        : [{ label: "D1 binding", state: "not bound", detail: "bindings unavailable" }],
    },
    storage: {
      entries: [
        await bucketEntry("Masters (private originals)", env?.MASTERS),
        await bucketEntry("Images (public derivatives)", env?.IMAGES),
      ],
    },
    configuration: [
      {
        label: "ALLOW_DEVELOPMENT_IDENTITY",
        state: env?.ALLOW_DEVELOPMENT_IDENTITY === "true" ? "enabled" : "disabled",
        detail: "development identity header; must be disabled in production",
      },
      {
        label: "ALLOW_DEVELOPMENT_SEED",
        state: env?.ALLOW_DEVELOPMENT_SEED === "true" ? "enabled" : "disabled",
        detail: "seed data fallback; must be disabled in production",
      },
    ],
  };
}
