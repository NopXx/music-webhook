import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-authcontroller';

import authController from '../controllers/authController.js';
import authRouter from '../routes/auth.js';
import { TRUST_PROXY } from '../config/proxy.js';
import authService from '../services/authService.js';
import User from '../models/User.js';

const makeRes = () => {
  const res = {};
  res.status = mock(() => res);
  res.json = mock(() => res);
  res.cookie = mock(() => res);
  return res;
};

const body = (res) => res.json.mock.calls[0][0];
const statusOf = (res) => res.status.mock.calls[0][0];

describe('authController.register', () => {
  const original = process.env.ALLOW_REGISTRATION;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  let create;
  let findByEmail;
  let verify;

  beforeEach(() => {
    delete process.env.ALLOW_REGISTRATION;
    process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
    findByEmail = spyOn(User, 'findByEmail').mockResolvedValue(null);
    create = spyOn(User, 'create').mockImplementation(async (doc) => ({ _id: 'new-id', ...doc }));
    verify = spyOn(authService, 'verifyTurnstile').mockResolvedValue(true);
  });

  afterEach(() => {
    mock.restore();
    if (original === undefined) delete process.env.ALLOW_REGISTRATION;
    else process.env.ALLOW_REGISTRATION = original;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
  });

  it('rejects anonymous signup by default (403) and creates nothing', async () => {
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough' } }, res);
    expect(statusOf(res)).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('rejects a logged-in viewer when registration is closed', async () => {
    const res = makeRes();
    await authController.register({
      body: { email: 'a@b.co', password: 'longenough' },
      user: { id: 'v', role: 'viewer' },
    }, res);
    expect(statusOf(res)).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('allows anonymous viewer signup when ALLOW_REGISTRATION=true and Turnstile passes', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const res = makeRes();
    await authController.register({
      body: { email: 'A@B.co', password: 'longenough', turnstileToken: 'tok' },
      ip: '203.0.113.5',
    }, res);
    expect(statusOf(res)).toBe(201);
    expect(verify).toHaveBeenCalledWith('tok', '203.0.113.5');
    expect(create.mock.calls[0][0].role).toBe('viewer');
    expect(typeof body(res).token).toBe('string');
    expect(res.cookie).toHaveBeenCalled();
  });

  it('does not let an anonymous signup pick its role', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough', role: 'admin', turnstileToken: 'tok' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses anonymous signup (503) when TURNSTILE_SECRET_KEY is unset', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    delete process.env.TURNSTILE_SECRET_KEY;
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough', turnstileToken: 'tok' } }, res);
    expect(statusOf(res)).toBe(503);
    expect(body(res).message).toContain('TURNSTILE_SECRET_KEY');
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('requires a turnstileToken for anonymous signup (400)', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an invalid Turnstile token (400) before looking up the email', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    verify.mockResolvedValue(false);
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough', turnstileToken: 'bad' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(findByEmail).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 503 when Cloudflare siteverify cannot be reached', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    verify.mockRejectedValue(new Error('network down'));
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough', turnstileToken: 'tok' } }, res);
    expect(statusOf(res)).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it('lets an admin create users without Turnstile, even with no secret configured', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    delete process.env.TURNSTILE_SECRET_KEY;
    const res = makeRes();
    await authController.register({
      body: { email: 'friend@b.co', password: 'longenough' },
      user: { id: 'adm', role: 'admin' },
    }, res);
    expect(statusOf(res)).toBe(201);
    expect(verify).not.toHaveBeenCalled();
  });

  it('lets an admin create a user while registration is closed, without a token or cookie', async () => {
    const res = makeRes();
    await authController.register({
      body: { email: 'friend@b.co', password: 'longenough' },
      user: { id: 'adm', role: 'admin' },
    }, res);
    expect(statusOf(res)).toBe(201);
    expect(create.mock.calls[0][0].role).toBe('viewer');
    expect(body(res).token).toBeUndefined();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('lets an admin choose the role, but only admin|viewer', async () => {
    const ok = makeRes();
    await authController.register({
      body: { email: 'second@b.co', password: 'longenough', role: 'admin' },
      user: { id: 'adm', role: 'admin' },
    }, ok);
    expect(statusOf(ok)).toBe(201);
    expect(create.mock.calls[0][0].role).toBe('admin');

    const bad = makeRes();
    await authController.register({
      body: { email: 'third@b.co', password: 'longenough', role: 'root' },
      user: { id: 'adm', role: 'admin' },
    }, bad);
    expect(statusOf(bad)).toBe(400);
  });
});

describe('auth routes (HTTP)', () => {
  let server;
  let base;

  beforeEach(() => {
    delete process.env.ALLOW_REGISTRATION;
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    spyOn(User, 'findByEmail').mockResolvedValue(null);
    spyOn(User, 'create').mockImplementation(async (doc) => ({ _id: 'new-id', ...doc }));
    const app = express();
    app.set('trust proxy', TRUST_PROXY); // same as index.js, so X-Forwarded-For picks the client
    app.use(express.json());
    app.use(cookieParser());
    app.use(authRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => {
    server.close();
    mock.restore();
    delete process.env.AUTH_RATE_LIMIT_MAX;
  });

  const post = (path, payload, headers = {}) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });

  it('closes /api/auth/register to anonymous callers', async () => {
    const res = await post('/api/auth/register', { email: 'x@y.co', password: 'longenough' });
    expect(res.status).toBe(403);
  });

  it('lets an admin bearer token register a user', async () => {
    const token = authService.signToken({ _id: 'adm', email: 'admin@x.co', role: 'admin' });
    const res = await post('/api/auth/register', { email: 'x@y.co', password: 'longenough' }, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(201);
  });

  it('rate-limits repeated failed logins with 429', async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await post('/api/auth/login', { email: 'nobody@y.co', password: 'wrong-password' }, {
        // Distinct client so this test's counter doesn't share state with others.
        'X-Forwarded-For': '203.0.113.7',
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3]).toBe(429);
  });

  it('keys the limiter on the first untrusted hop, ignoring a spoofed X-Forwarded-For prefix', async () => {
    // A public client can prepend anything; the hop appended by a trusted proxy
    // (here 203.0.113.9) is what counts, so all four share one bucket.
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await post('/api/auth/login', { email: 'nobody@y.co', password: 'wrong-password' }, {
        'X-Forwarded-For': `198.51.100.${i}, 203.0.113.9`,
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('gives different forwarded clients separate buckets', async () => {
    for (let i = 0; i < 3; i++) {
      await post('/api/auth/login', { email: 'nobody@y.co', password: 'wrong-password' }, {
        'X-Forwarded-For': '203.0.113.21',
      });
    }
    const other = await post('/api/auth/login', { email: 'nobody@y.co', password: 'wrong-password' }, {
      'X-Forwarded-For': '203.0.113.22',
    });
    expect(other.status).toBe(401);
  });

  it('rejects anonymous signup without a turnstileToken over HTTP', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
    try {
      const res = await post('/api/auth/register', { email: 'x@y.co', password: 'longenough' }, {
        'X-Forwarded-For': '203.0.113.31',
      });
      expect(res.status).toBe(400);
    } finally {
      delete process.env.ALLOW_REGISTRATION;
      delete process.env.TURNSTILE_SECRET_KEY;
    }
  });
});

describe('trust proxy setting', () => {
  const trusts = (() => {
    const app = express();
    app.set('trust proxy', TRUST_PROXY);
    return app.get('trust proxy fn');
  })();

  it('trusts loopback and the private Docker ranges', () => {
    for (const addr of ['127.0.0.1', '::1', '172.18.0.1', '10.0.0.5', '192.168.1.2', '::ffff:172.18.0.1']) {
      expect(trusts(addr, 0)).toBe(true);
    }
  });

  it('does not trust public addresses', () => {
    for (const addr of ['203.0.113.7', '1.1.1.1', '2606:4700::1111']) {
      expect(trusts(addr, 0)).toBe(false);
    }
  });
});
