import { describe, it, expect, afterEach, spyOn, mock } from 'bun:test';

// Ensure a deterministic secret before importing the service
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-authservice';

import authService from '../services/authService.js';
import User from '../models/User.js';

describe('authService', () => {
  it('hashes and verifies a password', async () => {
    const hash = await authService.hashPassword('correct horse battery');
    expect(hash).not.toBe('correct horse battery');
    expect(await authService.comparePassword('correct horse battery', hash)).toBe(true);
    expect(await authService.comparePassword('wrong', hash)).toBe(false);
  });

  it('signs and verifies a JWT round-trip', () => {
    const token = authService.signToken({ _id: 'abc123', email: 'u@test.com', role: 'admin' });
    expect(typeof token).toBe('string');
    const decoded = authService.verifyToken(token);
    expect(decoded.sub).toBe('abc123');
    expect(decoded.email).toBe('u@test.com');
    expect(decoded.role).toBe('admin');
  });

  it('rejects a tampered/invalid token', () => {
    expect(() => authService.verifyToken('not.a.jwt')).toThrow();
  });

  it('generates an API key with hash + prefix', async () => {
    const { raw, hash, prefix } = await authService.generateApiKey();
    expect(raw).toHaveLength(48);
    expect(prefix).toBe(raw.slice(0, 8));
    expect(hash).not.toBe(raw);
    // hash must verify against the raw key (bcrypt)
    const bcrypt = (await import('bcryptjs')).default;
    expect(await bcrypt.compare(raw, hash)).toBe(true);
  });

  it('produces unique keys', async () => {
    const a = await authService.generateApiKey();
    const b = await authService.generateApiKey();
    expect(a.raw).not.toBe(b.raw);
  });
});

describe('authService.isRegistrationOpen', () => {
  const original = process.env.ALLOW_REGISTRATION;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_REGISTRATION;
    else process.env.ALLOW_REGISTRATION = original;
  });

  it('is closed when ALLOW_REGISTRATION is unset', () => {
    delete process.env.ALLOW_REGISTRATION;
    expect(authService.isRegistrationOpen()).toBe(false);
  });

  it('is closed for anything other than "true"', () => {
    for (const v of ['false', '0', '1', 'yes', '']) {
      process.env.ALLOW_REGISTRATION = v;
      expect(authService.isRegistrationOpen()).toBe(false);
    }
  });

  it('opens only for "true" (case-insensitive)', () => {
    process.env.ALLOW_REGISTRATION = ' TRUE ';
    expect(authService.isRegistrationOpen()).toBe(true);
  });
});

describe('authService.seedAdmin', () => {
  const env = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, reg: process.env.ALLOW_REGISTRATION };
  afterEach(() => {
    mock.restore();
    for (const [k, v] of [['ADMIN_EMAIL', env.email], ['ADMIN_PASSWORD', env.password], ['ALLOW_REGISTRATION', env.reg]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns null when ADMIN_EMAIL/ADMIN_PASSWORD are not set', async () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    expect(await authService.seedAdmin()).toBeNull();
  });

  it('creates the admin even with registration closed', async () => {
    process.env.ADMIN_EMAIL = ' Admin@Example.com ';
    process.env.ADMIN_PASSWORD = 'seed-password-123';
    delete process.env.ALLOW_REGISTRATION;
    spyOn(User, 'findByEmail').mockResolvedValue(null);
    const create = spyOn(User, 'create').mockImplementation(async (doc) => ({ _id: 'x', ...doc }));

    const admin = await authService.seedAdmin();
    expect(create).toHaveBeenCalledTimes(1);
    expect(admin.email).toBe('admin@example.com');
    expect(admin.role).toBe('admin');
    expect(await authService.comparePassword('seed-password-123', admin.passwordHash)).toBe(true);
  });

  it('is idempotent — returns the existing admin without creating', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'seed-password-123';
    const existing = { _id: 'x', email: 'admin@example.com', role: 'admin' };
    spyOn(User, 'findByEmail').mockResolvedValue(existing);
    const create = spyOn(User, 'create');

    expect(await authService.seedAdmin()).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });
});
