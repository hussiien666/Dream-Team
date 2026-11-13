# Project continuity

- Read `SESSION_HANDOFF.md` first, then `docs/PRODUCTION_MIGRATION_SPEC.md`, `docs/REACT_ADMIN_PARITY.md` and the existing React/Node specifications for preserved behavior. The latest production prompt supersedes earlier Firestore/Functions/provider choices. Earlier stop instructions are historical; the user resumed development.
- Continue toward React/Vercel, NestJS/Cloud Run, PostgreSQL/Cloud SQL, Firebase Authentication, Workspace/Gmail API sending only, Cloudflare DNS and the independent scanner. Keep working providers, Streamlit and original SQLite operational until replacement parity and safe removal are verified. Aiven is still authoritative; its trial copy is not an automatic failover. Preserve the durable email queue and uncertainty handling. Do not silently switch any live data source.
- Deployment is held until explicit confirmation of BOTH Google AI Pro/developer-credit availability and updated Google Cloud billing address/account readiness. This supersedes earlier deployment authorization. No deployment, hosted production migration, billing changes, domain purchase, DNS changes or live email now. Continue independent local implementation/testing while the owner is asleep; record external setup gaps honestly.
- Keep regular Python 3.10: the user explicitly does not want a venv.
- Preserve all existing IDs, password hashes, QR identities, history and secrets. Migration exports/reports are sensitive; protect them and use ignored directories. Do not print `.env`, keys or raw credentials.
- Keep the handoff current with actual test results, migration state, known limitations and the next resume point. Do not call scaffolding complete functionality.
- `backend/AGENTS.md` contains additional NestJS/ESM/testing guidance for that directory.

- Do not deploy, run production migrations, change DNS, delete Streamlit or send live email without explicit authorization. Keep updates brief and inspect only relevant files.
