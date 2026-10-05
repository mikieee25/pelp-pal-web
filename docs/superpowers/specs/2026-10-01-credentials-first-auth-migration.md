# Credentials-First Auth Migration

## Goal

Allow PELP Pal web and Flutter clients to authenticate with account credentials without enrollment codes while preserving offline login, organization isolation, role permissions, conflict-safe sync, revocation, and password-change propagation.

## Chosen identity model

Supabase Auth becomes the online identity provider. Each `organization_accounts` row receives an `auth_user_id` and a server-generated internal Auth alias. Email/password remains the canonical online credential because Supabase Auth password authentication is defined around email or phone identifiers; the existing username remains the organization-facing login alias and is mapped to the Auth identity by a server-side function.

The alias is a non-delivery address derived from the immutable account id (for example, `account-<account-id>@auth.pelp-pal.test`). It is never shown as a contact address, is not used for email recovery, and is not supplied by the browser or phone. Users continue to enter their organization username in the login UI. The alias domain must be validated in a disposable Supabase project before production provisioning.

The browser and phone keep a local Argon2id verifier for offline login. The server never returns password hashes. A password change updates Supabase Auth and increments an account credential version. Clients that are offline continue to use their last valid local credential until the next account-version pull, after which they must complete an online login before offline login is accepted again.

## Authorization model

`organization_accounts.auth_user_id` is the source for organization, username, role, active state, and catalog scope. RLS policies and security-definer RPCs resolve the current account from `auth.uid()` through this mapping. `devices` and enrollment codes become legacy records used only for historical data and optional audit metadata; no read, write, Storage, Realtime, or sync authorization depends on an enrolled device row.

Historical `device_id` columns remain readable during the migration. New writes use the authenticated account identity and a nullable legacy device reference where the existing schema requires one. A later cleanup can remove legacy device columns after all clients and reports have moved to account identity.

The account whose username is `maog` must be configured as an active `admin` account in `organization_accounts`. Authorization checks the account role and organization context, never a hardcoded username. That admin can reset another account's password through a protected server function. There is no self-service email/SMS recovery path in this model.

## Password change behavior

An authenticated client calls Supabase Auth `updateUser({ password, current_password })`. The server-side account record increments `credential_version` through a protected RPC or Edge Function. The web client immediately replaces its local Argon2id verifier. Flutter pulls the new version and requires an online Supabase Auth login with the new password before replacing its local verifier. Password hashes never travel through ordinary account or catalog queries.

For a forgotten password, the admin reset function accepts an account id or username plus a temporary password, verifies that the caller resolves to an active admin account, updates the mapped Supabase Auth user, increments `credential_version`, and marks the target account as requiring an online sign-in. It returns no password hash and does not send email.

## Migration constraints

- Enrollment UI and anonymous sign-in are removed only after account-based RLS and online login are available.
- Existing organization accounts need an internal Auth alias/Auth identity before they can use online credentials; no real email address or mail delivery is required.
- The migration must keep legacy devices and enrollment records until historical rows, pending outbox items, and deployed Flutter builds have crossed the compatibility window.
- No service-role or secret key may reach either client.
- Account lookup and login failures use generic messages and rate-limited Edge Functions to reduce account enumeration.
- Auth aliases are generated server-side from immutable account ids; clients cannot choose or change them.
- Offline login is allowed only for an active account whose local credential version matches the latest known account version.
- A password change must invalidate the previous online session where Supabase Auth supports it and must invalidate stale local sessions at the next version check.

## Non-goals

- No custom JWT signing service.
- No password hashes in `organization_accounts` or the browser-visible Data API.
- No deletion of historical inspection/device references during the first migration.
- No silent conversion of unresolved inspection conflicts into last-write-wins.
