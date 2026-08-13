/**
 * The server's security posture: proxy trust, CORS, response headers, and what
 * an error is allowed to say.
 *
 * Each block pins a control that is invisible when it works, which is exactly
 * the kind that gets removed by accident.
 */

import express, { Request, Response } from 'express';
import request from 'supertest';
import app from '../server';
import { allowedOrigins, corsOptions, resolveTrustProxy, trustProxyWarnings } from '../config/security';

const ORIGINAL_CORS = process.env.CORS_ORIGINS;

afterEach(() => {
  if (ORIGINAL_CORS === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = ORIGINAL_CORS;
});

describe('TRUST_PROXY', () => {
  it('defaults to one hop — the bundled nginx, unchanged', () => {
    expect(resolveTrustProxy(undefined)).toBe(1);
    expect(resolveTrustProxy('')).toBe(1);
  });

  it('parses hop counts, booleans and named/CIDR settings', () => {
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy('0')).toBe(0);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('loopback')).toBe('loopback');
    expect(resolveTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
  });

  it('warns about `true`, which lets a client choose its own limiter bucket', () => {
    expect(trustProxyWarnings(true)).toHaveLength(1);
    expect(trustProxyWarnings(1)).toEqual([]);
    expect(trustProxyWarnings(2)).toEqual([]);
  });

  /**
   * The setting decides which entry of X-Forwarded-For becomes `req.ip`, and
   * `req.ip` is the login limiter's bucket. These cases pin the resolved
   * address for the two chains this project actually deploys behind, using a
   * throwaway app so nothing has to expose a client's address on a real route.
   */
  describe('resolves the client address for a real header chain', () => {
    const CLIENT = '203.0.113.7';
    const FLY_PROXY = '66.241.124.9'; // the address a Fly-routed request arrives from
    const FORGED = '198.51.100.1';

    function whoami(trustProxy: string | undefined) {
      const probe = express();
      probe.set('trust proxy', resolveTrustProxy(trustProxy));
      probe.get('/whoami', (req: Request, res: Response) => res.json({ ip: req.ip }));
      return probe;
    }

    it('bundled compose (browser -> nginx -> backend) with 1', async () => {
      const res = await request(whoami('1'))
        .get('/whoami')
        .set('X-Forwarded-For', CLIENT)
        .expect(200);
      expect(res.body.ip).toBe(CLIENT);
    });

    it('ignores entries a client forged to the left of the chain', async () => {
      const res = await request(whoami('1'))
        .get('/whoami')
        .set('X-Forwarded-For', `${FORGED}, ${CLIENT}`)
        .expect(200);
      expect(res.body.ip).toBe(CLIENT);
    });

    // docs/hosted-security.md §2.4: Fly's proxy forwards an XFF that already
    // has entries in it, and the in-container nginx appends another hop. This
    // is the failure the doc describes — every visitor lands in one bucket.
    it('a Fly-shaped chain with 1 resolves to the platform, not the visitor', async () => {
      const res = await request(whoami('1'))
        .get('/whoami')
        .set('X-Forwarded-For', `${CLIENT}, ${FLY_PROXY}`)
        .expect(200);
      expect(res.body.ip).toBe(FLY_PROXY);
      expect(res.body.ip).not.toBe(CLIENT);
    });

    it('and with 2 resolves to the visitor', async () => {
      const res = await request(whoami('2'))
        .get('/whoami')
        .set('X-Forwarded-For', `${CLIENT}, ${FLY_PROXY}`)
        .expect(200);
      expect(res.body.ip).toBe(CLIENT);
    });

    it('with 0 it is the socket address and the header is ignored entirely', async () => {
      const res = await request(whoami('0'))
        .get('/whoami')
        .set('X-Forwarded-For', `${CLIENT}, ${FLY_PROXY}`)
        .expect(200);
      expect(res.body.ip).toMatch(/127\.0\.0\.1$/);
    });
  });
});

describe('CORS', () => {
  it('allows nothing by default — both supported setups are same-origin', async () => {
    delete process.env.CORS_ORIGINS;
    expect(allowedOrigins()).toEqual([]);

    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not answer a cross-origin preflight for the login route', async () => {
    delete process.env.CORS_ORIGINS;
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows exactly the configured origins', async () => {
    process.env.CORS_ORIGINS = 'https://app.example.com, https://other.example.com';
    expect(allowedOrigins()).toEqual(['https://app.example.com', 'https://other.example.com']);

    const allowed = await request(app)
      .get('/api/health')
      .set('Origin', 'https://app.example.com')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const denied = await request(app)
      .get('/api/health')
      .set('Origin', 'https://app.example.com.evil.net')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never allows credentials', () => {
    expect(corsOptions().credentials).toBe(false);
  });
});

describe('Response headers', () => {
  it('carries a CSP that lets an API response do nothing at all', async () => {
    const res = await request(app).get('/api/health').expect(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('carries the headers OWASP publishes', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('denies every feature in Permissions-Policy, the header helmet cannot set', async () => {
    // docs/hosted-security.md §3.1 says this header ships on both halves; the
    // API half is hand-set in server.ts, so a helmet upgrade cannot restore it
    // if this line is lost. camera=() is safe: the receipt-scan flow is a file
    // input whose native picker returns a file, never a getUserMedia stream.
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['permissions-policy']).toBe(
      'camera=(), geolocation=(), microphone=(), interest-cohort=()'
    );
  });

  it('tells caches not to keep the ledger', async () => {
    const res = await request(app).get('/api/expenses').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('The error handler', () => {
  it('answers with a status and nothing else', async () => {
    // Malformed JSON: body-parser throws before any route runs, which is the
    // shortest path to the global handler. The thrown message quotes the body.
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password": "s3cret-in-the-error"')
      .expect(500);

    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(JSON.stringify(res.body)).not.toContain('s3cret-in-the-error');
    expect(res.text).not.toMatch(/JSON|token|position/i);
  });
});
