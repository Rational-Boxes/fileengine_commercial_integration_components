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

P1 is what Canopy needs for its Docs view and deliverable pipeline. Each feature is
shippable on its own; dependencies are noted per section.

---

## 3. X1: Integration identity API

### 3.1 Goal

An integration's backend keeps FileEngine's directory in step with its own user
store, so delegated exchange works for every user without a human tenant admin.
The integration's user store stays the source of truth for who exists; FileEngine's
LDAP becomes a projection of it within a bounded scope.

### 3.2 Shape

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
| `PUT /v1/integration/tenants/{t}/users/{external_id}` | Upsert `{uid?, email, given_name, surname, display_name, login: "delegated_only" \| "invite", roles?: [..]}`. Idempotent by `(integration, tenant, external_id)`. Returns the directory `uid` to use as `sub`. |
| `DELETE /v1/integration/tenants/{t}/users/{external_id}` | Deactivate: remove from every prefixed role and disable login. Never deletes the entry (files keep an owner). `?purge=true` only if the operator enables it. |
| `GET /v1/integration/tenants/{t}/users?external_id=&since=` | List users this integration manages. |
| `PUT /v1/integration/tenants/{t}/roles/{role}` | Create a prefixed role (idempotent). |
| `DELETE /v1/integration/tenants/{t}/roles/{role}` | Delete a prefixed role it created. |
| `PUT /v1/integration/tenants/{t}/roles/{role}/members` | Replace the full member list: `{external_ids: [..]}`. Idempotent; returns added/removed. |
| `POST /v1/integration/tenants/{t}/sync` | Bulk form of the above in one transaction-like call, with `dry_run`. For nightly reconciliation. |

### 3.3 Rules

- `login: "delegated_only"` (default) creates the user with no usable password and
  marks the entry so `/v1/auth/token` (password) and OAuth refuse it. Sessions come
  only from the integration's exchange. `invite` uses the existing invite mail flow
  for users who should also use the official client.
- Users created this way carry a `managedBy=<integration_id>` attribute. The official
  client shows them as externally managed and refuses local edits to managed roles,
  mirroring provisioning's `managed_by` on folders.
- A user the integration did not create (an existing tenant user) can be **adopted**
  by `PUT` with that user's `uid` only if the operator sets `IDN_ALLOW_ADOPT`;
  otherwise `409 not_managed`.
- Role changes take effect on the user's next token refresh (at most 15 minutes),
  the existing re-mint-from-directory behaviour. A `POST .../users/{external_id}/revoke-sessions`
  ends live sessions at once (uses the existing jti revocation list).
- Every call emits `identity.*` audit entries (category `user`, `source_iface: rest`).

### 3.4 Tenant creation

Out of scope here. Tenants are created by the deployment's tenant play
(`ldap_manager/src/ldap_manager/routers/tenant_onboarding.py`). If an integration
must create tenants itself (a multi-tenant Canopy, Canopy open question
"Tenancy"), that is a separate proposal; record the need, do not fold it in.

### 3.5 Canopy use

`Person` maps to a managed user (`external_id` = Person id). `TeamAssignment`
rows project onto prefixed roles, for example `canopy-<project>-<function>` and
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

## 14. Security notes

- Every new server-to-server surface (X1, X2.3, X7, X8, X9) uses the existing
  integration registry, short single-use assertions, capability claims, scope
  claims and `aip` enforcement. No new credential type.
- X1 is the most sensitive: it creates identities. Keep it opt-in per deployment
  (`IDN_ENABLED`), restricted to a role prefix, unable to touch `administrators`,
  and fully audited. Deactivate rather than delete.
- X3 must be enforced in the core, not a door, or the MCP and WebDAV doors bypass it.
- X2.2 read grants are per file and version, short-lived and audited.
- X8 links keep a human owner (`on_behalf_of`) so drops are attributable.

## 15. Open questions for the owner

1. **X1 placement.** ldap_manager (proposed) or a new identity lane in
   commercial_provisioning? ldap_manager already owns LDAP writes and invites.
2. **X1 purge.** Should `DELETE ?purge=true` exist at all, given erasure exists for
   files but users own files?
3. **X3 enforcement point.** Core-level enforcement needs the integration identity in
   the gRPC `AuthenticationContext` (a claim such as `integration=<id>`). Acceptable?
4. **X4 metadata per version.** Expose `GetMetadataForVersion` on the bridge?
5. **X8.** Is integration-minted drop links acceptable under the share-link threat
   model (`share_service/design_documents/OUTSIDE_SHARE_LINKS.md`), given the link
   owner is delegated rather than present?
6. **Order.** Proposed: X11 and X1 first (unblocks any integration), then X5, X4, X2,
   X3, X6, then P2 and P3.

## 16. Phases

| Phase | Contents | Unblocks for Canopy |
| --- | --- | --- |
| A | X11, X1 | Users can be signed in by delegated exchange |
| B | X5, X4, X3 | Docs view: upload, replace, history, linked ids |
| C | X2, X6 | Deliverable review pipeline and Green Canary upload queue |
| D | X7, X8 | Generated per-credit spaces; subcontractor drops |
| E | X9, X10 | Extraction for Canopy-owned credits; drawer and diffs |
