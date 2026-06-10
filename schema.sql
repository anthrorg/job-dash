-- Reference DDL. The app runs this automatically on boot (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  platforms     JSONB NOT NULL DEFAULT '["LinkedIn"]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id           TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company      TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT '',
  link         TEXT NOT NULL DEFAULT '',
  date_applied TEXT NOT NULL DEFAULT '',
  stage        INTEGER NOT NULL DEFAULT 0,      -- 0 Recruiter Outreach .. 5 Offer
  outcome      TEXT NOT NULL DEFAULT 'active',  -- active|rejected|ghosted|withdrawn
  origin       TEXT NOT NULL DEFAULT 'self',    -- self|recruiter (recruiter reached out first)
  notes        TEXT NOT NULL DEFAULT '',
  recruiter    JSONB,                           -- {name,company,profile,email,phone,lastContacted} or null
  updated      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT 'LinkedIn',
  title       TEXT NOT NULL DEFAULT '',
  impressions INTEGER NOT NULL DEFAULT 0,
  reactions   INTEGER NOT NULL DEFAULT 0,
  comments    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS companies (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  notes   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, name)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
