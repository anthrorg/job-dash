// End-to-end API test using pg-mem (in-memory Postgres) + supertest.
// Run: npm test
'use strict';
process.env.DATABASE_URL = 'postgres://fake/fake';
process.env.SESSION_SECRET = 'test-secret';
process.env.INVITE_CODE = 'test123';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const { newDb } = require('pg-mem');
const mem = newDb();
const pgMock = mem.adapters.createPg();
require.cache[require.resolve('pg')] = { exports: pgMock };

const request = require('supertest');
const app = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  ' + JSON.stringify(extra)));
  if (!cond) failures++;
}

(async () => {
  await sleep(700); // let db.init() finish

  // unauthenticated
  let r = await request(app).get('/api/state');
  check('GET /api/state unauthenticated -> 401', r.status === 401, r.body);
  r = await request(app).get('/');
  check('GET / unauthenticated -> redirect to login', r.status === 302 && /login/.test(r.headers.location), r.headers);

  // registration
  r = await request(app).post('/api/auth/register').send({ email: 'jim@test.com', password: 'longenough', invite: 'nope' });
  check('register with bad invite -> 403', r.status === 403, r.body);
  r = await request(app).post('/api/auth/register').send({ email: 'jim@test.com', password: 'short', invite: 'test123' });
  check('register with short password -> 400', r.status === 400, r.body);
  r = await request(app).post('/api/auth/register').send({ email: 'jim@test.com', password: 'longenough', invite: 'test123' });
  check('register ok -> 200 + cookie', r.status === 200 && !!r.headers['set-cookie'], r.body);
  const cookie = r.headers['set-cookie'];
  r = await request(app).post('/api/auth/register').send({ email: 'jim@test.com', password: 'longenough', invite: 'test123' });
  check('duplicate email -> 409', r.status === 409, r.body);

  // login
  r = await request(app).post('/api/auth/login').send({ email: 'jim@test.com', password: 'wrongwrong' });
  check('login wrong password -> 401', r.status === 401, r.body);
  r = await request(app).post('/api/auth/login').send({ email: 'jim@test.com', password: 'longenough' });
  check('login ok -> 200', r.status === 200, r.body);

  // state round-trip
  const state = {
    apps: [
      { id: 'a1', company: 'Acme', role: 'PM', link: 'https://x.com', dateApplied: '2026-06-01',
        stage: 2, outcome: 'active',
        recruiter: { name: 'Sara', profile: 'https://li.com/sara', email: 's@x.com', phone: '555', lastContacted: '2026-06-08' },
        notes: 'hello', updated: '2026-06-09' },
      { id: 'a2', company: 'Beta', role: 'Dir', link: '', dateApplied: '2026-06-02',
        stage: 99, outcome: 'bogus', recruiter: null, notes: '', updated: '2026-06-05' }
    ],
    posts: [{ id: 'p1', date: '2026-06-09', platform: 'LinkedIn', title: 'Post', impressions: 100, reactions: -5, comments: 2 }],
    platforms: ['LinkedIn', 'X']
  };
  r = await request(app).put('/api/state').set('Cookie', cookie).send(state);
  check('PUT /api/state -> 200', r.status === 200, r.body);
  r = await request(app).get('/api/state').set('Cookie', cookie);
  check('GET /api/state -> 200', r.status === 200, r.body);
  const got = r.body;
  const a1 = got.apps.find(a => a.id === 'a1'), a2 = got.apps.find(a => a.id === 'a2');
  check('app round-trip with recruiter jsonb', !!a1 && a1.recruiter && a1.recruiter.name === 'Sara' && a1.stage === 2, a1);
  check('sanitizer clamps stage and outcome', a2.stage === 4 && a2.outcome === 'active', a2);
  check('post round-trip + negative clamp', got.posts[0].impressions === 100 && got.posts[0].reactions === 0, got.posts);
  check('platforms saved', JSON.stringify(got.platforms) === JSON.stringify(['LinkedIn', 'X']), got.platforms);

  // bad payload
  r = await request(app).put('/api/state').set('Cookie', cookie).send({ apps: 'nope' });
  check('PUT bad payload -> 400', r.status === 400, r.body);

  // logout
  r = await request(app).post('/api/auth/logout').set('Cookie', cookie);
  check('logout -> 200', r.status === 200, r.body);

  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
