# Security checkpoint — 10 November 2026

**Historical checkpoint:** the user later resumed development and replaced the backend architecture with the [Node.js specification](NODE_PRODUCT_SPEC.md). Follow [SESSION_HANDOFF.md](../SESSION_HANDOFF.md) for current work; the earlier stop instruction below no longer applies.

The user requested stopping at the closest checkpoint while the full product upgrade was in progress. Stop after the regression and migration checks below; do not start a subsequent upgrade phase without a new instruction.

## Implemented at this checkpoint

- The previously verified organization/role/event-assignment stage remains in place.
- Super Admin password sign-in now leads to mandatory authenticator enrollment or verification before protected operations. The existing account/password is retained.
- TOTP enrollment QR/manual secret, encrypted secret storage, replay-counter checks, five-attempt lockout, expiring pending verification, single-use hashed recovery codes, and recovery-code regeneration.
- Server-side Streamlit session inactivity limit, configured with `ADMIN_IDLE_MINUTES` (default 30), in addition to the existing absolute expiry. The separate no-inactivity scanner-session policy is not active yet.
- Working Streamlit enrollment/verification/recovery interface and CLI verification for an already enrolled Super Admin.
- Additive migration `04_security_sessions` and schema foundations for subsequent security/scanner/job work.
- New security regression tests; existing administration UI tests now complete real verification using recovery codes rather than bypassing 2FA.

## Present as backend scaffolding, not complete features

Verified-email challenges, email-factor verification, single-use password-reset tokens, temporary-password generation/forced-change support, encrypted mail-job payloads, scanner session/access-code/preferences tables and permission-override tables exist. There is no durable mail worker, email-security UI, public reset route, scanner authorization service/portal or override-management service yet. Do not describe these features as finished. Email-security enrollment is deliberately not offered in the UI while delivery is unfinished. Existing Gmail PDF delivery remains available.

## Resume point

Finish Phase 2: implement durable mail processing and reset/email-factor endpoints/UI, scanner session rules/access codes/rate limits, temporary scanner password workflow, profiles and permission overrides. Then follow Phases 3–9 in [UPGRADE_PLAN.md](UPGRADE_PLAN.md) against [PRODUCT_SPEC.md](PRODUCT_SPEC.md). Do not restart the audit or replace working code.

Preserve old QR hashes and IDs. New encrypted artifact storage and legacy same-QR adoption have not been implemented. Check-in reversal still needs an append-only admission design; existing immutable check-ins remain unchanged.

## Key and data handling

`APP_ENCRYPTION_KEY` can supply a Fernet key privately, or `APP_KEY_FILE` can select a private file. Otherwise enrollment creates `data/secret.key`. Back up that exact key separately from the database and retain it when updating. Tests use temporary environment keys. Do not expose secrets, temporary passwords, recovery codes or reset-link tokens in ordinary logs.

The pre-security database backup is `data/backups/aast_before_security_20261110_112123_337676.db`. The trial upgrade preserved every existing table exactly and passed schema, foreign-key and integrity checks. Final validation results are recorded below once complete.

## Final validation and stop state

- Full suite: **52 passed in 85.84 seconds** on 10 November 2026.
- Migration applied to the live workspace: **04_security_sessions**. Every pre-existing table compared equal to the pre-security backup; `integrity_check` and `foreign_key_check` passed. `alembic check` found no schema differences.
- No real attendee email was sent. No virtual environment was created. Existing account passwords and ticket QR hashes remain unchanged.
- Development is **stopped at the user's request**. The next Super Admin sign-in requires authenticator enrollment if not already configured. The full platform upgrade is not complete.

Implementation references: [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) and [Fernet authenticated encryption](https://cryptography.io/en/latest/fernet/).
