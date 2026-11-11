# Project continuity

- Read `SESSION_HANDOFF.md` first, then `docs/REACT_ADMIN_SPEC.md`, `docs/REACT_ADMIN_PARITY.md`, `docs/NODE_MIGRATION.md` and `docs/NODE_PRODUCT_SPEC.md`. The Node specification supersedes the earlier Python-backend architecture. Earlier stop instructions in `docs/CHECKPOINT.md` are historical; the user resumed development.
- Continue the existing implementation incrementally. Node/NestJS/TypeScript with Prisma/PostgreSQL is the final backend authority; React/TypeScript/Vite in `admin-web/` is the final admin frontend, plus the independent React scanner. Keep Streamlit operational until parity/removal approval. Final providers are Vercel admin, Render API, Aiven PostgreSQL, Resend email and Cloudflare DNS. Legacy Python remains operational until verified cutover; do not silently point it at a new database.
- Keep regular Python 3.10: the user explicitly does not want a venv.
- Preserve all existing IDs, password hashes, QR identities, history and secrets. Migration exports/reports are sensitive; protect them and use ignored directories. Do not print `.env`, keys or raw credentials.
- Keep the handoff current with actual test results, migration state, known limitations and the next resume point. Do not call scaffolding complete functionality.
- `backend/AGENTS.md` contains additional NestJS/ESM/testing guidance for that directory.

- Do not deploy, run production migrations, change DNS, delete Streamlit or send live email without explicit authorization. Keep updates brief and inspect only relevant files.
