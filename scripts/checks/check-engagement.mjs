#!/usr/bin/env node
/**
 * Engagement check (Slice 07): likes, privacy, sharing and share metrics.
 *
 * Driven against a REAL D1 database through the production store and service, so
 * the uniqueness backstop under test is the table's own `UNIQUE (photo_id,
 * browser_token)` rather than a JavaScript guard that happens to agree with it.
 *
 * What this suite is built to catch:
 *
 *   * a like that counts twice for one browser, or that a second browser cannot
 *     add;
 *   * an unlike that removes someone else's row;
 *   * engagement reachable for a draft, a hidden gallery or an unknown slug;
 *   * the raw cookie token reaching the database — only its SHA-256 digest may;
 *   * a token or digest reaching loader data or markup;
 *   * an identifier that varies with any request characteristic, which is the
 *     definition of the fingerprinting this slice must not do;
 *   * a share row that implies an external outcome, or that stores anything about
 *     who shared.
 */
import { register } from "node:module";

register("../ts-extension-hooks.mjs", import.meta.url);

const {
  BROWSER_ID_COOKIE,
  BROWSER_ID_MAX_AGE_SECONDS,
  buildBrowserIdCookie,
  browserTokenFromCookieHeader,
  digestBrowserToken,
  isSecureRequestUrl,
  newBrowserToken,
  readCookie,
} = await import("../../app/engagement/anonymous-browser.server.ts");
const { isEngagementIdentifier } = await import("../../app/engagement/identifier.ts");
const {
  SHARE_CHANNELS,
  SHARE_CHANNEL_LABELS,
  isShareChannel,
  shareStatusMessage,
} = await import("../../app/engagement/engagement.ts");
const {
  OUTBOUND_SHARE_CHANNELS,
  isOutboundShareChannel,
  isSameOriginRequest,
  shareUrlFor,
} = await import("../../app/engagement/share.ts");
const { likePhoto, readEngagement, recordShare, unlikePhoto } = await import(
  "../../app/engagement/engagement.server.ts"
);
const { EngagementStore, engagementStoreFor } = await import(
  "../../app/engagement/store.server.ts"
);
const { seed } = await import("../../app/data/seed.ts");
const { createD1TestDatabase } = await import("./d1-harness.mjs");
const { check, note, report } = await import("./report.mjs");

// --- Fixture database -----------------------------------------------------

const database = await createD1TestDatabase({ seed, label: "engagement" });
const env = { DB: database.binding };
const store = new EngagementStore(database.binding);

/** Published photograph in a published gallery. */
const PUBLISHED = { id: "p-published", slug: "published-photo" };
/** Published photograph in an UNPUBLISHED gallery. */
const HIDDEN_GALLERY = { id: "p-hidden-gallery", slug: "hidden-gallery-photo" };
/** Unpublished photograph in a published gallery. */
const DRAFT = { id: "p-draft", slug: "draft-photo" };

const NOW = "2026-09-01T00:00:00.000Z";

function insertPhoto(id, galleryId, published) {
  database.exec(
    `INSERT INTO photos (id, title, slug, description, gallery_id, width, height,
       original_storage_key, web_storage_key, thumbnail_storage_key, watermark_enabled,
       watermark_position, featured, published, print_available, created_at, updated_at, published_at)
     VALUES ('${id}', '${id}', '${id}', 'A fixture photograph.', '${galleryId}', 100, 100,
       'r2://masters/originals/${id}/master.jpg',
       'r2://images/web/${id}/web.webp', 'r2://images/thumbs/${id}/thumb.webp', 0,
       'bottom-right', 0, ${published ? 1 : 0}, 0, '${NOW}', '${NOW}', ${published ? `'${NOW}'` : "NULL"})`,
  );
}

database.exec(
  `INSERT INTO galleries (id, name, slug, description, cover_photo_id, display_order, published, created_at, updated_at)
   VALUES ('gallery-hidden', 'Hidden', 'hidden', '', NULL, 98, 0, '${NOW}', '${NOW}')`,
);
insertPhoto(PUBLISHED.id, "gallery-nightlife", 1);
insertPhoto(HIDDEN_GALLERY.id, "gallery-hidden", 1);
insertPhoto(DRAFT.id, "gallery-nightlife", 0);

/** A request carrying a browser identifier, as the endpoint would receive one. */
function requestWith(token, headers = {}) {
  return new Request("https://anyaparallax.co.uk/engagement/published-photo", {
    method: "POST",
    headers: {
      ...(token === null ? {} : { cookie: `${BROWSER_ID_COOKIE}=${token}` }),
      ...headers,
    },
  });
}

/** The stored digests for one photograph, which is the only browser-related data. */
function storedDigests(photoId) {
  return database
    .query("SELECT browser_token FROM likes WHERE photo_id = ?1 ORDER BY browser_token", photoId)
    .map((row) => row.browser_token);
}

// --- A. Like behaviour ----------------------------------------------------

const browserA = newBrowserToken();
const browserB = newBrowserToken();

/** Pull the identifier out of a `Set-Cookie` value, or null. */
function tokenFromCookie(setCookie) {
  if (setCookie === null) {
    return null;
  }
  const match = new RegExp(`${BROWSER_ID_COOKIE}=([^;]+)`).exec(setCookie);
  return match?.[1] ?? null;
}

const initial = await readEngagement(PUBLISHED, requestWith(null), env);
check(initial.availability.available === true, "engagement was reported unavailable with a database present");
check(initial.engagement?.likeCount === 0, `a fresh photograph reported ${initial.engagement?.likeCount} likes`);
check(initial.engagement?.likedByThisBrowser === false, "a fresh browser was reported as having liked");

// The FIRST like comes from a browser that has no identifier yet, which is the
// only moment one is issued. The test then uses the identifier the SERVER chose,
// rather than one it picked itself, so the flow matches a real first visit.
const firstLike = await likePhoto(PUBLISHED, requestWith(null), env, false);
check(firstLike.status === "ok", `the first like failed: ${firstLike.status}`);
check(
  firstLike.status === "ok" && firstLike.result.likeCount === 1,
  `the first like produced count ${firstLike.status === "ok" ? firstLike.result.likeCount : "?"}`,
);
check(firstLike.status === "ok" && firstLike.result.likedByThisBrowser === true, "the first like did not mark this browser");
check(
  firstLike.status === "ok" && firstLike.setCookie !== null,
  "a brand-new browser was not given an identifier cookie",
);
const issuedToken = firstLike.status === "ok" ? tokenFromCookie(firstLike.setCookie) : null;
check(
  issuedToken !== null && isEngagementIdentifier(issuedToken),
  `the issued identifier is not a value this application generates: ${issuedToken}`,
);
check(
  database.query("SELECT COUNT(*) AS total FROM likes WHERE photo_id = ?1", PUBLISHED.id)[0]?.total === 1,
  "the first like did not create exactly one row",
);

// The same browser again: no second row, count unchanged.
const repeatLike = await likePhoto(PUBLISHED, requestWith(issuedToken), env, false);
check(
  repeatLike.status === "ok" && repeatLike.result.likeCount === 1,
  `a repeated like produced count ${repeatLike.status === "ok" ? repeatLike.result.likeCount : "?"}`,
);
check(
  database.query("SELECT COUNT(*) AS total FROM likes WHERE photo_id = ?1", PUBLISHED.id)[0]?.total === 1,
  "a repeated like created a duplicate row",
);
check(
  repeatLike.status === "ok" && repeatLike.setCookie === null,
  "a browser that already has an identifier was handed a new one",
);

// A second browser adds its own like.
const secondBrowser = await likePhoto(PUBLISHED, requestWith(browserB), env, false);
check(
  secondBrowser.status === "ok" && secondBrowser.result.likeCount === 2,
  `a second browser produced count ${secondBrowser.status === "ok" ? secondBrowser.result.likeCount : "?"}`,
);
check(secondBrowser.status === "ok" && secondBrowser.result.likedByThisBrowser === true, "the second browser was not marked");
check(secondBrowser.status === "ok" && secondBrowser.setCookie === null, "a supplied identifier was replaced");
check(
  database.query("SELECT COUNT(*) AS total FROM likes WHERE photo_id = ?1", PUBLISHED.id)[0]?.total === 2,
  "a second browser did not create its own row",
);

// The FIRST browser unlikes: only ITS row goes.
const unlikeFirst = await unlikePhoto(PUBLISHED, requestWith(issuedToken), env, false);
check(
  unlikeFirst.status === "ok" && unlikeFirst.result.likeCount === 1,
  `unlike produced count ${unlikeFirst.status === "ok" ? unlikeFirst.result.likeCount : "?"}`,
);
check(
  unlikeFirst.status === "ok" && unlikeFirst.result.likedByThisBrowser === false,
  "after unliking, this browser is still marked",
);
check(storedDigests(PUBLISHED.id).length === 1, "unlike removed the wrong number of rows");
check(
  storedDigests(PUBLISHED.id)[0] === (await digestBrowserToken(browserB)),
  "unlike removed the OTHER browser's row",
);

// Repeated unlike is harmless.
const unlikeAgain = await unlikePhoto(PUBLISHED, requestWith(issuedToken), env, false);
check(
  unlikeAgain.status === "ok" && unlikeAgain.result.likeCount === 1,
  `a repeated unlike produced count ${unlikeAgain.status === "ok" ? unlikeAgain.result.likeCount : "?"}`,
);
check(
  unlikeAgain.status === "ok" && unlikeAgain.result.likedByThisBrowser === false,
  "a repeated unlike changed the browser's state",
);

// The first browser can like again.
const relike = await likePhoto(PUBLISHED, requestWith(issuedToken), env, false);
check(relike.status === "ok" && relike.result.likeCount === 2, "re-liking after an unlike did not restore the like");

// Concurrency: the SAME browser submitting many times at once.
const concurrentToken = newBrowserToken();
const concurrent = await Promise.all(
  Array.from({ length: 8 }, () => likePhoto(PUBLISHED, requestWith(concurrentToken), env, false)),
);
check(
  concurrent.every((outcome) => outcome.status === "ok"),
  "a concurrent like batch produced a failure",
);
const concurrentDigest = await digestBrowserToken(concurrentToken);
check(
  database.query("SELECT COUNT(*) AS total FROM likes WHERE photo_id = ?1 AND browser_token = ?2", PUBLISHED.id, concurrentDigest)[0]
    ?.total === 1,
  "eight concurrent identical likes created more than one row: the uniqueness backstop did not hold",
);
note("concurrency: 8 simultaneous identical likes produced exactly one row");

// --- B. Server authority --------------------------------------------------

// A client cannot supply the count or its own liked state: there is no code path
// that reads either. The strongest available evidence is that the endpoint's
// inputs are ignored, which the request below demonstrates by sending them.
const forged = new Request("https://anyaparallax.co.uk/engagement/published-photo", {
  method: "POST",
  headers: {
    cookie: `${BROWSER_ID_COOKIE}=${newBrowserToken()}`,
    "content-type": "application/x-www-form-urlencoded",
  },
  body: "action=like&likeCount=9999&likedByThisBrowser=true&browser_token=attacker-chosen&photo_id=p-draft",
});
const forgedResult = await likePhoto(PUBLISHED, forged, env, false);
check(
  forgedResult.status === "ok" && forgedResult.result.likeCount !== 9999,
  "a client-supplied count was accepted",
);
check(
  forgedResult.status === "ok" &&
    database.query("SELECT COUNT(*) AS total FROM likes WHERE photo_id = ?1 AND browser_token = 'attacker-chosen'", PUBLISHED.id)[0]
      ?.total === 0,
  "a client-supplied browser token reached storage",
);

// --- C. Publication gate --------------------------------------------------

for (const [photo, label] of [
  [DRAFT, "an unpublished photograph"],
  [HIDDEN_GALLERY, "a photograph in an unpublished gallery"],
  [{ id: "p-unknown", slug: "no-such-photo" }, "an unknown photograph id"],
]) {
  const outcome = await likePhoto(photo, requestWith(newBrowserToken()), env, false);
  check(outcome.status === "not-found", `liking ${label} returned ${outcome.status}, expected not-found`);
}
check(
  database.query("SELECT COUNT(*) AS total FROM likes WHERE photo_id IN ('p-draft','p-hidden-gallery','p-unknown')")[0]
    ?.total === 0,
  "a like was written for a photograph that is not publicly engageable",
);
const hiddenRead = await readEngagement(DRAFT, requestWith(null), env);
check(
  hiddenRead.availability.available === true && hiddenRead.engagement?.likeCount === 0,
  "reading engagement for a draft behaved unexpectedly",
);

// --- D. No database: fail closed -----------------------------------------

const noDatabase = await readEngagement(PUBLISHED, requestWith(null), {});
check(noDatabase.availability.available === false, "engagement was reported available with no database");
check(noDatabase.engagement === null, "engagement invented a count with no database");
const noDatabaseLike = await likePhoto(PUBLISHED, requestWith(newBrowserToken()), {}, false);
check(noDatabaseLike.status === "unavailable", `liking without a database returned ${noDatabaseLike.status}`);
check(engagementStoreFor({}) === null, "the store was constructed without a database binding");
check(engagementStoreFor(undefined) === null, "the store was constructed from an undefined environment");

// --- E. Identity ----------------------------------------------------------

// The digest is what is stored; the token never is.
check(
  !storedDigests(PUBLISHED.id).includes(browserA) && !storedDigests(PUBLISHED.id).includes(browserB),
  "a raw browser token was stored in the likes table",
);
const tokens = [browserA, browserB, concurrentToken];
check(
  tokens.every((token) => !JSON.stringify(storedDigests(PUBLISHED.id)).includes(token)),
  "a raw browser token appears anywhere in the stored column",
);
check(
  storedDigests(PUBLISHED.id).every((value) => /^[0-9a-f]{64}$/.test(value)),
  "a stored value is not a SHA-256 hex digest",
);
check(
  (await digestBrowserToken(browserB)) === (await digestBrowserToken(browserB)),
  "the digest is not deterministic for one token",
);
check(
  (await digestBrowserToken(browserA)) !== (await digestBrowserToken(browserB)),
  "two different tokens produced the same digest",
);
note("D1 stores only the SHA-256 digest; raw tokens appear nowhere in the table");

// Randomness: the generator is the platform CSPRNG and nothing else.
const samples = Array.from({ length: 64 }, () => newBrowserToken());
check(
  new Set(samples).size === samples.length,
  "the identifier generator produced a collision in 64 draws",
);
check(
  samples.every((value) => isEngagementIdentifier(value)),
  "a generated identifier does not match the accepted shape",
);
check(
  isEngagementIdentifier("not-an-identifier") === false &&
    isEngagementIdentifier("") === false &&
    isEngagementIdentifier(null) === false &&
    isEngagementIdentifier("00000000-0000-1000-8000-000000000000") === false,
  "the identifier shape accepted a value this application would never issue",
);

// --- F. Cookie security attributes ---------------------------------------

const secureCookie = buildBrowserIdCookie(browserA, true);
const plainCookie = buildBrowserIdCookie(browserA, false);
for (const [label, cookie] of [
  ["Secure", secureCookie],
  ["plain", plainCookie],
]) {
  check(cookie.includes(`${BROWSER_ID_COOKIE}=${browserA}`), `the ${label} cookie does not carry the identifier`);
  check(cookie.includes("HttpOnly"), `the ${label} cookie is not HttpOnly`);
  check(cookie.includes("SameSite=Lax"), `the ${label} cookie is not SameSite=Lax`);
  check(cookie.includes("Path=/"), `the ${label} cookie is not scoped to the whole path`);
  check(
    cookie.includes(`Max-Age=${BROWSER_ID_MAX_AGE_SECONDS}`),
    `the ${label} cookie does not carry the long-lived Max-Age`,
  );
  check(!cookie.includes("Domain="), `the ${label} cookie is scoped to a domain rather than host-only`);
}
check(secureCookie.includes("Secure"), "an HTTPS request did not receive a Secure cookie");
check(!plainCookie.includes("Secure"), "a plain-HTTP request received a Secure cookie, which browsers reject");
check(
  isSecureRequestUrl("https://anyaparallax.co.uk/photo/x") === true &&
    isSecureRequestUrl("http://localhost:5173/photo/x") === false,
  "Secure is not decided by the request scheme",
);
check(readCookie(`${BROWSER_ID_COOKIE}=${browserA}; other=1`, BROWSER_ID_COOKIE) === browserA, "cookie parsing failed");
check(readCookie(null, BROWSER_ID_COOKIE) === null, "cookie parsing invented a value from no header");
check(
  browserTokenFromCookieHeader(requestWith("junk").headers.get("cookie")) === null,
  "a malformed cookie value was adopted as an identifier",
);

// --- G. Privacy: no request characteristic is an input --------------------

/**
 * Every request below differs only in characteristics a fingerprinter would use.
 * The digest computed from the SAME cookie must be identical in all of them,
 * because nothing in the identity path can see any of these values.
 */
const privacyToken = newBrowserToken();
const characteristics = [
  ["plain", {}],
  ["desktop user agent", { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }],
  ["mobile user agent", { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }],
  ["forwarded address", { "x-forwarded-for": "203.0.113.7" }],
  ["real address", { "cf-connecting-ip": "198.51.100.9", "x-real-ip": "198.51.100.9" }],
  ["language", { "accept-language": "de-DE,de;q=0.9" }],
  ["timezone-ish custom header", { "x-timezone": "Pacific/Auckland", "x-screen": "3840x2160" }],
  ["client hints", { "sec-ch-ua-platform": "Windows", "sec-ch-ua-mobile": "?0" }],
];
const digests = new Map();
for (const [label, headers] of characteristics) {
  const token = browserTokenFromCookieHeader(requestWith(privacyToken, headers).headers.get("cookie"));
  digests.set(label, token === null ? null : await digestBrowserToken(token));
}
const uniqueDigests = new Set(digests.values());
check(
  uniqueDigests.size === 1 && !uniqueDigests.has(null),
  `the identifier varied with request characteristics: ${JSON.stringify([...digests.entries()])}`,
);
note(`identifier identical across ${characteristics.length} request-characteristic variations`);

// The like STATE must also be identical, which is the user-visible consequence.
const states = [];
for (const [, headers] of characteristics) {
  states.push(await readEngagement(PUBLISHED, requestWith(browserB, headers), env));
}
check(
  states.every(
    (state) =>
      state.engagement?.likeCount === states[0]?.engagement?.likeCount &&
      state.engagement?.likedByThisBrowser === states[0]?.engagement?.likedByThisBrowser,
  ),
  "the engagement state varied with request characteristics",
);

// --- H. Share channels and metrics ---------------------------------------

check(SHARE_CHANNELS.length === 7, `expected 7 channels, found ${SHARE_CHANNELS.length}`);
check(
  SHARE_CHANNELS.includes("native") && SHARE_CHANNELS.includes("copy_link"),
  "the channel vocabulary is missing a required value",
);
check(
  SHARE_CHANNELS.every((channel) => typeof SHARE_CHANNEL_LABELS[channel] === "string"),
  "a channel has no label",
);
check(isShareChannel("whatsapp") === true, "an allowed channel was refused");
for (const bad of ["", "twitter", "Native", "copy-link", "javascript:alert(1)", null, 42]) {
  check(isShareChannel(bad) === false, `the allow-list accepted ${JSON.stringify(bad)}`);
}

// Each allowed channel records exactly one event.
const beforeShares = database.query("SELECT COUNT(*) AS total FROM share_events")[0]?.total;
for (const channel of SHARE_CHANNELS) {
  const outcome = await recordShare(PUBLISHED, channel, env);
  check(outcome.status === "ok" && outcome.channel === channel, `channel ${channel} was not recorded`);
}
const afterShares = database.query("SELECT COUNT(*) AS total FROM share_events")[0]?.total;
check(
  afterShares === (beforeShares ?? 0) + SHARE_CHANNELS.length,
  `recording ${SHARE_CHANNELS.length} channels produced ${(afterShares ?? 0) - (beforeShares ?? 0)} rows`,
);
const channelRows = database.query(
  "SELECT channel, COUNT(*) AS total FROM share_events GROUP BY channel ORDER BY channel",
);
check(
  channelRows.length === SHARE_CHANNELS.length &&
    channelRows.every((row) => row.total === 1),
  `each channel should appear exactly once: ${JSON.stringify(channelRows)}`,
);

// Unsupported channels are refused and write nothing.
for (const bad of ["twitter", "telegram", "", "native "]) {
  const outcome = await recordShare(PUBLISHED, bad, env);
  check(outcome.status === "bad-request", `unsupported channel ${JSON.stringify(bad)} returned ${outcome.status}`);
}
check(
  database.query("SELECT COUNT(*) AS total FROM share_events")[0]?.total === afterShares,
  "a refused channel still wrote a row",
);

// Every event is unconfirmed, and none carries anything about the sharer.
const unconfirmed = database.query(
  "SELECT COUNT(*) AS total FROM share_events WHERE external_confirmed_at IS NOT NULL",
)[0]?.total;
check(unconfirmed === 0, `${unconfirmed} share events claim an external confirmation that never happened`);

const shareColumns = database.query("SELECT * FROM share_events LIMIT 1")[0] ?? {};
const forbiddenColumns = ["ip", "address", "user_agent", "ua", "browser", "token", "referrer", "fingerprint"];
const offending = Object.keys(shareColumns).filter((column) =>
  forbiddenColumns.some((forbidden) => column.toLowerCase().includes(forbidden)),
);
check(offending.length === 0, `share_events stores identity columns: ${offending.join(", ")}`);
check(
  JSON.stringify(shareColumns).length > 0 &&
    !JSON.stringify(shareColumns).includes(privacyToken),
  "a share event carries browser identity",
);

// A draft or hidden photo cannot be shared either.
for (const [photo, label] of [
  [DRAFT, "an unpublished photograph"],
  [HIDDEN_GALLERY, "a photograph in an unpublished gallery"],
]) {
  const outcome = await recordShare(photo, "copy_link", env);
  check(outcome.status === "not-found", `sharing ${label} returned ${outcome.status}`);
}
check(
  database.query("SELECT COUNT(*) AS total FROM share_events WHERE photo_id IN ('p-draft','p-hidden-gallery')")[0]
    ?.total === 0,
  "a share was recorded for a photograph that is not publicly engageable",
);
const noDatabaseShare = await recordShare(PUBLISHED, "copy_link", {});
check(noDatabaseShare.status === "unavailable", "sharing without a database did not fail closed");

// --- I. Share URLs and truthful copy -------------------------------------

const target = {
  url: "https://anyaparallax.co.uk/photo/rain-neon",
  title: 'Rain & Neon "after dark"',
  description: "Wet streets, 50mm, ISO 3200.",
  imageUrl: "https://anyaparallax.co.uk/media/web/p1/web.webp",
};

for (const channel of OUTBOUND_SHARE_CHANNELS) {
  const url = shareUrlFor(channel, target);
  check(typeof url === "string" && url.length > 0, `no URL for channel ${channel}`);
  check(
    isOutboundShareChannel(channel),
    `channel ${channel} is not recognised as outbound`,
  );
  // The canonical URL must survive encoding intact rather than being truncated
  // or split by a character in the title.
  const roundTripped =
    channel === "email"
      ? decodeURIComponent(url.split("?")[1] ?? "")
      : new URL(url).searchParams.get(channel === "whatsapp" ? "text" : channel === "pinterest" ? "url" : "u") ??
        new URL(url).searchParams.get("url");
  check(
    (roundTripped ?? "").includes("https://anyaparallax.co.uk/photo/rain-neon"),
    `the canonical URL did not survive ${channel} encoding: ${url}`,
  );
  check(
    !url.includes('"after') && !url.includes(" "),
    `the ${channel} URL is not fully encoded: ${url}`,
  );
}
check(shareUrlFor("native", target) === null, "native share should not produce an outbound URL");
check(shareUrlFor("copy_link", target) === null, "copy link should not produce an outbound URL");
check(
  shareUrlFor("pinterest", target)?.includes("media=") === true,
  "the Pinterest URL does not carry the public image",
);
check(
  shareUrlFor("email", target)?.startsWith("mailto:?") === true,
  "the email channel does not produce a mailto URL",
);

// The copy the UI may show. The rule is that no claim of an external outcome is
// ever permitted, and only a completed clipboard write may be called a success.
const allCopy = Object.values(SHARE_CHANNEL_LABELS).concat(
  (["nativeOpened", "nativeUnavailable", "outboundOpened", "linkCopied", "copyFailed"]).map((status) =>
    shareStatusMessage(status),
  ),
);
const forbiddenClaims = [
  /\bposted\b/i,
  /\btweet(ed)?\b/i,
  /\bshared successfully\b/i,
  /\bshare complete/i,
  /\bpublished to\b/i,
  /\bsent successfully\b/i,
];
for (const text of allCopy) {
  for (const claim of forbiddenClaims) {
    check(!claim.test(text), `UI copy claims an external outcome: ${JSON.stringify(text)}`);
  }
}
check(
  shareStatusMessage("linkCopied") === "Link copied.",
  "the only confirmable outcome is not stated plainly",
);
check(
  !/\bshare(s)?\b/i.test(SHARE_CHANNEL_LABELS.native.replace(/^Share$/, "")),
  "the native share label claims a result",
);
note(`share copy verified across ${allCopy.length} strings: no external outcome is ever claimed`);

// --- J. Same-origin guard -------------------------------------------------

const sameOrigin = new Request("https://anyaparallax.co.uk/engagement/x", {
  method: "POST",
  headers: { origin: "https://anyaparallax.co.uk" },
});
check(isSameOriginRequest(sameOrigin) === true, "a same-origin request was refused");
const crossOrigin = new Request("https://anyaparallax.co.uk/engagement/x", {
  method: "POST",
  headers: { origin: "https://evil.example" },
});
check(isSameOriginRequest(crossOrigin) === false, "a cross-origin request was allowed");
const noOrigin = new Request("https://anyaparallax.co.uk/engagement/x", { method: "POST" });
check(isSameOriginRequest(noOrigin) === false, "a request with no origin or referer was allowed");
const refererOnly = new Request("https://anyaparallax.co.uk/engagement/x", {
  method: "POST",
  headers: { referer: "https://anyaparallax.co.uk/photo/x" },
});
check(isSameOriginRequest(refererOnly) === true, "a same-origin referer was refused");
const badReferer = new Request("https://anyaparallax.co.uk/engagement/x", {
  method: "POST",
  headers: { referer: "not a url" },
});
check(isSameOriginRequest(badReferer) === false, "a malformed referer was accepted");

// --- K. Stored data holds nothing identifying -----------------------------

const likeColumns = database.query("SELECT * FROM likes LIMIT 1")[0] ?? {};
check(
  Object.keys(likeColumns).sort().join(",") === "browser_token,created_at,id,photo_id",
  `the likes table shape changed: ${Object.keys(likeColumns).join(", ")}`,
);
check(
  !("ip" in likeColumns) && !("user_agent" in likeColumns) && !("referrer" in likeColumns),
  "the likes table stores identity beyond the digest",
);

database.close();
note("likes: digest-only storage, uniqueness backstop held under concurrency, drafts refused");
report(
  "Engagement check passed: like/unlike persistence, duplicate mitigation under concurrency, package-private " +
    "identity with no request-characteristic input, allow-listed share channels, unconfirmed share events, " +
    "truthful share copy and the same-origin guard.",
);
