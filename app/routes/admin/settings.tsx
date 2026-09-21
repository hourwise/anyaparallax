import type { MetaFunction } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { requireAdminAccess } from "../../auth/authorization.server";
import { appEnvironmentFrom } from "../../data/context.server";
import {
  SOCIAL_NETWORKS,
  SITE_SETTING_KEYS,
  TEXT_SETTING_FIELDS,
  WATERMARK_DEFAULT_LABELS,
  WATERMARK_DEFAULT_STATES,
  WATERMARK_POSITION_LABELS,
  validateSiteSettings,
} from "../../data/site-settings";
import {
  readPublicSiteSettings,
  readSiteSettingRows,
  writeSiteSettings,
} from "../../data/site-settings.server";
import { parseTagIntent } from "../../data/taxonomy";
import { managedTagsView, taxonomyManagerFor } from "../../data/taxonomy.server";
import { WATERMARK_POSITIONS } from "../../images/image-processor";
import { isSameOriginRequest, refuseCrossOriginRequest } from "../../lib/same-origin";

export const meta: MetaFunction = () => [
  { title: "Settings — Anyaparallax admin" },
  { name: "robots", content: "noindex, nofollow" },
];

/**
 * Anya's workspace settings.
 *
 * This replaced a "Not built yet" placeholder whose own text promised exactly these
 * controls. It holds what an operator needs to run the site without a developer: the
 * watermark defaults future uploads inherit, the social profiles the footer may link
 * to, a small set of public introduction fields, and the tag list.
 *
 * WHAT IS NOT HERE, ON PURPOSE: infrastructure. Buckets, bindings, Access audiences,
 * account details and secrets are deployment state; the manager-facing summary reports
 * their PRESENCE and never makes them editable.
 *
 * Every intent follows authorization → same-origin → body → validation → mutation.
 */
export async function loader({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  const env = appEnvironmentFrom(context);
  const [rows, settings, tags] = await Promise.all([
    readSiteSettingRows(env),
    readPublicSiteSettings(env),
    managedTagsView(env),
  ]);
  return {
    values: {
      watermarkEnabled: settings.watermarkDefaultEnabled ? "enabled" : "disabled",
      watermarkPosition: settings.watermarkDefaultPosition,
      text: Object.fromEntries(
        TEXT_SETTING_FIELDS.map((field) => [field.key, rows[field.key] ?? ""]),
      ) as Record<string, string>,
      social: Object.fromEntries(
        SOCIAL_NETWORKS.map((network) => [network.key, rows[network.key] ?? ""]),
      ) as Record<string, string>,
    },
    tags,
  };
}

type ActionData = {
  readonly message: string;
  readonly tone: "ok" | "warning";
  readonly errors?: Record<string, string>;
};

function refused(errors: Record<string, string>): ActionData {
  return {
    message: Object.values(errors)[0] ?? "That request was not understood, so nothing was changed.",
    tone: "warning",
    errors,
  };
}

export async function action({ request, context }: { request: Request; context: unknown }) {
  await requireAdminAccess(request, context);
  if (!isSameOriginRequest(request)) {
    throw refuseCrossOriginRequest();
  }
  const env = appEnvironmentFrom(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "settings");

  if (intent === "settings") {
    const validation = validateSiteSettings({
      watermarkEnabled: form.get("watermarkEnabled"),
      watermarkPosition: form.get("watermarkPosition"),
      text: Object.fromEntries(TEXT_SETTING_FIELDS.map((field) => [field.key, form.get(field.key)])),
      social: Object.fromEntries(
        SOCIAL_NETWORKS.map((network) => [network.key, form.get(network.key)]),
      ),
    });
    if (!validation.ok) {
      return refused(validation.errors);
    }
    const entries = [
      [
        SITE_SETTING_KEYS.watermarkEnabled,
        validation.values.watermarkEnabled ? "enabled" : "disabled",
      ] as const,
      [SITE_SETTING_KEYS.watermarkPosition, validation.values.watermarkPosition] as const,
      ...TEXT_SETTING_FIELDS.map(
        (field) => [field.key, validation.values.text[field.key] ?? ""] as const,
      ),
      ...SOCIAL_NETWORKS.map(
        (network) => [network.key, validation.values.social[network.id] ?? ""] as const,
      ),
    ];
    const written = await writeSiteSettings(env, entries);
    if (!written.ok) {
      return { message: `${written.reason} Nothing was changed.`, tone: "warning" as const };
    }
    return {
      message:
        "Settings saved. Watermark defaults apply to future uploads; photographs you have already uploaded are unchanged.",
      tone: "ok" as const,
    };
  }

  const tagIntent = parseTagIntent(intent.replace("tag-", ""));
  const manager = taxonomyManagerFor(env);
  if (!tagIntent || !manager) {
    return {
      message: "That action was not recognised, so nothing was changed.",
      tone: "warning" as const,
    };
  }
  const tagId = String(form.get("tagId") ?? "");

  if (tagIntent === "create") {
    const result = await manager.create(form.get("name"));
    if (result.status === "ok") {
      return { message: `Added the tag “${result.persisted.name}”.`, tone: "ok" as const };
    }
    if (result.status === "duplicate") {
      return refused({ name: `“${result.name}” is already a tag.` });
    }
    return result.status === "bad-request"
      ? refused({ name: result.error })
      : { message: "The tag could not be saved, so nothing was changed.", tone: "warning" as const };
  }

  if (tagIntent === "rename") {
    const result = await manager.rename(tagId, form.get("name"));
    if (result.status === "ok") {
      return { message: `Renamed the tag to “${result.persisted.name}”.`, tone: "ok" as const };
    }
    if (result.status === "duplicate") {
      return refused({ name: `Another tag is already called “${result.name}”.` });
    }
    return result.status === "bad-request"
      ? refused({ name: result.error })
      : { message: "That tag no longer exists, so nothing was changed.", tone: "warning" as const };
  }

  const result = await manager.deleteUnused(tagId);
  if (result.status === "ok") {
    return { message: `Deleted the unused tag “${result.persisted.name}”.`, tone: "ok" as const };
  }
  if (result.status === "in-use") {
    const count = result.usageCount;
    return {
      message: `${count} photograph${count === 1 ? "" : "s"} still use that tag, so it was not deleted. Remove it from those photographs first.`,
      tone: "warning" as const,
    };
  }
  return { message: "That tag no longer exists, so nothing was changed.", tone: "warning" as const };
}

export default function AdminSettingsRoute() {
  const { values, tags } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const busy = useNavigation().state !== "idle";

  return (
    <section className="page">
      <header className="page__header">
        <p className="eyebrow">Workspace</p>
        <h1>Settings</h1>
        <p className="lede">
          Defaults and public details for your site. Anything left blank is simply not shown.
        </p>
      </header>

      {actionData ? (
        <p
          className={actionData.tone === "ok" ? "notice notice--ok" : "notice notice--warning"}
          role="status"
        >
          {actionData.message}
        </p>
      ) : null}

      <Form method="post" className="stack-form">
        <input type="hidden" name="intent" value="settings" />

        <section className="workspace-block" aria-labelledby="watermark-defaults-heading">
          <h2 id="watermark-defaults-heading">Watermark defaults</h2>
          <p className="field-help">
            These apply to future uploads. A photograph's own setting always wins, and nothing
            already uploaded changes.
          </p>
          <fieldset className="fieldset">
            <legend>New uploads</legend>
            {WATERMARK_DEFAULT_STATES.map((state) => (
              <label className="checkbox" key={state}>
                <input
                  type="radio"
                  name="watermarkEnabled"
                  value={state}
                  defaultChecked={values.watermarkEnabled === state}
                />
                {WATERMARK_DEFAULT_LABELS[state]}
              </label>
            ))}
          </fieldset>
          {actionData?.errors?.["watermarkEnabled"] ? (
            <p className="field-error">{actionData.errors["watermarkEnabled"]}</p>
          ) : null}
          <label htmlFor="watermarkPosition">Default watermark position</label>
          <select id="watermarkPosition" name="watermarkPosition" defaultValue={values.watermarkPosition}>
            {WATERMARK_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {WATERMARK_POSITION_LABELS[position]}
              </option>
            ))}
          </select>
          {actionData?.errors?.["watermarkPosition"] ? (
            <p className="field-error">{actionData.errors["watermarkPosition"]}</p>
          ) : null}
        </section>

        <section className="workspace-block" aria-labelledby="social-heading">
          <h2 id="social-heading">Social profiles</h2>
          <p className="field-help">
            Paste the full https:// address for each profile you use. Leave the rest blank and no
            link appears anywhere on the public site.
          </p>
          {SOCIAL_NETWORKS.map((network) => (
            <div key={network.id}>
              <label htmlFor={network.key}>{network.label}</label>
              <input
                id={network.key}
                name={network.key}
                type="url"
                inputMode="url"
                placeholder="https://…"
                defaultValue={values.social[network.key] ?? ""}
              />
              {actionData?.errors?.[network.key] ? (
                <p className="field-error">{actionData.errors[network.key]}</p>
              ) : null}
            </div>
          ))}
        </section>

        <section className="workspace-block" aria-labelledby="copy-heading">
          <h2 id="copy-heading">Introductions</h2>
          <p className="field-help">
            Short optional text shown on the public pages. A blank field renders nothing at all.
          </p>
          {TEXT_SETTING_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key}>{field.label}</label>
              <textarea
                id={field.key}
                name={field.key}
                rows={2}
                maxLength={field.limit}
                defaultValue={values.text[field.key] ?? ""}
              />
              {actionData?.errors?.[field.key] ? (
                <p className="field-error">{actionData.errors[field.key]}</p>
              ) : null}
            </div>
          ))}
        </section>

        <button type="submit" disabled={busy}>
          Save settings
        </button>
      </Form>

      <section className="workspace-block" aria-labelledby="tags-heading">
        <h2 id="tags-heading">Tags</h2>
        <p className="field-help">
          Tags group photographs across galleries. They appear on a photograph's page and can be
          browsed by visitors.
        </p>
        {!tags.available ? (
          <p className="notice notice--warning">{tags.reason}</p>
        ) : (
          <>
            {tags.tags.length === 0 ? (
              <p className="notice">No tags yet. Add the first one below.</p>
            ) : (
              <ul className="tag-admin-list">
                {tags.tags.map((tag) => (
                  <li key={tag.id} className="tag-admin-item">
                    <Form method="post" className="inline-form">
                      <input type="hidden" name="intent" value="tag-rename" />
                      <input type="hidden" name="tagId" value={tag.id} />
                      <label htmlFor={`tag-${tag.id}`}>Tag name</label>
                      <input
                        id={`tag-${tag.id}`}
                        name="name"
                        type="text"
                        defaultValue={tag.name}
                        maxLength={40}
                      />
                      <button type="submit" disabled={busy}>
                        Rename
                      </button>
                      <span className="field-help">
                        used by {tag.usageCount} photograph{tag.usageCount === 1 ? "" : "s"}
                      </span>
                    </Form>
                    {tag.usageCount === 0 ? (
                      <Form method="post" className="inline-form">
                        <input type="hidden" name="intent" value="tag-delete" />
                        <input type="hidden" name="tagId" value={tag.id} />
                        <button type="submit" disabled={busy}>
                          Delete unused tag
                        </button>
                      </Form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <Form method="post" className="stack-form">
              <input type="hidden" name="intent" value="tag-create" />
              <label htmlFor="new-tag-name">Add a tag</label>
              <input id="new-tag-name" name="name" type="text" maxLength={40} required />
              {actionData?.errors?.["name"] ? (
                <p className="field-error">{actionData.errors["name"]}</p>
              ) : null}
              <button type="submit" disabled={busy}>
                Add tag
              </button>
            </Form>
          </>
        )}
      </section>
    </section>
  );
}
