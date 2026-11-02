# Integration kit extensions: proposal

**Status:** Proposal, 2026-11-02. Nothing implemented. For review by the owner.
**Driver:** Canopy, ecoREAL's LEED project coordination app
(`~/PycharmProjects/GreenCanaryCanope`), the first embedding application planned on
a dedicated FileEngine deployment (Posture B, `../SPECIFICATIONS.md` §5.0).
**Spans:** commercial_embedding, commercial_provisioning, ldap_manager,
folder_actions, http_bridge, discussion_threaded_communication, convert_search_ai.

Every feature here is written for any embedding application. Canopy is the worked
example, not a special case: no Canopy names appear in FileEngine code or config.

## 1. Why

An embedding application like Canopy keeps its own domain model (projects, credits,
deliverables with a review pipeline, meetings, an activity log) and wants FileEngine
for everything about documents: storage, versions, previews, comments, reviews,
search and extraction. Reviewing the kit against that need (2026-11-02) found it
sound in design (delegated exchange, no data proxy, MIT components, idempotent
provisioning) but short in five places:

1. **Identity.** Every delegated `sub` must already exist in the tenant's LDAP, and
   there is no server-to-server way for an integration to create users or manage
   role membership. `ldap_manager`'s `/v1/admin/users` and `/v1/admin/roles`
   require a member of the tenant `administrators` group, which a service
   principal is not (`ldap_manager/src/ldap_manager/deps.py`, `require_tenant_admin`).
2. **Specified components that do not exist.** `<fe-version-history>`,
   `<fe-reviews>` and `<fe-document-drawer>` are in `SPECIFICATIONS.md` §4.4 and
   §12 (M1, M2) but not in `packages/components/src`.
3. **Reliable change delivery.** The core event stream is fail-open and needs
   direct Redis access; folder_actions webhooks are unsigned, `grant_read` is
   accepted but not implemented (`folder_actions/src/folder_actions/plugins/webhook.py`,
   "v1: accepted, TODO"), and there is no REST feed an integrator can use to
   recover from a lost event.
4. **Domain linkage.** Node metadata cannot be protected from end users, so an
   integration cannot safely stamp its own ids (deliverable, credit) on files.
   The uploader cannot write a new version of an existing file.
5. **Blueprint expressiveness.** A blueprint cannot repeat a folder over a list
   parameter, so a per-credit folder tree with per-discipline ACLs must be
   generated whole by the integrator.

The extraction work in `convert_search_ai/design_documents/EXTRACTION_PROMPT_SETS.md`
(agreed 2026-11-02) adds a sixth opportunity: integrations publishing their own
prompt sets and showing extracted values with evidence.

## 2. Summary and priority

| Id | Feature | Repo(s) | Priority |
| --- | --- | --- | --- |
| X1 | Integration identity API (users, role membership) | ldap_manager, http_bridge | **P1**, blocking |
| X2 | Reliable integration events: signed webhooks, `grant_read`, change feed | folder_actions, http_bridge | **P1** |
| X3 | Integration-owned metadata namespace | file_engine_core, http_bridge, provisioning | **P1** |
| X4 | `<fe-version-history>` and version-aware components | commercial_embedding | **P1** |
| X5 | Uploader: new version of an existing file, metadata on upload, limits | commercial_embedding | **P1** |
| X6 | `<fe-reviews>` (per file and inbox) | commercial_embedding, discussion | **P1** |
| X7 | Blueprint `for_each` and per-space ACL updates | commercial_provisioning | P2 |
| X8 | Integration-minted drop links | share_service, commercial_embedding | P2 |
| X9 | Extraction: integration prompt sets, `<fe-extraction>` | convert_search_ai, commercial_embedding | P2 (after extraction P3) |
| X10 | `<fe-document-drawer>`, `<fe-version-diff>` | commercial_embedding, difference_service | P3 |
| X11 | Release hygiene: types, publishing, contract tests, doc fixes | commercial_embedding, all | P1 (small) |
| X12 | "Open in <integration>" links in the official client | http_bridge (registry), frontend | P2 |
| X13 | Drive connection for embedding apps | ldap_manager, commercial_embedding | P3 |
| X14 | Private subtrees and folder ACL policy | file_engine_core, commercial_provisioning | **P1**, core |

P1 is what Canopy needs for its Docs view and deliverable pipeline. Each feature is
shippable on its own; dependencies are noted per section.

---

## 3. X1: Integration identity API

### 3.1 Goal

An integration's backend keeps FileEngine's directory in step with its own user
store, so delegated exchange works for every user without a human tenant admin.
The integration's user store stays the source of truth for who exists; FileEngine's
LDAP becomes a projection of it within a bounded scope.

### 3.2 Directory model (unchanged by X1)

X1 works inside the established directory model and adds nothing to it
(`docker_unified/LDAP_REFERENCE.md`, `scripts/Ansible/docs/TENANT_BOUNDARY.md`):

- Users are **global** `inetOrgPerson` entries under `ou=users`, with `uid` equal
  to `mail` (the email address). One user can belong to several tenants.
- A tenant is `ou=<tenant>,ou=tenants,<base dn>`. Roles are `groupOfNames` entries
  beneath it; the role name is the group `cn`; `member` holds full user DNs.
- **Membership in a tenant is holding at least one group beneath its `ou`.** Roles
  are the `cn`s held in that tenant only, never a union across tenants.

Consequences for X1: a user is identified by email, not by an integration id;
granting the first role in a tenant makes the user a member of it, and removing
the last role ends membership; and nothing X1 does in tenant T may change the
user's global entry in a way that affects their other tenants.

### 3.3 Shape

New router in ldap_manager: `/v1/integration/...`. Authenticated by an integration
**service** token (`svc:true`, `amr:["integration"]`) carrying a new capability
`identity` and scope claims, issued by the same `/v1/auth/exchange` and the same
registry as provisioning (`SPECIFICATIONS.md` §14.1, §14.7):

- `idn_tenants`: tenants it may touch (whole deployment under the bespoke-deployment
  policy, still validated per call).
- `idn_role_prefix`: the only roles it may create, delete or change membership of,
  e.g. `canopy-`. Built-in groups (`administrators`, `users`, `share_external`) are
  excluded unless listed in `idn_builtin_roles`.
- `aip` enforced, as provisioning does (`commercial_provisioning/src/provisioning_service/auth.py`).

| Method + path | Body / effect |
| --- | --- |
| `PUT /v1/integration/users/{email}` | Ensure the global entry exists: `{given_name, surname, display_name, invite?: {tenant}}`. Creates it if absent (no usable password, as the tenant play does for new accounts). If it exists, changes nothing except name fields on entries this integration created. Returns the `uid` (the email) to use as `sub`. |
| `GET /v1/integration/tenants/{t}/users?role_prefix=&since=` | Users holding at least one of this integration's roles in T. |
| `DELETE /v1/integration/tenants/{t}/users/{email}` | Remove the user from every **prefixed** role in T. If those were their only groups in T, their membership in T ends (boundary rule); their entry and their other tenants are untouched. Never deletes the entry. |
| `PUT /v1/integration/tenants/{t}/roles/{role}` | Create a prefixed role group under `ou=<t>` (idempotent), using ldap_manager's existing placeholder-member convention for an empty `groupOfNames`. |
| `DELETE /v1/integration/tenants/{t}/roles/{role}` | Delete a prefixed role group it created. |
| `PUT /v1/integration/tenants/{t}/roles/{role}/members` | Replace the member list: `{emails: [..]}`. Idempotent; returns added and removed. |
| `POST /v1/integration/tenants/{t}/sync` | Bulk form of the above for one tenant, with `dry_run`. For nightly reconciliation. |

### 3.4 Rules

- **Tenant scope.** Every tenant-scoped call checks that `ou=<t>,ou=tenants` exists
  and is within `idn_tenants`. Role operations are confined to groups beneath that
  `ou` whose `cn` starts with `idn_role_prefix`. X1 never touches built-in groups
  (`administrators`, `system_admin`, `users`, `contributors`, `share_external`)
  unless the operator lists them in `idn_builtin_roles`.
- **Global entries are shared.** X1 never sets or clears a password, disables an
  account, or deletes an entry: those would affect the user's other tenants. Ending
  access is done only by removing groups in T. An entry X1 created carries
  `managedBy=<integration_id>` so the official client can show it as externally
  created; that marker grants the integration no rights over the user elsewhere.
- **Existing users.** If the email already exists (a person who is in another tenant,
  or already in T), X1 simply adds prefixed groups in T. No adoption step is needed,
  because nothing global is changed.
- **Sign-in.** Users created without a password sign in only through the
  integration's exchange, or through OAuth if the deployment maps their email. An
  `invite` sends the existing invite mail for users who should also use the official
  client.
- Role changes take effect on the user's next token refresh (at most 15 minutes),
  the existing re-mint-from-directory behaviour. A `POST .../tenants/{t}/users/{email}/revoke-sessions`
  ends live sessions at once (uses the existing jti revocation list).
- Every call emits `identity.*` audit entries (category `user`, `source_iface: rest`).

### 3.5 Tenant creation

Out of scope here. Owner's architectural note (2026-11-02): Green Canary,
FileEngine and Canopy share one multi-tenancy model. Tenant context is selected
by header (subdomain optional), and a tenant is defined by its LDAP structure;
FileEngine creates the tenant's database tables on first access when that
structure exists. X1 therefore never creates tenants: it operates inside a tenant
whose LDAP structure is already in place, and `idn_tenants` is validated against
LDAP per call. Creating that structure stays with whoever owns tenant creation
(today the deployment's tenant play, `scripts/Ansible/docs/TENANT_CREATION.md`,
or `docker_unified/scripts/new-tenant.sh`).

### 3.6 Canopy use

`Person.email` is the directory `uid`. `TeamAssignment` rows project onto prefixed
role groups in the tenant's `ou`, for example `canopy-<project>-<function>` and
`canopy-<project>-all`. Canopy calls `PUT .../roles/{role}/members` when
assignments change and runs `/sync` nightly.

---

## 4. X2: Reliable integration events

### 4.1 Signed webhooks (folder_actions)

Add to every `webhook` delivery:

- `X-FileEngine-Event-Id`: the source event id (already the run's idempotency key).
- `X-FileEngine-Timestamp`: Unix seconds.
- `X-FileEngine-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`.

`ConfigModel` gains `signing_secret` (a `secret`-typed param, so provisioning can
supply it and `GET .../config` redacts it). Receivers reject a timestamp older than
5 minutes. Signing is on by default for new bindings; existing bindings without a
secret keep working unsigned.

### 4.2 Implement `grant_read`

As already specified in folder_actions §7.4: when `grant_read` is true, the payload
gains `read_grant: {token, expires_in, uid, version}`. The token is a bridge-minted
bearer whose only right is `GET /v1/files/{uid}/content?version=` and
`/renditions` for that file and version, valid 10 minutes. Mint it through a new
internal bridge route `POST /internal/v1/grants/read` (service-authenticated,
audited as `auth.read_grant`). Needed so an integration can fetch bytes for an
outbound push (Canopy's Green Canary upload queue) without a broad service token.

### 4.3 Delivery log and replay

`GET /v1/bindings/{id}/runs?status=failed&since=` already has data in
`action_run`. Expose it to the integration token that provisioned the binding
(`managed_by` match), and add `POST /v1/runs/{id}/replay`. Without this a webhook
that exhausted its retries is lost silently from the integrator's side.

### 4.4 Change feed (http_bridge)

Events are hints; integrators need a way to catch up. Add a cursor feed over the
existing `ListRecentFiles` core call:

```
GET /v1/changes?root=<uid>&cursor=<opaque>&limit=500
-> { "changes": [ { "uid", "parent_uid", "name", "is_folder", "deleted",
                    "version", "modified_at", "metadata_changed_at" } ],
     "cursor": "<opaque>", "more": false }
```

- Scoped by ACL like any listing; `root` is required.
- The cursor is a (timestamp, uid) pair, so equal timestamps do not drop rows.
- `metadata_changed_at` requires the core to record a node-level metadata change
  time. That also allows the missing `metadata.changed` event (core proposal,
  file separately).

### 4.5 Canopy use

A `webhook` binding on each project space (`file.created`, `file.updated`,
`review.approved`, `review.rejected`) posts to Canopy, which verifies the
signature, updates Deliverable status and writes its own ActivityEvent. A periodic
job reads `/v1/changes` per project root to repair anything missed.

---

## 5. X3: Integration-owned metadata namespace

### 5.1 Goal

Let an integration stamp its own identifiers and state on nodes (for Canopy:
`deliverable_id`, `credit_code`, `doc_requirement_id`) that end users can read but
not change, so a webhook or search hit can be linked back to the integration's
records without trusting user-editable data.

### 5.2 Rule

- Keys starting with `x.<integration_id>.` are **integration-owned**. Only a
  principal whose token carries that integration (service token, or provisioning
  acting for it) may set or delete them. Everyone with READ may read them.
- Enforced in the core's `SetMetadata` path (the bridge alone is not enough: gRPC
  doors and MCP must obey it too). `managed_by` becomes the first reserved key under
  the same mechanism.
- Blueprints may set them on folders (`metadata: {"x.canopy.credit": "${c.code}"}`).
- X5's uploader may request them on upload only through a host-signed
  `metadata-grant` (5.3), never as plain attributes.

### 5.3 Metadata grant for uploads

The integration backend signs (same keypair as exchange) a short JWT:
`{iss, aud: "<bridge>/v1/metadata-grant", exp <= 10 min, jti, tenant, folder, keys: {"x.canopy.deliverable": "…"}}`.
The uploader passes it on create; the bridge verifies it and applies those keys as
the integration. The browser can attach the ids but cannot forge them.

---

## 6. X4: `<fe-version-history>` and version-aware components

Already specified (`SPECIFICATIONS.md` §4.4, M1). This section fixes the contract.

```html
<fe-version-history uid="…" allow-restore></fe-version-history>
```

| | |
| --- | --- |
| Endpoints | `GET /v1/files/{uid}/versions`, `GET /v1/files/{uid}/versions/{ts}`, `POST /v1/files/{uid}/restore` |
| Attributes | `uid`, `tenant`, `allow-restore` (boolean, off by default), `selected` (version id) |
| Methods | `open(uid)`, `refresh()`, `select(version)` |
| Events | `fe:version-select {uid, version}`, `fe:version-restore {uid, from, newVersion}` |
| Display | Version id parsed as a date (accept the core's same-millisecond `-N` suffix), author, size; metadata snapshot per version via `GetMetadataForVersion` if exposed (add `GET /v1/nodes/{uid}/metadata?version=` to the bridge if not) |

Version-aware attributes on existing components:

- `<fe-document-preview version="…">` and `<fe-download version="…">`: show or fetch
  a specific version.
- `<fe-comments version="…">`: filter and post against a version (the discussion
  service already anchors threads to `file_uid` + version).

Canopy use: the deliverable drawer shows history for each `DeliverableFile`; the
LEED Admin reviews the exact version submitted.

---

## 7. X5: Uploader extensions

| Attribute / property | Effect |
| --- | --- |
| `version-of="<uid>"` | Upload the chosen file as a new version of that file (`PUT /v1/files/{uid}/content` only). Single file. |
| `accept` | MIME types / extensions, checked client-side and reported in `fe:upload-error`. |
| `max-bytes` | Client-side size limit. |
| `.metadataGrant` | X3 grant applied on create. |
| `name-policy="keep" \| "unique"` | On a duplicate name in the folder: fail (default) or append ` (2)`. |
| Event `fe:upload` | Gains `version` (the version id created) and `isNewVersion`. |
| Event `fe:upload-progress` | `{name, loaded, total}` (spec §4.4 promised progress; not present today). |

Canopy use: "Replace file" on a deliverable becomes a new FileEngine version of
the same file, so history and review anchoring survive.

---

## 8. X6: `<fe-reviews>`

Specified in `SPECIFICATIONS.md` §4.4 (Bundle C). Backing API exists:
`GET /reviews`, `GET|POST /files/{uid}/reviews`, `POST /reviews/{id}/acknowledge|approve|reject`.

```html
<fe-reviews uid="…" endpoint="https://discuss.example.com"></fe-reviews>   <!-- per file -->
<fe-reviews inbox role="reviewer" status="requested"></fe-reviews>          <!-- inbox -->
```

| | |
| --- | --- |
| Attributes | `uid`, `version`, `endpoint`, `inbox`, `role` (`reviewer` \| `requester`), `status`, `can-request` (boolean) |
| Methods | `open(uid)`, `request(reviewers, {version, message})`, `approve(id, outcome)`, `reject(id, outcome)`, `acknowledge(id)` |
| Events | `fe:review-requested`, `fe:review-decided {id, uid, version, decision, outcome}` |

Requirements beyond the existing API:

- **Reject requires a reason.** Add `require_outcome_on_reject` (tenant or per
  request) to discussion; the component enforces it client-side too.
- **Reviewer picker** uses `GET /files/{uid}/mentionable?q=`; hosts can instead set
  `.reviewers` to a fixed list (Canopy: the project's LEED Admin) and hide the picker.
- **Live updates** over the existing file WebSocket.

Canopy use: `ready_for_review` raises a review to the LEED Admin; approve or reject
(with a comment) arrives at Canopy as `review.approved` / `review.rejected` through
X2 and moves the Deliverable.

---

## 9. X7: Blueprint `for_each` and per-space ACL updates

### 9.1 `for_each`

A child node may repeat over a `list` param of objects:

```json
{ "for_each": "${credits}", "as": "c",
  "name": "${c.code} ${c.title}",
  "metadata": { "x.canopy.credit": "${c.id}" },
  "acls": [ { "principal": "role:${c.role}", "allow": ["r","w"] } ],
  "children": [ { "name": "Submitted" }, { "name": "Approved" } ] }
```

- Items are matched across re-applies by a required `key` field (`"key": "${c.id}"`),
  not by name, so renaming a credit renames the folder instead of creating a second.
- `reconcile` adds new items; `enforce` also renames and re-ACLs; an item removed
  from the list is soft-deleted only in `enforce` with `prune: true`.
- `${node:...}` addresses gain an index form: `${node:Credits/[key=EAc2]/Approved}`.
- `actions` may also use `for_each` so each repeated folder gets its own bindings.

### 9.2 Cheap ACL-only updates

`PATCH /v1/provisioning/spaces/{uid}/params` with only changed params, re-rendering
ACLs and metadata in `enforce` mode for the affected subtree only. Canopy calls this
when a credit's responsible discipline changes, without re-sending the blueprint.

---

## 10. X8: Integration-minted drop links

Today a drop link needs a user in `share_external` with WRITE on the folder.
Add:

- `POST /links` accepted from an integration service token with capability
  `share` and scope `share_roots` (the folders it may create links under),
  `share_shapes: ["drop"]`. The link's owner is the delegated user named in the
  request (`on_behalf_of: <uid>`), so audit and file ownership stay with a person.
- `<fe-drop-link-request>`: a small component for the host to show "invite a
  subcontractor to upload" (recipient emails, expiry, file limits), backed by a
  host endpoint that calls the API above. The kit never holds the service token.

Canopy use: a contractor's subcontractors upload documents for Canopy-owned
credits into a credit's `Incoming` folder. Not for Green Canary-linked credits,
whose documents belong to Green Canary.

---

## 11. X9: Extraction for integrations

Depends on `EXTRACTION_PROMPT_SETS.md` phases P1 (prompt sets) and P3 (events and
webhook values).

- **Integration-published prompt sets.** Allow `PUT /v1/prompt-sets/slug/{slug}`
  from an integration service token with capability `extraction`, under the
  integration's namespace (`slug` prefixed `<integration_id>.`). Same YAML format as
  §4.6 there. Users may use but not edit them (mirrors X3).
- **Metering for exchanged tokens.** Usage limits are per API key today. Apply the
  same meter per `(integration, tenant)` for tokens minted by exchange, so a
  delegated user cannot bypass limits.
- **`<fe-extraction>`** component: for a `uid` and `version`, shows each field's
  value, unit and evidence quote, and opens the marked-up PDF sidecar in
  `<fe-document-preview>` at the evidence. Read-only; editing values belongs to the
  host app. Event `fe:extraction-select {field, value, evidence}`.

Canopy use, subject to Canopy open question 3 (which credits Canopy owns): waste
diversion tonnage from hauler tickets (MRp2, MRc6) and flush-out dates and volumes
from IAQ logs (EQc3, EQc4). Not EPD, HPD or VOC values, which come from Green
Canary.

---

## 12. X10: Composite and comparison components (P3)

- `<fe-document-drawer>`: as specified (`SPECIFICATIONS.md` §4.4), composing preview,
  comments, versions, reviews, metadata and, when imported, extraction. Tabs are
  opt-in by attribute so unused modules are never loaded.
- `<fe-version-diff uid version base>`: shows `difference_service`
  `GET /files/{uid}/diff` results (per-page SVG over the PDF rendition), polling on
  `202 pending`, with a clear state for `unsupported`. Office formats are
  unsupported upstream; the component says so instead of failing.

---

## 13. X11: Release hygiene (do alongside P1)

- **Types and build.** Ship `.d.ts` for both packages (JSDoc-to-d.ts is enough; a
  TypeScript rewrite is not required). Build ESM bundles to `dist/`; point
  `exports` at `dist/`.
- **Versioning.** Semver from `1.0.0` at the end of P1; a `CHANGELOG.md`; publish to
  a registry (or a pinned git tag) so an integrator can depend on a version.
- **Contract tests** (`SPECIFICATIONS.md` §11, not yet present): one test per REST
  or WebSocket call the kit makes, run against a live stack, failing on drift.
- **Doc fixes found in the 2026-11-02 review:**
  - `file_engine_core/SPECIFICATIONS.md` ("ACL principals") says "a matching DENY
    always wins over any ALLOW". The code (`acl_manager.cpp`,
    `calculate_effective_permissions`) evaluates by tier, most specific first, and a
    deny wins only within its tier. Update the spec to match.
  - `INTEGRATORS_GUIDE.md` §2 says the exchange mints an "IP-bound session token";
    `aip` is stamped by the bridge but only checked by provisioning. Either enforce
    it in the bridge for service tokens or reword.
  - Add folder_actions (:8099), share (:8101/8102) and difference to the guide's
    service and CORS tables.
  - difference_service and provisioning both default to :8100; move one.
  - `commercial_provisioning/README.md` still says specification stage;
    `share_service/README.md` still says M0 only.
  - The guide describes `grant_read`; mark it unavailable until X2 ships.

---

## 14. X12: "Open in <integration>" links in the official client

### 14.1 Goal

Users of an embedding application are also ordinary FileEngine users who work in the
official client for other storage. The embedding app can already send a user into the
client with a one-time sign-in hand-off (`SessionManager.handoff()`, §5.5). The reverse
is missing: from a file or folder the integration manages, the client cannot lead back
to the integration's record (for Canopy, the deliverable or credit).

### 14.2 Shape

- The integration registry (§14.1 of the kit spec) gains optional **link templates**
  per integration: `{label: "Open in Canopy", node: "https://canopy.example.com/t/{tenant}/deliverables/{x.canopy.deliverable}", folder: "…/credits/{x.canopy.credit}"}`.
  Placeholders are the tenant and X3 integration-owned metadata keys only.
- The official client shows the link in the file drawer and folder header when every
  placeholder resolves on that node. No link is shown otherwise.
- The client opens the link in a new tab. Sign-in on the integration side is the
  integration's concern (it can use the same directory and SSO).
- Operator-configured only (deployment CLI), never set by end users, since it puts an
  outside URL in front of users.

## 15. X13: Drive connection for embedding apps

Users can already create WebDAV credentials and mount scripts in the official client
(`frontend/src/components/WebDavCredentials.vue`, `ldap_manager`
`/v1/me/service-credentials`). An embedding app should not duplicate credential
management, but should help a user mount **its** folder.

- **Minimum (no FileEngine change):** the embedding app shows the drive address of a
  folder (`https://<tenant>-drive.<base>/<path>`) and a hand-off link to the client's
  credential page.
- **`<fe-drive-connect folder="<uid>">`** (MIT, clean-room, kit spec §3): resolves the
  folder's path, generates non-secret Bash and PowerShell mount scripts pointing at
  it, and links to the credential page via hand-off. Lists the user's existing
  `webdav` credentials (key id, label, last used) so the user can pick one.
- **ldap_manager:** add the CORS allow-list other services have, so the component can
  list credentials from the host origin; accept `expires_at` and `allowed_cidrs` on
  create (both already stored by `service_cred.py`).
- **Optional, later:** a credential bound to one folder, so the drive shows only that
  subtree. Path-pointed mounts cover most of the need without it.

## 16. X14: Private subtrees and folder ACL policy (core)

### 16.1 Problem

FileEngine is read-by-default within a tenant: if no ACL tier decides the read bit,
read is allowed (`acl_manager.cpp`, `calculate_effective_permissions`; `default_read_`
is fixed to `true` with no configuration switch). Embedding apps that keep their own
access model (Canopy's `own_discipline`) need their spaces private, while the rest of
the tenant keeps today's behaviour.

The working pattern today is the private-home shape: on the space root, `everyone`
DENY read and role ALLOW rules, both with `ACL_INHERIT`. Role rules decide before the
`everyone` tier, so members read and others are refused. It leaves four gaps:

1. **Moves.** `FileSystem::move` keeps the file's own rules. A file moved in from a
   home folder or another space keeps rules that are wrong for its new place.
2. **Existing descendants.** Inheritance is copied at creation only. Changing a
   folder's rules does not reach existing files; the bridge's recursive walk can time
   out part-way (`PROPOSAL_subtree_acl_apply.md`).
3. **Creator rights.** A creator gets full control including `MANAGE_ACL`, so any
   uploader can widen access to their file.
4. **Service readers.** Services that read content (csai indexing and previews,
   difference_service, folder_actions) hold no tenant roles. Whether they can read
   inside an `everyone`-denied subtree must be confirmed and, if needed, solved once
   for private homes and spaces alike.

### 16.2 Proposal

1. **`private` folder flag, evaluated at check time.** A folder attribute (set by
   provisioning, readable by everyone, changeable only with `MANAGE_ACL` on the folder
   and by tenant administrators). When checking a node, if any ancestor up to the
   tenant root is `private`, the read-by-default fall-through is off for that check.
   Explicit rules still apply as today. Because it is evaluated, it covers moved-in
   and existing files with no rewrite. Ancestors are already walked for traversal and
   deleted-ancestor checks; cache the nearest private ancestor per node with the ACL
   cache.
2. **Folder ACL policy: `on_move_in: replace`.** Optional per folder. A file or
   folder moved in has its rules replaced by the destination's inheritable rules plus
   its owner's default rights, exactly as if created there. Default `keep` (today's
   behaviour).
3. **Folder ACL policy: `creator_rights`.** Optional per folder: the default rights a
   creator receives on new items inside it. For spaces: read, write, delete, version
   rights, but not `MANAGE_ACL`. Default: today's full control.
4. **Subtree ACL apply.** Adopt option A of `PROPOSAL_subtree_acl_apply.md` (a subtree
   form of grant and revoke, executed in the database). Provisioning's `enforce` mode
   and X7 parameter updates use it.
5. **Service readers.** Either list the content services' principals in a reserved
   tenant role that blueprints and home provisioning grant read to, or give
   `FILEENGINE_SERVICE_PRINCIPALS` read through `private` subtrees. Decide once
   (open question 9).

Provisioning gains blueprint keys for 1 to 3 (`private: true`, `acl_policy:
{on_move_in, creator_rights}`), and the official client shows a private folder's
status in the drawer so tenant users understand why a folder they can see the name of
will not open.

### 16.3 Canopy fallback until X14 lands

Canopy re-applies its folder rules to a file on every `file.created` and `file.moved`
webhook inside a space, using its integration service principal (which needs
`MANAGE_ACL` on spaces). This is a race (a file is exposed until the webhook runs, and
until the next sweep if the event is lost), so X14 is P1.

---

## 17. Security notes

- Every new server-to-server surface (X1, X2.3, X7, X8, X9) uses the existing
  integration registry, short single-use assertions, capability claims, scope
  claims and `aip` enforcement. No new credential type.
- X1 is the most sensitive: it creates identities. Keep it opt-in per deployment
  (`IDN_ENABLED`), restricted to a role prefix, unable to touch `administrators`,
  and fully audited. It removes access only by removing groups in one tenant, never
  by changing a user's global entry, so it cannot affect a user's other tenants.
- X3 must be enforced in the core, not a door, or the MCP and WebDAV doors bypass it.
- X2.2 read grants are per file and version, short-lived and audited.
- X8 links keep a human owner (`on_behalf_of`) so drops are attributable.
- X12 link templates are operator-configured only; they put an outside URL in front of users.
- X14 narrows access only: it removes a default grant and never adds one, so a mistake fails closed (a file nobody can read) rather than open.

## 18. Open questions for the owner

1. **X1 placement.** ldap_manager (proposed) or a new identity lane in
   commercial_provisioning? ldap_manager already owns LDAP writes and invites.
2. **X1 global entries.** X1 creates global user entries but never removes them.
   Is an orphaned entry (no groups in any tenant) cleaned up by an existing process,
   or does one need adding?
3. **X3 enforcement point.** Core-level enforcement needs the integration identity in
   the gRPC `AuthenticationContext` (a claim such as `integration=<id>`). Acceptable?
4. **X4 metadata per version.** Expose `GetMetadataForVersion` on the bridge?
5. **X8.** Is integration-minted drop links acceptable under the share-link threat
   model (`share_service/design_documents/OUTSIDE_SHARE_LINKS.md`), given the link
   owner is delegated rather than present?
6. **Order.** Proposed: X11 and X1 first (unblocks any integration), then X14, X5,
   X4, X2, X3, X6, then P2 and P3.
7. **X14 `private` flag vs. tenant setting.** Is a per-folder flag right, or should a
   tenant be able to choose private-by-default for all new content?
8. **X14 move-in policy.** Should `replace` be the default inside private folders?
9. **X14 service readers.** Reserved role granted read, or service principals exempt
   from the private fall-through? Private homes need the same answer.

## 19. Phases

| Phase | Contents | Unblocks for Canopy |
| --- | --- | --- |
| A | X11, X1, X14 | Users can be signed in by delegated exchange; spaces are private |
| B | X5, X4, X3 | Docs view: upload, replace, history, linked ids |
| C | X2, X6 | Deliverable review pipeline and Green Canary upload queue |
| D | X7, X8 | Generated per-credit spaces; subcontractor drops |
| E | X9, X10 | Extraction for Canopy-owned credits; drawer and diffs |
| F | X12, X13 | Moving between the official client and the embedding app; drives on a project folder |
