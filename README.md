# Garage Amedro

A car logbook for repairs, purchases, fill-ups and maintenance reminders. It works out fuel consumption, total spend and cost per kilometre on its own. It runs on phones and desktops, with user accounts and its own database. The interface is in Russian.

Live site: https://garage.dvoted.club

## What's inside

- **Frontend:** React 19, Vite, TypeScript and hand-written SVG charts. It installs as a PWA and works offline: records wait in a queue and go to the server once the connection is back.
- **Backend:** Cloudflare Workers, Hono and D1 (SQLite).
- **Photos and spreadsheet:** stored on the user's own Google Drive. The database holds only text and links.
- **Shared code:** `shared/` contains all the calculations. The site and the spreadsheet export use the same code, so their numbers can't drift apart.

```
shared/         calculations, number parsing, backup, reminders, spreadsheet, schemas
worker/         API: sign-in and data
worker/google/  Google sign-in, Drive, Sheets and photos
src/            user interface; src/lib/sync.ts is the record queue
migrations/     database schema
tests/          unit, API and browser tests
scripts/        icons, screenshots and the live site check
```

## Development

```sh
npm install
cp .dev.vars.example .dev.vars    # then fill in the values
npm run db:migrate:local
npm run dev
```

```sh
npm test            # calculations and API
npm run test:e2e    # browser tests on desktop and mobile
npm run typecheck   # code, tests and configuration
npm run cf-typegen  # after changing wrangler.jsonc
```

Record types are derived from the schemas in `shared/schema.ts`, so a field changes in one place. To check the live site after a deploy, run `node scripts/live-check.mjs`.

## Configuration

Secrets are set with `wrangler secret put` and never go into the repository.

| Secret | Purpose |
|---|---|
| `PASSWORD_PEPPER` | pepper for password hashes |
| `TOKEN_KEY` | 32 bytes in base64url, the encryption key for Google tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in, Drive and Sheets |
| `TURNSTILE_SECRET` | bot check at registration |

Without Google the site still works, but the gallery and Google Sheets are turned off. Password reset emails need the paid Workers plan: add a `send_email` binding named `EMAIL` and an `EMAIL_FROM` variable.

Google Cloud needs the Drive API, the Sheets API and a "Web application" OAuth client with the redirect URI `https://<domain>/api/google/callback`. The app requests only the `drive.file` scope, so it can see only the files it created itself.

## Deployment

```sh
npm run deploy
```

This builds the app, applies database migrations and deploys. If a migration fails, nothing is deployed.

## Security

Found a vulnerability? Please [report it privately](https://github.com/DmytroComrad/d.garage/security/advisories/new) instead of opening a public issue, so it can be fixed before the details become public.

- The site runs on HTTPS only: the Worker redirects pages and rejects state-changing requests made over HTTP.
- Passwords: PBKDF2 with a salt and a secret pepper.
- Sessions: a random token in an HttpOnly cookie, with only its hash in the database.
- Google tokens: AES-GCM encrypted and bound to the user. A Drive connection requires an email address verified by Google.
- All data queries are scoped by `user_id`, and a composite primary key stops one user from touching another user's records.
- State-changing requests are accepted only from the site's own origin.
- Rate limiting, sign-in lockout after failed attempts, and Turnstile at registration.
- Only images can be uploaded, and the type is checked from the file's contents. They are served with `nosniff` and a CSP `sandbox`.
