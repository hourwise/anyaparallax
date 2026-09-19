/**
 * Test harness for the D1 checks.
 *
 * Bootstrapping uses the real tools: `wrangler d1 migrations apply --local`
 * applies the repository migrations and `wrangler d1 execute --local` loads the
 * fixture rows. Queries then run in-process against the same SQLite file via
 * `node:sqlite`, which is the engine the local D1 simulator uses — fast enough
 * to exercise every repository method without spawning a process per query.
 *
 * Local only: nothing here contacts Cloudflare.
 */
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const wranglerBin = resolve(root, "node_modules", "wrangler", "bin", "wrangler.js");

let runCounter = 0;

/** D1 rejects `undefined`; keep nulls explicit. */
function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insert(table, columns, rows) {
  return rows
    .map(
      (row) =>
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns
          .map((column) => sqlValue(row[column]))
          .join(", ")});`,
    )
    .join("\n");
}

/** Fixture SQL for the development seed set, used by the checks and the local seeder. */
export function buildFixtureSql(seed) {
  const galleries = seed.galleries.map((gallery) => ({
    id: gallery.id,
    name: gallery.name,
    slug: gallery.slug,
    description: gallery.description,
    cover_photo_id: gallery.coverPhotoId,
    display_order: gallery.displayOrder,
    published: gallery.published ? 1 : 0,
    created_at: gallery.createdAt,
    updated_at: gallery.updatedAt,
  }));

  const photos = seed.photos.map((photo) => ({
    id: photo.id,
    title: photo.title,
    slug: photo.slug,
    description: photo.description,
    gallery_id: photo.galleryId,
    location: photo.location,
    capture_date: photo.captureDate,
    width: photo.width,
    height: photo.height,
    original_storage_key: photo.originalStorageKey,
    web_storage_key: photo.webStorageKey,
    thumbnail_storage_key: photo.thumbnailStorageKey,
    watermark_enabled: photo.watermarkEnabled ? 1 : 0,
    watermark_position: photo.watermarkPosition,
    featured: photo.featured ? 1 : 0,
    published: photo.published ? 1 : 0,
    print_available: photo.printAvailable ? 1 : 0,
    created_at: photo.createdAt,
    updated_at: photo.updatedAt,
    published_at: photo.publishedAt,
  }));

  const tags = seed.tags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug }));
  const photoTags = seed.photos.flatMap((photo) =>
    photo.tags.map((tagId) => ({ photo_id: photo.id, tag_id: tagId })),
  );

  return [
    "-- Fixture data for the D1 checks and the local development database.",
    "-- Idempotent: clears previously fixtured rows so a rerun cannot collide.",
    "-- Ordered so the deletes also succeed when foreign keys are enforced.",
    "DELETE FROM photo_tags;",
    "DELETE FROM likes;",
    "DELETE FROM share_events;",
    "DELETE FROM enquiries;",
    "DELETE FROM galleries;",
    "DELETE FROM photos;",
    "DELETE FROM tags;",
    "DELETE FROM users;",
    insert("photos", Object.keys(photos[0] ?? { id: "" }), photos),
    insert("galleries", Object.keys(galleries[0] ?? { id: "" }), galleries),
    insert("tags", ["id", "name", "slug"], tags),
    insert("photo_tags", ["photo_id", "tag_id"], photoTags),
    "",
  ].join("\n");
}

/** Run wrangler with output redirected to files (pipes are unreliable on Windows). */
export function runWrangler(args, { allowFailure = false } = {}) {
  const stem = join(tmpdir(), `anyaparallax-wrangler-${process.pid}-${runCounter++}`);
  const stdoutPath = `${stem}.out.txt`;
  const stderrPath = `${stem}.err.txt`;
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [wranglerBin, ...args], {
      cwd: root,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.on("error", (error) => {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      reject(error);
    });
    child.on("close", (code) => {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      const stdout = readFileSync(stdoutPath, "utf8");
      const stderr = readFileSync(stderrPath, "utf8");
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      if (code !== 0 && !allowFailure) {
        reject(new Error(`wrangler exited ${code}\n${stdout}\n${stderr}`));
        return;
      }
      resolvePromise({ code, stdout, stderr });
    });
  });
}

/**
 * Locate the D1 data file inside the Miniflare state directory.
 *
 * Miniflare keeps bookkeeping databases named `metadata.sqlite` alongside the
 * real data files, which are content-hash named (for example
 * `<sha>.sqlite`). Only the hash-named files are candidate data files.
 */
function findSqliteFile(dir) {
  const candidates = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".sqlite") && entry.name !== "metadata.sqlite") {
        candidates.push(path);
      }
    }
  };
  walk(dir);
  return candidates[0] ?? null;
}

/**
 * Create an isolated local D1 database, apply the real migrations, load the
 * fixture rows, and return both a D1-shaped binding and direct query helpers.
 *
 * @param {{seed: object, label: string}} options
 */
export async function createD1TestDatabase({ seed, label }) {
  const stateDir = resolve(root, ".wrangler", "check-state", label);
  const fixtureDir = resolve(root, ".wrangler", "check-fixtures", label);
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });

  const fixturePath = join(fixtureDir, "fixtures.sql");
  writeFileSync(fixturePath, buildFixtureSql(seed), "utf8");

  // `migrations apply` has no --yes flag; a spawned process has no TTY, so the
  // interactive confirmation is skipped.
  const migrations = await runWrangler([
    "d1",
    "migrations",
    "apply",
    "anyaparallax",
    "--local",
    "--persist-to",
    stateDir,
  ]);
  const fixtures = await runWrangler([
    "d1",
    "execute",
    "anyaparallax",
    "--local",
    "--persist-to",
    stateDir,
    "--yes",
    "--file",
    fixturePath,
  ]);

  const sqlitePath = findSqliteFile(join(stateDir, "v3"));
  if (!sqlitePath) {
    throw new Error(`No D1 SQLite file found under ${stateDir}`);
  }

  const db = new DatabaseSync(sqlitePath);

  return {
    stateDir,
    sqlitePath,
    migrationOutput: migrations.stdout,
    fixtureOutput: fixtures.stdout,
    /** Rows for a read query. */
    query(sql, ...params) {
      return db.prepare(sql).all(...params).map((row) => ({ ...row }));
    },
    /** Run a statement (insert/update/delete/pragma). */
    exec(sql) {
      db.exec(sql);
    },
    /** Run a statement expected to throw; returns the error message or null. */
    failureOf(sql) {
      try {
        db.exec(sql);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    close() {
      db.close();
    },
    /**
     * D1-shaped binding for `D1PortfolioRepository`. Numbered placeholders
     * (`?1`) are rewritten to positional `?`, matching the driver's binding.
     */
    binding: {
      prepare(query) {
        const make = (sql, values) => ({
          bind(...next) {
            return make(sql, next);
          },
          async all() {
            const prepared = db.prepare(sql);
            const results = values.length > 0 ? prepared.all(...values) : prepared.all();
            return { results: results.map((row) => ({ ...row })), success: true };
          },
          async run() {
            const prepared = db.prepare(sql);
            if (values.length > 0) {
              prepared.run(...values);
            } else {
              prepared.run();
            }
            return { success: true };
          },
        });

        const normalised = query.replace(/\?(\d+)/g, "?");
        return make(normalised, []);
      },
    },
  };
}
