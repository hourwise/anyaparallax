# Anyaparallax V1 launch-content changes

This document records the launch decisions supplied by Anya and the operator, the previous V1 state, and the implemented launch state. It describes product behavior, not deployment authority.

| Anya/operator decision | Previous wording or behavior | V1 launch wording or behavior |
| --- | --- | --- |
| Lowercase public identity | “Anyaparallax Photography” | `anyaparallax`; no surname is published. |
| Homepage | Multi-word city/night headline plus a newest/recent section | “A shift in focus”; manually featured work remains the homepage authority and the newest-first section is not rendered. |
| About | Provisional biography and portrait placeholder | Approved first-person biography; editable display name, role, location, strapline, biography and portrait alt text; optional portrait upload/change/remove. |
| Gallery structure | Flat photograph grid with a visible title below every thumbnail | Optional ordered series inside each gallery; title-free clickable thumbnails; unassigned photographs appear last under “More” only when needed. |
| Likes | Public heart, count and first-party anti-duplicate cookie on use | Disabled by default and settings-gated at UI and endpoint; sharing stays available; no like cookie is created while disabled. |
| Social | Optional supported links with no approved launch value | Canonical Instagram default `https://www.instagram.com/anyaparallax/`; Pinterest, Snapchat and WhatsApp are optional validated settings. |
| Contact | Generic contact heading and no public email | “Work with me”, approved friendly work copy, and `contact@anyaparallax.co.uk`. |
| Prints | Technical no-commerce framing led the page | Friendly enquiry-only copy; no public price, basket, checkout, payment or order state; per-photo CTA “Available as a print — enquire”. |
| Copyright | Dynamic year and mixed-case photography brand | `© 2026 anyaparallax`; “All photographs are copyright © anyaparallax unless otherwise stated.”; understated PCGSoft credit retained. |
| Privacy | Controller, contact and retention unresolved; like cookie described as active | Phil at PCGSoft on behalf of anyaparallax; `phil@pcgsoft.co.uk`; six-month enquiry retention; conditional likes/cookie wording. |
| Retention operations | Enquiries could be marked but not removed | Same-origin, authorised, confirmed individual deletion plus a read-only “older than six months” indicator. |
| Visual system | Warm red accent, mixed serif/sans identity and small decorative transitions | Monochrome white/grey controls, Courier New identity/UI typography, readable system sans for long prose, no decorative motion. |

## Intended launch galleries

The operator can create and order these through `/admin/galleries`; they are not seeded into production: Live Music, Car Shows, Travels, Nature & Landscape, Pet Portraits, Acting Headshots, Events, Black & White.

## Watermark

New photograph uploads default to watermarking at bottom right. The current pipeline still uses the existing replaceable overlay asset. The final artwork should say `anyaparallax`; the code does not fabricate a substitute raster wordmark. About portraits are not watermarked.

## Print format vocabulary

The current database allow-list safely stores photographic, fine-art and framed-print preferences plus “no preference”. Canvas and poster were not added in this launch migration because widening the existing SQLite column constraint requires a table rebuild. Public wording therefore remains truthful and generic; canvas/poster vocabulary is deferred rather than claimed by a form that cannot persist it.
