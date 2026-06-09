# Job Search HQ

Personal job-search dashboard: a Sankey funnel of every application through the pipeline, application tracking with recruiter contacts, and social-post analytics. Multi-user with invite-code registration.

## Stack

- Node 18+ / Express, no build step
- Postgres (any provider: Railway, Neon, Supabase, RDS, local)
- Vanilla JS frontend served from `public/`
- Cookie sessions (signed, httpOnly), bcrypt password hashing

## Run locally

```bash
cp .env.example .env        # then edit it
npm install
npm start                   # http://localhost:3000
```

Required environment variables (see `.env.example`):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. SSL is enabled automatically for `sslmode=require` URLs and known hosts (Neon/Supabase/Render), or force with `DATABASE_SSL=true`. |
| `SESSION_SECRET` | Long random string signing session cookies. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `INVITE_CODE` | Secret required to create an account. Unset = registration disabled. |
| `PORT` | Default 3000. |
| `NODE_ENV` | Set `production` in prod (enables Secure cookies — requires HTTPS). |

The schema (`schema.sql`) is applied automatically on boot; no migration step needed.

## Deploy (Railway or similar)

1. Create a project from this repo; add a Postgres service. Railway injects `DATABASE_URL` automatically when you reference it in the app service variables.
2. Set `SESSION_SECRET`, `INVITE_CODE`, `NODE_ENV=production`. Start command: `npm start`.
3. Point your domain at the service (custom domain + CNAME). Cookies are `Secure` in production, so HTTPS is required — Railway provides it.
4. Register your account at `/login.html` using the invite code, then consider rotating the code.

## API

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/auth/register` | POST | invite code | `{email, password, invite}` |
| `/api/auth/login` | POST | — | `{email, password}` |
| `/api/auth/logout` | POST | session | |
| `/api/auth/me` | GET | session | |
| `/api/state` | GET | session | `{apps, posts, platforms}` |
| `/api/state` | PUT | session | Full-state replace, transactional. Client autosaves (debounced) after every edit. |
| `/healthz` | GET | — | liveness |

## Importing data

Dashboard → **Import**: paste JSON or upload a `.json` file. Accepted shapes:

- This app's own backups: `{ "apps": [...], "posts": [...] }`
- A bare array of posts — LinkedIn-style fields recognized: `text`/`commentary`/`title`, `views`/`impressions`, `likes`/`reactions`, `comments`, `date`/`createdAt`
- A bare array of applications: `company`/`companyName`, `role`/`title`/`jobTitle`, `status` (mapped to pipeline stage by keywords like *screen, interview, final, offer, rejected*), `url`, `appliedAt`/`dateApplied`, optional `recruiter`/`contact`

Duplicates (same company+role, or same date+post text) are skipped.

## Data model

- `users` — email, bcrypt hash, JSON list of social platforms
- `applications` — stage 0–4 (Applied → Recruiter Screen → Interview → Final Round → Offer), outcome (`active|rejected|ghosted|withdrawn`), recruiter contact as JSONB (`name, profile, email, phone, lastContacted`)
- `posts` — date, platform, title/link, impressions, reactions, comments

The Sankey is computed client-side from stage+outcome; flow conservation means every application appears exactly once in a terminal node (Offer, In Pipeline, Rejected, Ghosted, Withdrawn).
