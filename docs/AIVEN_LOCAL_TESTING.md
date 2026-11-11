# Aiven PostgreSQL for local React testing

Use a separate empty hosted test service. The application continues running on your computer; this does not deploy it, import SQLite data or enable email.

1. Sign in at https://console.aiven.io/ and create a PostgreSQL service. Select the Free tier if offered and wait for Running. See [Aiven getting started](https://aiven.io/docs/products/postgresql/get-started) and [free-tier limits](https://aiven.io/docs/products/postgresql/concepts/pg-free-tier).
2. Open the service Overview, then Quick connect. Copy the full connection URI privately into `NODE_DATABASE_URL` in `backend/.env`. It contains the database password. Aiven's database login is separate from your Dream Events login.
3. Download the service CA certificate and save it as `backend/certs/ca.pem`. The directory is prepared and PEM files are ignored by Git. See [Aiven TLS guidance](https://aiven.io/docs/products/postgresql/howto/list-code-samples).
4. In `backend/.env`, set `PG_SSL=true`, set `PG_CA_FILE` to the absolute certificate path using forward slashes, set `PG_POOL_MAX=5`, and retain `EMAIL_ENABLED=false`. Preserve the existing encryption-key settings. The root `.env` belongs to legacy SQLite and stays unchanged.
5. Set `PRISMA_MIGRATION_DATABASE_URL` privately to the same connection URI with `sslmode=verify-full` and `sslrootcert` pointing to the absolute CA file path. URL-encode query values where needed. Runtime PG_CA_FILE does not configure Prisma CLI automatically. See [deployment notes](DEPLOYMENT.md#aiven-and-reviewed-migration).

From the project root, check the connection without writing database records:

```powershell
npm --prefix backend run db:check
```

On success it reports TLS and application-table readiness without printing credentials. Only after confirming the target is the new empty test database, install the schema and create the account:

```powershell
npm --prefix backend run db:migrate
npm --prefix backend run create-admin
```

Choose username `hussien_ahmed66`, a display name, and a private password of 12-256 characters. Hidden password prompts display no typed characters. In a fresh database the first account is Super Admin. Existing installations require an existing Super Admin login and second factor. Finish authenticator setup on the React sign-in screen and keep recovery codes privately.

Start the backend and React admin in separate terminals:

```powershell
npm --prefix backend run start:prod
```

```powershell
npm --prefix admin-web run dev
```

Open http://127.0.0.1:5174. The new account/test records live in PostgreSQL; original SQLite records remain in `data/aast.db`.


## Current workspace checkpoint

On 11 November 2026 the supplied Aiven test database connected with verified TLS, all five migrations completed, and `hussien_ahmed66` was created as Super Admin through a private terminal prompt. API and React admin run locally at ports 3000 and 5174. First sign-in requires authenticator enrollment. SQLite records were not imported or replaced.

This fresh Node installation uses the ignored `backend/data/node-app.key`. Back it up privately with backend configuration. It does not replace the unavailable original legacy key; recover that original separately before migrating encrypted legacy profiles.
