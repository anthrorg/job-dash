'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const db = require('./src/db');
const auth = require('./src/auth');

const app = express();
app.set('trust proxy', 1); // behind nginx/caddy/host proxy
app.use(express.json({ limit: '4mb' }));
app.use(cookieSession({
  name: 'jobdash',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production'
}));

app.use('/api/auth', auth.router);

const requireAuth = (req, res, next) =>
  req.session.userId ? next() : res.status(401).json({ error: 'unauthorized' });

app.get('/api/state', requireAuth, async (req, res, next) => {
  try { res.json(await db.getState(req.session.userId)); } catch (e) { next(e); }
});

app.put('/api/state', requireAuth, async (req, res, next) => {
  try {
    const { apps, posts, platforms, companies } = req.body || {};
    if (!Array.isArray(apps) || !Array.isArray(posts)) {
      return res.status(400).json({ error: 'apps and posts arrays are required' });
    }
    await db.putState(req.session.userId, { apps, posts, platforms, companies });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// Pages: dashboard requires a session, otherwise go log in.
app.get('/', (req, res) =>
  req.session.userId
    ? res.sendFile(path.join(__dirname, 'public', 'index.html'))
    : res.redirect('/login.html'));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(port, () => console.log('Job Search HQ listening on :' + port)))
  .catch(e => { console.error('Database init failed:', e); process.exit(1); });

module.exports = app;
