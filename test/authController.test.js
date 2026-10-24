import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import express from 'express';
import cookieParser from 'cookie-parser';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-authcontroller';

import authController from '../controllers/authController.js';
import authRouter from '../routes/auth.js';
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
  let create;

  beforeEach(() => {
    delete process.env.ALLOW_REGISTRATION;
    spyOn(User, 'findByEmail').mockResolvedValue(null);
    create = spyOn(User, 'create').mockImplementation(async (doc) => ({ _id: 'new-id', ...doc }));
  });

  afterEach(() => {
    mock.restore();
    if (original === undefined) delete process.env.ALLOW_REGISTRATION;
    else process.env.ALLOW_REGISTRATION = original;
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

  it('allows anonymous viewer signup when ALLOW_REGISTRATION=true', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const res = makeRes();
    await authController.register({ body: { email: 'A@B.co', password: 'longenough' } }, res);
    expect(statusOf(res)).toBe(201);
    expect(create.mock.calls[0][0].role).toBe('viewer');
    expect(typeof body(res).token).toBe('string');
    expect(res.cookie).toHaveBeenCalled();
  });

  it('does not let an anonymous signup pick its role', async () => {
    process.env.ALLOW_REGISTRATION = 'true';
    const res = makeRes();
    await authController.register({ body: { email: 'a@b.co', password: 'longenough', role: 'admin' } }, res);
    expect(statusOf(res)).toBe(400);
    expect(create).not.toHaveBeenCalled();
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
    app.set('trust proxy', 1); // same as index.js, so X-Forwarded-For picks the client
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
});
