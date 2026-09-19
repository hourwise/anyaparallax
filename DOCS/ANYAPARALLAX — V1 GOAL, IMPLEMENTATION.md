# ANYAPARALLAX — V1 GOAL, IMPLEMENTATION AND SUPERVISION SPECIFICATION

Status: IMPLEMENTATION READY  
Project: Anyaparallax Photography  
Primary release: V1 Photography Portfolio  
Target: Weekend V1 build  
Future release: V2 Print Sales / Commerce  
Publication state: AUTHORIZATION_ONLY_NO_PUBLICATION

---

# 1. PURPOSE

Build the first production-ready version of **Anyaparallax**, an independent photography portfolio for Anya.

The site should showcase photography centred around:

- city nightlife
- rain-washed streets
- neon signs
- street lighting
- car tail lights
- night cityscapes
- live music
- bands
- musicians
- gigs
- crowds
- nightclubs
- events
- car shows
- people
- candid street photography
- monochrome photography

The site should feel cinematic, editorial, dark, atmospheric and photographic.

The design direction takes inspiration from the simplicity and image-first presentation of Pixieset's Berlin-style portfolio, but Anyaparallax must establish its own identity.

The photography must remain the dominant visual element.

V1 must also provide Anya with a straightforward administration system for managing her own photography.

A separate, higher-authority Manager interface must exist for site development, testing, diagnostics and maintenance.

V1 must deliberately prepare the architecture for V2 print sales without prematurely implementing full ecommerce.

---

# 2. PRIMARY V1 GOAL

A successful V1 allows Anya to:

1. Authenticate independently using her own identity.
2. Enter `/admin`.
3. Upload one or more high-resolution photographs.
4. Add or edit:
   - title
   - description
   - gallery
   - tags
   - location
   - capture date
5. Select:
   - watermark on/off
   - watermark position
   - publish/unpublish
   - featured/not featured
6. Submit the upload.
7. Preserve the untouched original photograph privately.
8. Automatically produce an appropriate public web derivative.
9. Produce an appropriate gallery thumbnail.
10. Apply watermarking only to the public derivative.
11. Publish the photograph into the selected galleries.
12. Give the photograph its own permanent public URL.
13. Allow visitors to:
    - view it
    - like it
    - share it
    - copy its link
    - enquire about it where appropriate
14. Produce professional social-media preview metadata when its URL is shared.

A successful V1 also allows the Manager to:

1. Authenticate independently using a separate Manager identity.
2. Enter `/manager`.
3. Perform all appropriate photography-management functions.
4. Access higher-authority:
   - maintenance
   - diagnostics
   - testing
   - configuration
   - health/status information
5. Maintain the site without ever needing access to Anya's email account or credentials.

---

# 3. V1 PRODUCT PRINCIPLE

V1 is primarily:

**Portfolio + Audience + Administration**

It is not yet:

**Full Ecommerce**

The goal is to make Anyaparallax a polished, useful photography website rather than a partially completed shop.

---

# 4. V1 NON-GOALS

Do NOT expand V1 into a full commerce platform.

The following are deferred unless separately authorised:

- live Stripe checkout
- PayPal checkout
- customer accounts
- customer login
- shopping basket
- payment capture
- shipping calculation
- tax/VAT automation
- print-laboratory integration
- automated print fulfilment
- inventory management
- discount systems
- refunds system
- full order-management workflow
- automated Instagram posting
- automated TikTok posting
- automated Facebook posting
- complex analytics
- visitor tracking platforms
- comments
- followers
- mobile applications
- AI image generation
- AI photo classification
- multi-photographer SaaS functionality

V1 may contain structures that allow these features to be added cleanly later.

---

# 5. BRAND

Public brand:

**Anyaparallax**

Secondary treatment where suitable:

**PHOTOGRAPHY**

The final purchased domain will use the Anyaparallax identity.

Do not hard-code an assumed domain before the operator provides the final domain.

Use configuration/environment variables where appropriate.

---

# 6. VISUAL DIRECTION

The public site should feel:

- dark
- cinematic
- atmospheric
- editorial
- urban
- modern
- minimal
- photographic

Primary surfaces:

- black
- near-black
- charcoal

Primary typography:

- white
- off-white

Secondary typography:

- subdued grey

Most colour should come from the photographs.

Possible accent colours may derive from:

- neon red
- warm amber
- gig lighting
- reflected city lights

Do not turn the interface into a cyberpunk UI.

Avoid:

- excessive glow
- excessive gradients
- gaming-style UI
- busy animations
- unnecessary decoration

This is a photographer's portfolio.

The interface exists to support the photography.

---

# 7. PHOTOGRAPHIC MOOD

The visual system should complement photographs containing:

- wet pavements
- rain
- reflected lights
- neon signs
- red tail lights
- headlights
- streetlights
- nightclub lighting
- stage lighting
- smoke/haze
- silhouettes
- bands
- musicians
- crowds
- cars
- architecture
- blue hour
- darkness
- strong shadows
- monochrome scenes

---

# 8. TYPOGRAPHY

Use a restrained typography system.

Suitable combination:

- elegant serif/display treatment for selected branding/headlines
- highly legible sans-serif for UI/navigation

Do not use typography that competes with the photographs.

---

# 9. RESPONSIVE DESIGN

Mobile is a first-class platform.

The application must work well on:

- Android phones
- iPhones
- tablets
- laptops
- desktop displays

Primary physical mobile test device available to the operator:

**Samsung Galaxy S24 Ultra**

Do not simply compress the desktop interface onto mobile.

Mobile interaction should be designed intentionally.

---

# 10. PUBLIC SITE STRUCTURE

Expected public routes:

```text
/
 /galleries
 /gallery/[slug]
 /photo/[slug]
 /about
 /prints
 /contact
Protected application routes:

/admin
/admin/photos
/admin/upload
/admin/galleries
/admin/settings

/manager
/manager/diagnostics
/manager/settings
/manager/maintenance

Exact child routes may change if the selected framework has a better clean structure.

Record meaningful deviations.

11. GLOBAL PUBLIC NAVIGATION

Primary navigation:

Home
Galleries
Prints
About
Contact

Also support:

social links
suitable mobile navigation
search later if genuinely justified

Do not overload primary navigation.

12. HOMEPAGE

The homepage should make an immediate visual impact.

Hero

Use a large atmospheric photograph.

Initial headline direction:

CITIES
PEOPLE
MUSIC
MOMENTS

Supporting direction:

Street photography, live music
and the energy of the night.

Primary action:

EXPLORE GALLERIES

Treat supplied copy as provisional until Anya approves final wording.

13. HOMEPAGE CONTENT
Featured Work

Strong editorial presentation.

Prefer irregular/masonry photography presentation over a generic social-media grid.

Explore Galleries

Initial example galleries:

Nightlife
Live Music
Cityscapes
Cars
People
Black & White

These must become database-driven.

Do not permanently hard-code the initial gallery list.

Latest

Recently published photographs.

About

Short introduction to Anya linking to /about.

Social

Links to Anya's social accounts once supplied.

Footer

Include:

Anyaparallax Photography
copyright
navigation
social links
contact
14. GALLERY SYSTEM

Photography should fill most of the gallery interface.

Support multiple orientations without excessive cropping.

Prefer an editorial or masonry presentation where appropriate.

Administrator must eventually be able to create additional galleries without source-code modification.

Initial suggested galleries:

Nightlife
Live Music
Cityscapes
Cars
People
Black & White
15. TAGGING

Photos can belong to galleries and independently have multiple tags.

Example tags:

Liverpool
Manchester
London
Gig
Band
Crowd
Night
Rain
Neon
Cars
Portrait
Club
Street
Black & White

The same physical photo must not need duplication merely to appear under multiple classifications.

16. INDIVIDUAL PHOTO PAGE

Every published photograph requires its own stable public page.

Example:

/photo/lost-in-the-music

Provide:

large photograph
title
optional description
gallery
relevant tags
optional location
optional date
like button
like count
share action
copy-link action
previous/next navigation where useful
print/enquiry state where applicable

Metadata must not overwhelm the image.

17. LIKES

Visitors should be able to like photographs without creating an account.

V1 likes are lightweight engagement rather than secure voting.

Requirements:

no account required
persistent aggregate count
prevent obvious repeated likes from one browser
unlike support if practical
no browser fingerprinting
minimum personal data collection

A generated anonymous browser identifier or similar lightweight mechanism is acceptable.

18. SHARING

Sharing is a core V1 capability.

Use the Web Share API where supported.

Fallback actions may include:

Copy Link
WhatsApp
Facebook
X
Pinterest
email

Do not claim external capabilities that a platform does not actually provide.

19. SHARE METRICS

The application may record that a share interaction was initiated.

It must not falsely claim that a visitor completed an external social post unless the external service actually confirms it.

Distinguish:

share initiated

from:

external publication confirmed

V1 will normally only know the former.

20. SOCIAL PREVIEW METADATA

Every public photograph page should support appropriate metadata including:

page title
description
canonical URL
OpenGraph title
OpenGraph description
OpenGraph image
social-card metadata

Do not use the private print-quality master as the social preview asset.

21. ABOUT PAGE

Create a photography-focused About page.

Visual direction:

photographer portrait/image if supplied
short biography
selected supporting photographs

Provisional wording direction:

I'm Anya — a photographer drawn to the energy of cities, live music, cars and the moments that happen after dark.

Possible brand line:

Same streets. Different stories.

These remain placeholders until approved.

22. CONTACT / ENQUIRIES

Provide a simple customer enquiry path.

Suggested enquiry categories:

Band / Artist Photography
Gig Photography
Event Photography
Car Photography
Print Enquiry
Other

Minimum fields:

name
email
enquiry type
message

Protect against obvious automated abuse.

Destination email requires operator input.

23. PRINTS — V1

The /prints route must exist.

V1 should present the future print offer professionally without pretending that live ecommerce is available.

Example direction:

FINE ART PRINTS

Bring the city to your walls.

V1 may present:

selected print-eligible photography
possible format information
possible size information
print enquiry
register-interest functionality

Do not process live payment in V1.

Do not falsely show working checkout if checkout does not exist.

A V1 visitor may be allowed to:

Enquire about this print

or:

Register interest

This is preferable to a fake Add to Cart action.

24. V1 PRINT/PURCHASE SCAFFOLDING

Where inexpensive, establish concepts such as:

print_available

and possible future product metadata.

V1 may present customer-facing print options for eligible photography.

It must remain non-transactional until V2.

This scaffolding should make V2 easier without creating unused complex commerce infrastructure.

25. AUTHENTICATION MODEL

V1 requires two separately authenticated human identities.

Do not require either person to use the other's email, login or credentials.

Preferred identity boundary:

Cloudflare Access

Cloudflare Access authenticates identity.

The Anyaparallax application determines authority.

Authentication and application authorisation must remain separate concepts.

26. APPLICATION ROLES

Initial roles:

photographer
manager
Photographer

Initial intended user:

Anya.

Capabilities include:

access /admin
upload photographs
edit photo metadata
assign galleries
manage tags
manage watermark settings
publish/unpublish
feature photographs
manage galleries
manage public photography content
view enquiries
manage future V2 print/order tools appropriate to the photographer

Photographer must not receive unnecessary technical maintenance authority.

Manager

Initial intended user:

site builder/maintainer.

Manager receives appropriate Photographer capabilities plus:

access /manager
technical settings
diagnostics
maintenance tools
test functionality
storage status
database status
operational troubleshooting
authorised user management
future infrastructure-facing administration where appropriate

Manager must never need access to Anya's email account.

27. AUTHENTICATION IMPLEMENTATION

Do not create two unrelated login systems.

Both identities should use the same trusted authentication architecture.

Preferred flow:

Cloudflare Access
       ↓
authenticated identity
       ↓
Anyaparallax server-side identity verification
       ↓
application user lookup
       ↓
role
       ↓
photographer → /admin
manager      → /manager + permitted admin functions

Do not trust role or email information supplied solely by client-side code.

Validate identity server-side.

28. AUTHORISED USERS

D1 should support authorised application identities.

Suggested conceptual model:

users

id
email
role
active
created_at
updated_at

Supported V1 roles:

photographer
manager

Do not hard-code the actual personal email addresses into public source/client code.

29. ROLE SECURITY

Authorization checks must occur server-side.

Hiding a Manager button from Anya's interface is not sufficient security.

A Photographer request directly targeting a Manager endpoint must be denied.

Default behaviour should be deny unless explicitly authorised.

30. DESTRUCTIVE OPERATIONS

Manager authority does not mean unrestricted destructive access.

The following require additional safeguards:

deleting high-resolution originals
deleting multiple photographs
purging R2
resetting D1
deleting users
destructive migrations
irreversible settings changes

Use explicit confirmation and appropriate protection.

31. MANAGER UI

The Manager interface should be functional rather than decorative.

Possible areas:

Manager Dashboard

Site Status
Database
Storage
Authentication
Configuration
Diagnostics
Maintenance
Test Tools
Authorised Users
View Public Site

Do not expose secrets.

32. ADMIN UI

Anya's interface should remain simple.

Suggested navigation:

Dashboard
Photos
Upload Photos
Galleries
Enquiries
Site Content
View Site
Logout

Do not expose Anya to infrastructure management merely because it exists.

33. PHOTO UPLOAD

Support:

single upload
multi-upload
drag/drop where practical

Per photograph support:

title
slug
description
gallery
tags
location
capture date
watermark enabled
watermark position
published
featured
print availability where appropriate

Use useful defaults.

Do not force unnecessary metadata entry.

34. IMAGE ARCHITECTURE

Prefer Cloudflare R2 for image object storage.

Conceptual layout:

originals/
    private master

web/
    public optimised derivative

thumbs/
    public gallery derivative

The exact object naming strategy may vary.

Document the chosen implementation.

35. ORIGINAL MASTER

The original high-resolution upload is the archival/print master.

It must:

remain unchanged
remain unwatermarked
remain non-public
retain full available quality
remain suitable for future print fulfilment

Never overwrite the master with an optimised derivative.

36. PUBLIC WEB IMAGE

Generate an appropriate public derivative.

Goals:

strong visual quality
smaller bandwidth requirements
appropriate dimensions
modern web format where suitable
sensible caching

Avoid unnecessarily destructive compression.

37. THUMBNAILS

Generate appropriately sized gallery derivatives where useful.

A gallery must not download a full print-resolution master merely to display a tile.

38. WATERMARKING

Watermarks apply only to public derivatives.

Initial watermark direction:

Anyaparallax
PHOTOGRAPHY

Support at minimum:

Off
Corner
Centre

Default:

Corner

The watermark should identify ownership without overwhelming the image.

Prefer a replaceable SVG/transparent watermark asset.

Anya's final logo/signature can replace the development version later.

39. DATA MODEL

Use Cloudflare D1 for structured application data.

Likely V1 entities:

users
photos
galleries
photo_galleries
tags
photo_tags
likes
share_events
enquiries
site_settings

Only use junction tables where justified by the final relational design.

Use migrations.

Do not manually mutate production schema as the normal workflow.

40. PHOTO MODEL

Photo data should support concepts approximately equivalent to:

id
title
slug
description
capture_date
location

original_storage_key
web_storage_key
thumbnail_storage_key

width
height
orientation

watermark_enabled
watermark_position

featured
published
print_available

created_at
updated_at
published_at

Exact schema may vary where technically justified.

41. GALLERY MODEL

Gallery data should support concepts including:

id
name
slug
description
cover_photo
display_order
published
created_at
updated_at
42. PERFORMANCE

Photography makes performance a first-class concern.

Address:

responsive image sizes
lazy loading
caching
image dimensions
thumbnail use
layout stability
appropriate preloading
avoiding master-image delivery
avoiding unnecessary JavaScript

Measure meaningful issues rather than optimising imaginary ones.

43. ACCESSIBILITY

The visual design must not remove basic accessibility.

Provide:

semantic HTML
keyboard navigation
visible focus states
adequate contrast
labelled controls
useful alt text capability
accessible lightboxes/dialogs
reduced-motion support where relevant

Admin and Manager interfaces must also remain usable.

44. SEO / DISCOVERABILITY

Provide:

page titles
meta descriptions
canonical URLs
sitemap
robots policy
OpenGraph
social cards
useful structured metadata where justified

Public photographs may be indexed.

Private/unpublished photographs must not appear in:

sitemap
galleries
public routes
search indexing
45. SECURITY

At minimum review:

authentication
authorization
role enforcement
upload authorization
MIME validation
actual file-content validation where practical
file-size limits
generated filenames/object keys
database parameterisation
CSRF where applicable
XSS
contact abuse
rate limiting where appropriate
private R2 master protection
error handling
secrets
session behaviour
Cloudflare Access verification

Do not trust user-supplied file extensions alone.

46. PRIVACY

Collect the minimum visitor information required.

Do not introduce invasive visitor tracking in V1.

Do not introduce third-party analytics by default.

If implementation creates cookie/privacy/legal implications, report them to the operator rather than silently introducing them.

47. REPOSITORY QUALITY

Maintain:

README
setup instructions
environment example without secrets
migration instructions
test instructions
build instructions
deployment instructions
architecture notes
useful comments where justified

Never commit:

API keys
access tokens
private keys
passwords
real secret .env contents
48. TESTING REQUIREMENTS
Public Site

Test:

homepage
navigation
galleries
gallery pages
photo pages
likes
sharing
About
Prints
Contact
missing photo
unpublished photo protection
Photographer/Admin

Test:

unauthorised access denied
Photographer authentication
Manager authentication
Photographer /admin
Photographer denied /manager
upload
multiple uploads where implemented
gallery assignment
tags
watermark selection
publish
unpublish
featured work
Manager

Test:

Manager /manager
Manager technical tools
Manager role enforcement
Manager can access intended shared administration
non-Manager denied Manager-only actions
Images

Test:

master retained
master unchanged
master private
web derivative created
thumbnail created
watermark correct
watermark disabled behaviour
portrait source
landscape source
large source
corrupt/unsupported upload
Responsive

Test:

narrow mobile
Samsung Galaxy S24 Ultra-class viewport
tablet
laptop
desktop
49. V1 DEFINITION OF DONE

V1 is complete only when:

Public design is visually coherent.
Homepage is complete enough for release.
Mobile navigation works.
Galleries work.
Individual photo pages work.
Photographer can authenticate independently.
Manager can authenticate independently.
Photographer can access /admin.
Photographer cannot access Manager-only functionality.
Manager can access /manager.
Manager receives appropriate higher-authority functions.
Neither operator requires access to the other's email or credentials.
Photograph upload works.
Original master remains private.
Original master remains unchanged.
Web derivative is generated.
Thumbnail is generated where required.
Watermarking works.
Galleries work.
Tags work.
Publish/unpublish works.
Featured photography works.
Likes work.
Sharing works.
Social preview metadata works.
About page exists.
Contact/enquiry flow exists.
Prints page exists.
V1 print/customer-enquiry scaffolding works.
No false live-commerce functionality is presented.
Secrets are not committed.
Production build passes.
Type checks pass where applicable.
Lint/checks pass where applicable.
Automated tests pass.
Relevant manual smoke tests pass.
No known critical security defect remains.
Deployment documentation exists.
Repository state is clean or fully explained.
Codex issues a V1 readiness report.
50. V1 IMPLEMENTATION / REVIEW PLAN

The implementation should use Codex as supervisor and DeepSeek as bounded implementation worker.

INITIAL SUPERVISOR PHASE — CODEX ONLY

Before any DeepSeek implementation:

Codex must:

read this specification in full
analyse the mission itself
inspect the repository
inspect existing files
inspect Git state
establish protected state
decide architecture
choose framework/runtime
initialise the application/repository where required
establish the baseline commit
establish the working branch/worktree strategy
identify external dependencies
identify secrets/configuration requirements
identify the initial Cloudflare architecture
produce the bounded slice plan
identify which work can safely be delegated

DeepSeek must not determine the governing architecture.

51. IMPLEMENTATION SEQUENCE
SLICE 1 — DEEPSEEK

Project shell, routes, shared components and basic dark/neon visual system.

Expected areas include:

application shell
routing skeleton
navigation
footer
responsive foundations
typography
layout primitives
dark photography visual system
loading/error foundations where useful

No deployment.

CODEX REVIEW

After Slice 1 Codex must independently inspect:

diff
structure
dependencies
build
type-check
lint/checks
responsive architecture
visual structure

Reject unnecessary architecture drift.

SLICE 2 — DEEPSEEK

Homepage and Berlin-inspired photography presentation.

Implement:

hero
photography-first layout
Cities / People / Music / Moments direction
featured photography presentation
gallery exploration section
latest-work area
About preview
social/footer integration

Use development placeholders until real content exists.

CODEX REVIEW

Verify:

visual hierarchy
responsive design
no excessive visual effects
image-first presentation
accessibility
build/type status
SLICE 3 — DEEPSEEK

Gallery/portfolio data model and photo presentation.

Implement appropriate:

galleries
gallery pages
photo pages
tags
metadata rendering
previous/next navigation
publishing states
featured states
photo URL/slugs

Initial data may be seeded locally where necessary.

CODEX REVIEW

Verify:

data model
route behaviour
unpublished protection
responsive gallery behaviour
architecture compatibility with D1
SLICE 4 — DEEPSEEK

Cloudflare/D1/R2 storage plumbing where appropriate.

Implement:

D1 schema
migrations
R2 abstraction
image object model
private master strategy
public derivative strategy
gallery thumbnail strategy
relevant repository interfaces/services

Do not deploy production resources without permission.

CODEX REVIEW

Verify:

migration design
private/public boundary
no secrets
no accidental master exposure
clean Cloudflare architecture
testability
SLICE 5 — DEEPSEEK

Authentication, Anya /admin and Manager /manager.

Implement:

Cloudflare Access-compatible authentication boundary
server-side identity validation
application role lookup
photographer
manager
/admin
/manager
server-side authorization
deny-by-default behaviour
CODEX SECURITY REVIEW

Independently verify:

client cannot invent role
Photographer cannot access Manager functionality
Manager identity remains independent
no shared credentials
protected routes work
direct endpoint access is protected
secrets are absent
SLICE 6 — DEEPSEEK

Upload workflow, watermarking and image handling.

Implement:

single upload
multi-upload where practical
upload validation
original storage
derivative generation
thumbnail generation
watermark:
off
corner
centre
metadata
gallery assignment
tags
publish/unpublish
featured state
CODEX REVIEW

Verify:

original unchanged
original private
derivative appropriate
thumbnail appropriate
watermark never modifies original
invalid file behaviour
large image behaviour
admin authorization
SLICE 7 — DEEPSEEK

Engagement and social sharing.

Implement:

likes
aggregate counts
duplicate-like mitigation
unlike where appropriate
native Web Share
fallback share actions
copy link
share-event tracking where useful
OpenGraph/social metadata
CODEX REVIEW

Verify:

privacy
no fingerprinting
duplicate behaviour
correct share claims
social image does not expose master
SLICE 8 — DEEPSEEK

Purchase/enquiry scaffolding and customer-facing print options.

Implement V1-only:

Prints page
print eligibility
customer print enquiry
possible format/size display scaffolding
register-interest behaviour if selected
relevant enquiry management
Contact page
About page

Do NOT implement:

checkout
payment
live orders
shipping
tax
fulfilment
CODEX REVIEW

Verify that V1 does not falsely imply functioning ecommerce.

SLICE 9 — CODEX FINAL REVIEW

Codex performs the final cross-site review.

Include:

architecture
public UX
Photographer UX
Manager UX
authentication
authorization
security
privacy
responsive behaviour
image handling
storage
D1
R2
performance
accessibility
SEO
OpenGraph
tests
build
type-check
lint
Git state
documentation

Produce the V1 readiness report.

Do not publish production unless separately authorised.

52. DEEPSEEK WORKER SUPERVISION MODE

Act as the supervising agent and final acceptance authority.

The external implementation worker is:

C:\Users\USER\bin\deepseek-worker.ps1

Its DeepSeek API/Codex configuration is already installed and tested.

Do not reconfigure it.

53. DEEPSEEK SUPERVISION — OBJECTIVE

Analyse the requested mission yourself and establish the repository's starting/protected state before delegating any implementation.

Use your own reasoning primarily for:

understanding the objective
architecture and planning
identifying protected state
defining bounded implementation slices
reviewing worker output
independent acceptance testing
deciding whether repair/escalation is required
final acceptance recommendation

Use DeepSeek for implementation-heavy work wherever appropriate.

54. DEEPSEEK WORKER PROCEDURE

For each implementation slice:

Step 1 — Task File

Create a bounded task file containing:

exact objective
relevant context
allowed files/scope
protected files/refs/state
required behaviour
required tests/checks
explicit prohibitions
completion evidence required
Step 2 — Invoke Worker

Invoke:

C:\Users\USER\bin\deepseek-worker.ps1 `
  -Repo "<CURRENT WORKTREE>" `
  -TaskFile "<TASK FILE>" `
  -Sandbox "workspace-write"
Step 3 — Wait

Wait for the worker to finish.

Step 4 — Independent Inspection

Independently inspect:

worker exit code
starting HEAD
ending HEAD
git status
git diff
files changed
tests/checks claimed by worker
Step 5 — Independent Acceptance

Independently run the acceptance checks yourself.

Do not accept the worker's self-reported success without verification.

Step 6 — Repair

If the slice fails:

diagnose the failure yourself
create a narrowly scoped repair task
return it to DeepSeek
independently verify again
Step 7 — Repair Limit

Allow at most TWO DeepSeek repair attempts for the same bounded defect.

After two unsuccessful repairs:

stop delegating that defect

Then either:

implement/fix it yourself if appropriate

or:

report the blocker to the operator
55. DEEPSEEK AUTHORITY BOUNDARIES

DeepSeek is an implementation worker only.

It must never receive authority to:

merge
rebase
cherry-pick
push
force-push
tag
publish
deploy
reset history
alter protected refs
approve a candidate
promote a candidate
broaden scope without supervisor approval

Do not allow DeepSeek to commit unless this mission explicitly requires worker commits.

For this V1 mission, default behaviour is:

DeepSeek does not commit.

Codex may create local supervisor-controlled commits for accepted work where appropriate.

Codex must not push or publish without separate authorisation.

Preserve all unrelated pre-existing changes.

56. DEEPSEEK DATA DISCLOSURE

DeepSeek is an external API provider.

Before the first DeepSeek invocation for this repository, obtain the operator's explicit approval if repository-derived information has not already been approved for DeepSeek disclosure in this mission.

Do not interpret the existence of this specification alone as disclosure approval.

Never send DeepSeek:

passwords
API keys
authentication tokens
credential files
.env secrets
private keys
customer/personal data
unrelated sensitive material

If a worker only needs a narrow subset of repository context, provide only that bounded context.

Do not unnecessarily send repository-wide information.

57. DEEPSEEK EFFICIENCY POLICY

Prefer delegation to DeepSeek for:

implementation
repetitive repository inspection
test writing
straightforward refactors
repair loops
build troubleshooting
type troubleshooting
lint troubleshooting
bounded UI implementation

Retain Codex supervisor effort for:

planning
architecture
difficult diagnosis
governance
security-sensitive reasoning
acceptance
rejection
operator escalation

Do not duplicate work unnecessarily.

If DeepSeek has already collected useful evidence, inspect and verify that evidence rather than repeating broad exploration without reason.

58. TASK FILE CONVENTION

DeepSeek task files should be retained where useful for auditability.

Suggested location:

docs/worker-tasks/

Suggested names:

ANYAPARALLAX_V1_SLICE_01.md
ANYAPARALLAX_V1_SLICE_02.md
ANYAPARALLAX_V1_SLICE_03.md
...

Repair tasks may use:

ANYAPARALLAX_V1_SLICE_03_REPAIR_01.md
ANYAPARALLAX_V1_SLICE_03_REPAIR_02.md

Do not place secrets into task files.

59. GIT DISCIPLINE

Before work begins, Codex records:

repository path
branch
HEAD
worktree status
remote
relevant refs

Prefer a dedicated V1 working branch.

Suggested name:

codex/anyaparallax-v1

Do not assume that exact branch name is mandatory if repository conditions justify another.

Establish a clean baseline commit before implementation where the repository is newly created.

After each accepted slice record:

starting SHA
ending SHA
worktree state
files changed
test state

Do not:

force-push
rewrite unrelated history
discard unknown work
reset unrelated modifications
mutate unrelated repositories
60. OPERATOR INPUT GATES

Continue autonomously wherever safe.

Stop when genuine operator input is necessary.

Likely gates include:

DeepSeek Disclosure

Before first repository-derived information is sent to DeepSeek, if approval has not already been explicitly provided:

Ask for approval.

Authentication Identities

Need:

Anya authorised email
Manager authorised email

Never ask for their passwords.

Cloudflare

May require:

operator login
account selection
access approval
creation approval
manual authentication

Do not request Cloudflare secrets to be pasted into source.

Domain

Need:

final purchased domain
DNS/Cloudflare confirmation
Contact

Need:

enquiry destination email
Content

Eventually require:

initial photography
approved About copy
social links
portrait if desired
final watermark/logo asset

Development placeholders may be used until these are provided.

Production Deployment

Requires explicit operator approval.

61. OPERATOR INPUT REPORT

When operator input is required use:

ANYAPARALLAX — OPERATOR INPUT REQUIRED

Current slice:
[identifier]

Completed:
[completed work]

Blocked on:
[exact missing information/action]

Operator action:
[precise action required]

After completion:
[what Codex will do]

Repository:
[path]

Branch:
[branch]

HEAD:
[SHA]

Worktree:
[clean/dirty with explanation]

Tests:
[current result]

Do not hide required operator actions inside lengthy prose.

62. SLICE COMPLETION REPORT

After each major accepted slice report:

ANYAPARALLAX — [SLICE] COMPLETE

A. Starting state

Repository:
Branch:
Starting HEAD:
Starting worktree:

B. Objective

[bounded objective]

C. DeepSeek worker

Task file:
Worker invocation:
Exit status:
Repair attempts:
0 / 1 / 2

D. Implementation

[summary]

E. Files changed

[file list or concise categories]

F. Codex independent review

[review]

G. Independent acceptance checks

[commands/checks and actual outcomes]

H. Final Git state

Ending HEAD:
Worktree:
Protected state:

I. Risks / observations

[anything relevant]

J. Next slice

[next bounded objective]

Operator input required:
YES / NO

Do not claim tests were executed if they were not.

63. FAILURE BEHAVIOUR

If a slice fails:

Report:

what failed
likely cause
worker attempt number
repository integrity
uncommitted changes
whether protected state remains unchanged
recovery approach

Do not conceal failure.

Do not continue through a failed foundational gate merely to maintain momentum.

64. PUBLICATION POLICY

The governing state for V1 development is:

AUTHORIZATION_ONLY_NO_PUBLICATION

Allowed:

repository creation
local development
local commits
testing
worker delegation
migrations authored locally
Cloudflare configuration preparation
build validation
preview planning
documentation
readiness review

Not allowed without separate authorisation:

production deployment
production publication
pushing a final production release
promotion
production DNS cutover

If preview deployment itself would create external/public infrastructure, ask where appropriate before doing so.

65. V2 — PRINT SALES GOAL

V2 converts Anyaparallax from:

Portfolio + Audience + Enquiries

into:

Portfolio + Audience + Print Commerce

V2 is outside the current implementation mission.

Do not begin V2 unless separately instructed.

66. V2 EXPECTED FEATURES
Print Eligibility

Anya can mark selected photographs as purchasable.

Products

Potential formats include:

photographic print
fine-art print
framed print
canvas if later desired
Sizes

Each photograph may offer multiple sizes.

Actual physical dimensions and pricing require Anya/operator decisions.

Variants

Potential variant dimensions:

size
format
paper
frame
finish
Shopping Cart

Customers can add print variants to a basket.

Checkout

Integrate a suitable payment provider.

Payment-provider selection is a V2 decision.

Orders

Track:

customer details
items
variant
quantity
payment state
fulfilment state
shipping state
Admin Orders

Anya should be able to see:

new orders
paid orders
fulfilment progress
completed orders

Manager should retain technical troubleshooting authority.

Fulfilment

Start with manual fulfilment if appropriate.

External print-laboratory API integration may be evaluated later.

67. V2 MASTER IMAGE RULE

All print-production assets must derive from the private high-resolution original.

Never generate customer print assets from:

watermarked public image
thumbnail
compressed social preview

This is why V1 preservation of the original master is mandatory.

68. V2 SECURITY / LEGAL REVIEW

Before enabling live ecommerce, conduct a separate review covering:

payment security
webhook verification
order integrity
customer personal data
privacy
refunds
shipping
tax/VAT
fulfilment
terms
backups
recovery

Do not invent legal or accounting conclusions.

Flag areas requiring operator/professional review.

69. POSSIBLE LATER FEATURES

Future possibilities, not V1 commitments:

event/client galleries
password-protected galleries
proofing
client favourites
digital downloads
band/client delivery
booking
event calendar
mailing list
automated social-post preparation
richer Instagram workflow
QR codes for exhibitions
limited-edition numbering
advanced analytics
photo usage/licensing enquiries

Do not implement unless separately authorised.

70. INITIAL CODEX COMMAND

After this specification has been placed in the repository, the operator may begin the mission with:

Read ANYAPARALLAX_V1_GOAL.md in full and treat it as the governing
implementation, security, delegation and acceptance specification.

Operate in DEEPSEEK WORKER SUPERVISION MODE exactly as defined in that file.

You are the supervising agent and final acceptance authority.

First inspect the repository and establish the exact starting and protected
state. Decide the architecture yourself. If the project requires
initialisation, initialise it and establish the baseline commit.

Produce the bounded implementation plan corresponding to the specification's
V1 slice sequence.

Do not invoke DeepSeek until:
1. the architecture and protected state are established, and
2. the repository disclosure gate defined in the specification has been
   satisfied.

When delegation is allowed, use:

C:\Users\USER\bin\deepseek-worker.ps1

exactly according to the worker procedure in the specification.

DeepSeek is an implementation worker only. Independently inspect every worker
result and independently execute acceptance checks before accepting any slice.

Allow no more than two worker repair attempts for the same bounded defect.

Continue autonomously between slices unless genuine operator input is
required.

Do not publish, deploy, promote, push a production release, or otherwise
perform publication without separate explicit authorisation.

Begin with the CODEX-ONLY repository inspection, architecture decision,
project initialisation/baseline if required, and slice plan.
71. FINAL SUPERVISOR REPORT

At completion Codex must report:

A. Starting State
repository
initial branch
initial SHA
initial worktree
remotes
protected state
B. Architecture and Plan
selected architecture
Cloudflare approach
data architecture
image architecture
authentication architecture
implementation slices
C. DeepSeek Worker Runs

For each:

slice
task file
worker result
repair attempts
acceptance/rejection
D. Files Changed

Summarise final changed files and significant additions.

E. Independent Acceptance Checks

Report actual results for:

build
type-check
lint
tests
security/auth checks
role checks
image tests
responsive checks
relevant manual checks
F. Final Git State
branch
HEAD
worktree state
protected refs
commit history produced during mission
G. Remaining Risks / Blockers

Clearly identify anything incomplete or uncertain.

H. Acceptance Recommendation

State one of:

READY FOR V1 ACCEPTANCE
READY WITH DOCUMENTED NON-BLOCKING ISSUES

or:

NOT READY FOR ACCEPTANCE

Explain why.

Do not perform publication, promotion or production deployment unless separately and explicitly authorised.

72. GOVERNING PRINCIPLE

The purpose of this process is not to maximise generated code.

The purpose is to deliver a verified, maintainable and safe Anyaparallax V1.

The division of responsibility is:

Operator
    ↓
owns requirements, credentials and publication authority

Codex
    ↓
architecture
planning
governance
security reasoning
worker supervision
review
testing
acceptance

DeepSeek
    ↓
bounded implementation
test writing
routine repair
straightforward technical work

DeepSeek output is always a candidate.

Codex acceptance is required before a slice is considered complete.

Production publication remains an operator-authorised action.