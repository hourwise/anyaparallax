# Anyaparallax V1 — polish pass copy changes (2026-09-23)

Every string this pass changed, with its glossary ID so it can be traced in
`DOCS/ANYAPARALLAX_V1_COPY_GLOSSARY.md`. To change a string again, reply with the ID and the
new wording, as the glossary describes.

## 1. Strings changed

### Photo page — like and share (`/photo/:slug`)

| ID | Old | New |
| --- | --- | --- |
| PUB-ENGAGE-001 | Photograph engagement *(group label)* | Like and share |
| PUB-ENGAGE-002 | Like *(visible button text)* | *(outline heart icon)* — accessible name "Like this photo" |
| PUB-ENGAGE-003 | Unlike *(visible button text)* | *(filled red heart icon)* — accessible name "Unlike this photo" |
| PUB-ENGAGE-004 | Working… | *(removed — the heart dims while saving)* |
| PUB-ENGAGE-005 | {n} like / {n} likes | {n} *(the word "like/likes" is now read to screen readers only)* |
| PUB-ENGAGE-024 | — | ", including yours" *(screen readers only, when you have liked it)* |
| PUB-ENGAGE-006 | Likes unavailable | *(removed — the count is omitted and PUB-ENGAGE-023 explains)* |
| PUB-ENGAGE-008 | More sharing options | Share |
| PUB-ENGAGE-009 | Hide sharing options | *(removed — the one Share button opens and closes the panel)* |
| PUB-ENGAGE-007 | Share *(opened the device share sheet)* | Other apps *(inside the panel, only where the device supports it)* |
| PUB-ENGAGE-010 | Link | Link to this photo |
| PUB-ENGAGE-011 | These open the service in a new tab. Nothing here confirms that a share was completed, and no count of shares is shown. | *(removed)* |
| PUB-ENGAGE-018 | Share panel opened. | Share menu opened. *(no longer displayed: the device's own sheet is the feedback)* |
| PUB-ENGAGE-019 | This browser cannot open a share panel. Use one of the options below. | Your device's share menu isn't available here. Try one of the other options. |
| PUB-ENGAGE-020 | Opened in a new tab. Complete the share there. | Opened in a new tab. |
| PUB-ENGAGE-022 | Could not copy automatically. Select the link and copy it manually. | Couldn't copy the link automatically. You can select it below and copy it yourself. |
| PUB-ENGAGE-023 | Likes are unavailable right now. Nothing is recorded and no count is shown. | Likes aren't available at the moment. Please try again later. |

Unchanged: Copy link, WhatsApp, Facebook, X, Pinterest, Email, and "Link copied." (which now
clears itself after three seconds).

### Privacy (`/privacy`)

| ID | Old | New |
| --- | --- | --- |
| SYS-META-023 | What this website stores when you send an enquiry or interact with a photograph, and what it deliberately does not collect. | What this site keeps when you send an enquiry or like a photo, the one small cookie it uses, and what it never collects. |
| PUB-PRIVACY-003 | What this site stores, why, and what it deliberately does not collect. Written to describe how the site actually works. | This is a photography site, not a data business. Here is what it keeps, why, and what it never collects. |
| PUB-PRIVACY-004 | To be completed before public launch | Details still to be confirmed |
| PUB-PRIVACY-005 | Three facts are the site owner's to decide, so they are shown here rather than guessed: the identity of the data controller, the retention period for enquiries, and the contact address for data requests. Replace this block with those details. | Before the site opens to the public, this page will also say who is responsible for your information, how long enquiries are kept, and where to write about your data. Until then, you can reach us through the contact form. |
| PUB-PRIVACY-029 | — | contact form *(link in the block above)* |
| PUB-PRIVACY-007 | The contact form and the print enquiry form ask for your name, your email address and your message, plus the category of enquiry and, for a print enquiry, the photograph and the format you are interested in. Those details are stored so the enquiry can be answered. | The contact form and the print enquiry form ask for your name, your email address and your message, and what the enquiry is about. For a print enquiry we also note the photo, and the format and size you're interested in. We keep these details so we can reply to you. *(now mentions print size, which was collected but not disclosed)* |
| PUB-PRIVACY-008 | The stored enquiry does not include your IP address, your browser or device details, the page you came from, or any identifier for your browser. The forms also carry a one-time submission token so that pressing send twice does not create two enquiries. | We don't keep your IP address, your browser or device details, the page you came from, or anything that identifies your browser alongside an enquiry. Each form also carries a one-off code so that pressing send twice doesn't send the same enquiry twice. |
| PUB-PRIVACY-009 | Enquiries are read only in the site's private operator area, behind Cloudflare Access. | Enquiries can only be read in the site's private management area, which is protected by Cloudflare Access. |
| PUB-PRIVACY-024 | The engagement cookie | The one cookie we use |
| PUB-PRIVACY-025 | To stop the same browser counting the same like twice, this site sets one first-party cookie called `anyaparallax_browser`. It holds a random value generated by this site. It is marked HttpOnly, … it is not used for anything else. | The first time you like a photo, the site sets a single cookie called `anyaparallax_browser`. It holds a random value, and its only job is to make sure the same browser can't like the same photo twice. It belongs to this site alone and isn't shared with anyone. |
| PUB-PRIVACY-026 | The value is not derived from your IP address, … it stores a one-way SHA-256 digest of it, … a new one is generated the next time you like a photograph. | The value is not derived from your IP address, your device, the page you came from or anything you type. We don't even store the value itself: the database keeps a scrambled, one-way version of it (a SHA-256 digest), which is enough to spot a repeat like and can't be turned back into the cookie. |
| PUB-PRIVACY-027 | — *(the technical attributes were inside PUB-PRIVACY-025)* | For the technically curious: the cookie is HttpOnly (scripts on the page can't read it), SameSite=Lax, Secure on encrypted connections, and it lasts up to 400 days. If you clear your cookies it's gone, and a new one is only created if you like a photo again. |
| PUB-PRIVACY-028 | — | Sharing *(subheading)* |
| PUB-PRIVACY-012 | When you use a share control, this site records that a share action was started and which channel you chose. It cannot see whether the share completed, and it does not send anything to those services on your behalf. | When you use one of the share buttons, the site notes which photo and which option you picked, and nothing about you. It can't see whether you went on to post or send anything, and it never posts anything on your behalf. |
| PUB-PRIVACY-013 | What this site does not do | What we don't do |
| PUB-PRIVACY-015 | No IP address, user agent or referrer is stored with any visitor action. | No record of your IP address, browser or the page you came from. |
| PUB-PRIVACY-016 | No fingerprinting, and no attempt to recognise a device across sites. | No fingerprinting, and no following you from site to site. |
| PUB-PRIVACY-017 | No account is needed to browse, like or share. | No account needed to browse, like or share. |
| PUB-PRIVACY-018 | No analytics, advertising or profiling cookie is set, and no cookie is required to browse the site. | No analytics, advertising or profiling cookies. You don't need to accept any cookie to browse the site. |
| PUB-PRIVACY-019 | Operator sign-in | The management area |
| PUB-PRIVACY-020 | The site's own management areas are protected by Cloudflare Access. Only the people the site owner has authorised can reach them, and this site never sees or stores their passwords. Visitors are unaffected by that arrangement. | The parts of the site used to manage photos and enquiries are protected by Cloudflare Access, so only people the site owner has approved can get in. This site never sees or stores their passwords. None of this affects visitors. |
| PUB-PRIVACY-022 | To ask about an enquiry you have sent, or to ask for it to be corrected or removed, use the contact form and say what you would like done. No public email address is published on this site. | If you'd like to ask about an enquiry you've sent, or have it corrected or deleted, just send a message through the contact form and let us know. There's no public email address on the site. |
| PUB-PRIVACY-023 | contact form | contact form *(unchanged link text; the glossary row was stale and said "contact page")* |

Unchanged: the page title and headings "Privacy", "When you send an enquiry", "Likes and
shares", "Questions or requests", and "No third-party analytics, advertising or tracking scripts."

### Admin dashboard (`/admin`)

| ID | Old | New |
| --- | --- | --- |
| ADM-DASH-015 | Share actions initiated | Shares started |
| ADM-DASH-016 | No likes or shares recorded yet. Both appear here once visitors use the controls on a photograph's page. | No likes or shares yet. They'll show up here once visitors start using the heart and share buttons on your photographs. |
| ADM-DASH-020 *(values)* | copy_link, whatsapp, native, … *(raw stored keys)* | Copy link, WhatsApp, Other apps, … *(the public labels)* |
| ADM-DASH-030 | Upload originals, generate derivatives and watermarks. | Add new photographs. Web sizes and watermarks are made for you. |

### Enquiries (`/admin/enquiries`)

| ID | Old | New |
| --- | --- | --- |
| ADM-ENQ-003 | Print enquiries and contact messages, newest first. Reply from your own email; this application does not send mail itself. | Print enquiries and contact messages, newest first. To reply, click the sender's email address: replies go from your own email, as the site doesn't send email itself. |
| ADM-ENQ-008 | No enquiries have been received yet. *(muted line)* | No enquiries yet. When someone gets in touch through the contact form or asks about a print, their message will appear here. *(shown as a calm notice panel)* |

### Manager dashboard (`/manager`)

| ID | Old | New |
| --- | --- | --- |
| MGR-DASH-003 | Functional foundations for maintenance: live binding, storage and identity state from this deployment, plus the authorised users who can sign in. | A quick look at how the site is running, and who can sign in to manage it. |
| MGR-DASH-007 | Authorised users | Who can sign in |
| MGR-DASH-008 | Roles are read from the database on every request. A photographer signs into /admin only; managers may use both areas. | Photographers can use the photography workspace at /admin. Managers can use that and this area too. Role changes take effect straight away. |
| MGR-DASH-009 | Authorised-user directory | People who can sign in |
| MGR-DASH-015 | Technical areas | More tools |
| MGR-DASH-017 | — bindings, object counts and configuration state | — a detailed technical health check, for troubleshooting |
| MGR-DASH-019 | — application accounts and this deployment's state | — add people, change roles and review how the site is set up |
| MGR-DASH-021 | — integrity checks and stored-object reporting | — check that stored photos and records are in good order |

### Diagnostics (`/manager/diagnostics`)

| ID | Old | New |
| --- | --- | --- |
| MGR-DIAG-002 | Deployment state | Technical health check |
| MGR-DIAG-003 | Counts come from the live bindings on this request. Configuration is reported as present or absent; no secret, token, key or environment value is read or shown. | A detailed view for troubleshooting. Counts are read live, and each setting is only shown as present or missing. No passwords, keys or other secret values appear here. |

The diagnostics table rows themselves (binding names, `ALLOW_DEVELOPMENT_*` switches) were left
technical on purpose: this page exists for troubleshooting.

### Manager settings (`/manager/settings`)

| ID | Old | New |
| --- | --- | --- |
| MGR-SETTINGS-003 | Who may use the operator areas, and what this deployment has configured. Cloudflare Access decides who can reach the site; this list decides what they may do inside it. | Who can use the management areas, and how the site is set up. Cloudflare Access controls who can reach these areas at all; this list controls what each person can do once they're in. |
| MGR-SETTINGS-015 | There must always be at least one active manager: the last one cannot be deactivated or demoted. | The site always needs at least one active manager, so the last one can't be deactivated or given a different role. |
| MGR-SETTINGS-016 | Add an authorised address | Add someone by email address |
| MGR-SETTINGS-020 | Deployment state | Site setup |
| MGR-SETTINGS-021 | Read from this deployment's configuration. Values are not displayed: no audiences, account details or credentials appear here, and none of it is editable. | For reference only. Each item shows whether it's set up, never its actual value, and nothing here can be changed from this page. The three development-only settings at the bottom should all say "no" on the live site. |
| MGR-SETTINGS-023 | Operator identity mode | Sign-in method |
| MGR-SETTINGS-024 | Cloudflare Access configured | Cloudflare Access set up |
| MGR-SETTINGS-025 | Canonical public origin configured | Public web address set |
| MGR-SETTINGS-026 | Database binding present | Database connected |
| MGR-SETTINGS-027 | Private masters bucket bound | Original photo storage connected |
| MGR-SETTINGS-028 | Public derivatives bucket bound | Public image storage connected |
| MGR-SETTINGS-029 | Image processing binding present | Image processing connected |
| MGR-SETTINGS-030 | Development identity enabled | Test sign-in (development only) |
| MGR-SETTINGS-031 | Development seed fallback enabled | Sample content fallback (development only) |
| MGR-SETTINGS-032 | Development notices enabled | Preview notices (development only) |
| MGR-SETTINGS-037 | {email} now has the {role} role, once Cloudflare Access admits that address. | Added. {email} now has the {role} role and can sign in once Cloudflare Access lets that address in. |
| MGR-SETTINGS-038 | {email} is already an authorised account. | {email} already has access. |

### Maintenance (`/manager/maintenance`)

| ID | Old | New |
| --- | --- | --- |
| MGR-MAINT-003 | Read-only integrity checks over the stored data and the storage bindings. Nothing on this page changes anything. | A quick check that the stored photos and records are all in order. This page only looks; it never changes anything. |
| MGR-MAINT-004 | Every check passed: the stored data is internally consistent. | All checks passed. Everything is in order. |
| MGR-MAINT-005 | {n} check(s) need attention — see below. Nothing has been changed automatically. *(said "1 check need attention")* | One check needs / {n} checks need a look. The details are below, and nothing has been changed automatically. |
| MGR-MAINT-006 | Stored records | What is stored |
| MGR-MAINT-009 | Authorised accounts — {n} ({m} active manager(s)) | People with access — {n} ({m} active manager / managers) |
| MGR-MAINT-015 | Share events | Shares started |
| MGR-MAINT-042 | Stored objects | Image files |
| MGR-MAINT-044 | Photographs inspected | Photos checked |
| MGR-MAINT-053 | Objects reported missing so far | Files missing so far |
| MGR-MAINT-045 | Private masters missing | Originals missing |
| MGR-MAINT-046 | Web derivatives missing | Web-sized images missing |
| MGR-MAINT-050 | Destructive tools | Deleting and resetting |
| MGR-MAINT-051 | There are none, by design. Nothing here resets data, purges derivatives or deletes accounts: those operations would risk an archive that has no backup, and no part of V1 needs them. Unpublishing a photograph or a gallery is the reversible withdrawal mechanism, and it lives on those screens. | There are no delete or reset tools here, on purpose. The photo archive has no separate backup, so one wrong click could lose work for good. To take something off the public site, unpublish the photo or gallery from its own page instead; that can always be undone. |

## 2. Prominent copy still worth an editorial look

Not changed in this pass: the wording is accurate, but it may not yet be the owner's voice.

| Where | Current text | Why |
| --- | --- | --- |
| `/photo/:slug` print note (PUB-PHOTO) | Print enquiries are answered personally. There is no basket, checkout or payment on this site. | Accurate for V1, but a little defensive. Consider something like "Prints are arranged personally — send an enquiry and we'll be in touch." |
| Maintenance findings (MGR-MAINT-024 … 041, 048) | e.g. "{n} gallery(ies) have a cover that is not one of their own photographs." | Still uses "(s)"/"(ies)" plurals and database terms ("tag link(s)", "like row(s)", "storage keys"). Only shown when something is wrong. |
| Maintenance storage notes (MGR-MAINT-048, -049) | "Checked the most recent {n} photograph(s). Missing objects are counted, never listed." / "Storage bindings are not both present…" | Technical; fine for a manager, and could be softened later. |
| Diagnostics table (MGR-DIAG-011 … 051) | "ALLOW_DEVELOPMENT_IDENTITY", "binding missing", "D1 users table" … | Left technical on purpose, because it is the troubleshooting page. |
| Store-unavailable reasons (SYS-AREA-*) | e.g. "No database is configured in this environment, so …" | These only appear on a misconfigured deployment. They are accurate but sound like engineer's wording. |
| Manager settings role column / select (MGR-SETTINGS) | Shows raw role keys `photographer` / `manager` | The add-person form uses the friendly `ROLE_LABELS`; the table and per-row select do not. |
| Admin dashboard eyebrow (ADM-DASH-001) | Signed in as {user.role} | Shows the raw role key. |
| Photograph/upload validation messages (SYS-UPLOADVAL-*) | Various | Flagged REVIEW in the glossary before this pass; not revisited. |
| Home, galleries, about introductions (PUB-HOME-014, PUB-GALLERIES-004, PUB-GALLERY-005, PUB-ABOUT-003) | Placeholder-style lines | Still flagged REWRITE_RECOMMENDED in the glossary. Most can be overridden from admin Settings → Introductions. |

## 3. Facts awaiting the owner's confirmation

These cannot be written by anyone but the site owner. The privacy page shows a visible
"Details still to be confirmed" block until they are supplied.

1. **Who the data controller is**: the person or business responsible for visitors' information.
2. **How long enquiries are kept**: a retention period, for example "12 months after we last reply". Note the site has no automatic deletion, so any period promised here would have to be carried out by hand, or built in V2.
3. **Where to write about data**: an address or contact route for data requests. The page currently points to the contact form, and no public email address is published.
4. **Legal review of the privacy notice**: the rewrite is plain English and matches the code, but it has not been reviewed by a lawyer. The glossary keeps every privacy row flagged `LEGAL/PRIVACY_REVIEW`.
5. **Operator content** already flagged `OPERATOR_CONTENT_REQUIRED` in the glossary (about page, home introductions, social profiles, photo captions) is unchanged by this pass.

When the owner supplies items 1–3, replace the block in `app/routes/privacy.tsx` and update the
heading check in `scripts/checks/check-v1-completion-served.mjs` in the same change.
