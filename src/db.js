'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
const needSsl =
  process.env.DATABASE_SSL === 'true' ||
  /sslmode=require/i.test(url) ||
  /(neon\.tech|supabase\.|render\.com|herokuapp)/i.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: needSsl ? { rejectUnauthorized: false } : undefined,
  max: 10
});

async function init() {
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(ddl);
  // Tables created before the origin column existed need it added in place.
  try { await pool.query("ALTER TABLE applications ADD COLUMN origin TEXT NOT NULL DEFAULT 'self'"); }
  catch (e) { /* column already exists */ }
  // v1: stages renumbered 0-4 -> 1-5 when Recruiter Outreach became stage 0.
  const { rows } = await pool.query('SELECT version FROM schema_migrations WHERE version = 1');
  if (!rows.length) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE applications SET stage = stage + 1');
      await client.query('INSERT INTO schema_migrations (version) VALUES (1)');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

/* ---------- users ---------- */
async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return rows[0] || null;
}
async function createUser(email, passwordHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email.toLowerCase(), passwordHash]
  );
  return rows[0];
}
async function getUser(id) {
  const { rows } = await pool.query('SELECT id, email, platforms FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

/* ---------- sanitizers ---------- */
const OUTCOMES = ['active', 'rejected', 'ghosted', 'withdrawn'];
const str = (v, max = 2000) => String(v ?? '').slice(0, max);
const int = (v, min, max) => Math.min(max, Math.max(min, Math.trunc(+v) || 0));

function cleanApp(a) {
  const origin = a.origin === 'recruiter' ? 'recruiter' : 'self';
  const stage = Math.max(int(a.stage, 0, 5), origin === 'self' ? 1 : 0);
  return {
    id: str(a.id, 64) || Math.random().toString(36).slice(2, 12),
    company: str(a.company, 200),
    role: str(a.role, 200),
    link: str(a.link, 1000),
    dateApplied: str(a.dateApplied, 10),
    stage,
    origin,
    outcome: OUTCOMES.includes(a.outcome) ? a.outcome : 'active',
    notes: str(a.notes, 4000),
    recruiter: a.recruiter && typeof a.recruiter === 'object' ? {
      name: str(a.recruiter.name, 200),
      company: str(a.recruiter.company, 200),
      profile: str(a.recruiter.profile, 1000),
      email: str(a.recruiter.email, 200),
      phone: str(a.recruiter.phone, 50),
      lastContacted: str(a.recruiter.lastContacted, 10)
    } : null,
    updated: str(a.updated, 10)
  };
}
function cleanPost(p) {
  return {
    id: str(p.id, 64) || Math.random().toString(36).slice(2, 12),
    date: str(p.date, 10),
    platform: str(p.platform, 100) || 'LinkedIn',
    title: str(p.title, 2000),
    impressions: int(p.impressions, 0, 1e9),
    reactions: int(p.reactions, 0, 1e9),
    comments: int(p.comments, 0, 1e9)
  };
}

/* ---------- state ---------- */
async function getState(userId) {
  const [apps, posts, user, companies] = await Promise.all([
    pool.query('SELECT * FROM applications WHERE user_id = $1', [userId]),
    pool.query('SELECT * FROM posts WHERE user_id = $1', [userId]),
    getUser(userId),
    pool.query('SELECT name, notes FROM companies WHERE user_id = $1', [userId])
  ]);
  return {
    apps: apps.rows.map(r => ({
      id: r.id, company: r.company, role: r.role, link: r.link,
      dateApplied: r.date_applied, stage: r.stage, origin: r.origin || 'self', outcome: r.outcome,
      notes: r.notes, recruiter: r.recruiter, updated: r.updated
    })),
    posts: posts.rows.map(r => ({
      id: r.id, date: r.date, platform: r.platform, title: r.title,
      impressions: r.impressions, reactions: r.reactions, comments: r.comments
    })),
    platforms: (user && user.platforms) || ['LinkedIn'],
    companies: companies.rows
  };
}

// Full-state replace in one transaction (client always sends its complete state).
async function putState(userId, { apps, posts, platforms, companies }) {
  if (apps.length > 5000 || posts.length > 5000 || (Array.isArray(companies) && companies.length > 5000)) throw new Error('too many rows');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM applications WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM posts WHERE user_id = $1', [userId]);
    for (const raw of apps) {
      const a = cleanApp(raw);
      await client.query(
        `INSERT INTO applications (id, user_id, company, role, link, date_applied, stage, outcome, origin, notes, recruiter, updated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [a.id, userId, a.company, a.role, a.link, a.dateApplied, a.stage, a.outcome, a.origin, a.notes,
         a.recruiter ? JSON.stringify(a.recruiter) : null, a.updated]
      );
    }
    for (const raw of posts) {
      const p = cleanPost(raw);
      await client.query(
        `INSERT INTO posts (id, user_id, date, platform, title, impressions, reactions, comments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.id, userId, p.date, p.platform, p.title, p.impressions, p.reactions, p.comments]
      );
    }
    if (Array.isArray(companies)) {
      await client.query('DELETE FROM companies WHERE user_id = $1', [userId]);
      const seen = new Set();
      for (const raw of companies) {
        const name = str(raw && raw.name, 200).trim();
        const k = name.toLowerCase();
        if (!name || seen.has(k)) continue;
        seen.add(k);
        await client.query('INSERT INTO companies (user_id, name, notes) VALUES ($1, $2, $3)',
          [userId, name, str(raw.notes, 8000)]);
      }
    }
    if (Array.isArray(platforms)) {
      const clean = platforms.map(x => str(x, 100)).filter(Boolean).slice(0, 50);
      await client.query('UPDATE users SET platforms = $1 WHERE id = $2',
        [JSON.stringify(clean.length ? clean : ['LinkedIn']), userId]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, findUserByEmail, createUser, getUser, getState, putState };
