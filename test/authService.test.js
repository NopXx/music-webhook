import { describe, it, expect, beforeAll } from 'bun:test';

// Ensure a deterministic secret before importing the service
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-authservice';

import authService from '../services/authService.js';

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
