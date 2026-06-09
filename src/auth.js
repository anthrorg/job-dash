'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const { email, password, invite } = req.body || {};
    const code = process.env.INVITE_CODE;
    if (!code) return res.status(403).json({ error: 'Registration is disabled.' });
    if (invite !== code) return res.status(403).json({ error: 'Invalid invite code.' });
    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Enter a valid email.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (await db.findUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });
    const user = await db.createUser(email, await bcrypt.hash(password, 12));
    req.session.userId = user.id;
    res.json({ ok: true, email: user.email });
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const user = email ? await db.findUserByEmail(email) : null;
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    req.session.userId = user.id;
    res.json({ ok: true, email: user.email });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

router.get('/me', async (req, res, next) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
    const u = await db.getUser(req.session.userId);
    if (!u) { req.session = null; return res.status(401).json({ error: 'unauthorized' }); }
    res.json({ id: u.id, email: u.email });
  } catch (e) { next(e); }
});

module.exports = { router };
