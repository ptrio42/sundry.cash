/**
 * The Content-Security-Policy nginx serves, checked against the app it has to
 * allow.
 *
 * The policy admits the two inline blocks in `index.html` by hash rather than
 * with `'unsafe-inline'`, which is the whole reason it is worth having. A hash
 * is also a tripwire: edit the anti-flash script by one character and the app
 * silently loads with no theme applied, or — the worse case — someone
 * "fixes" that by adding `'unsafe-inline'` and the policy stops protecting
 * anything. This suite recomputes both hashes from the source and fails the
 * build instead.
 *
 * Verified when it was written: Vite copies both blocks into `dist/index.html`
 * byte-for-byte (identical sha256 for source and build output), so hashing the
 * source file is hashing what ships.
 *
 * Both files are read with `?raw`, the same trick `theme.test.ts` uses on
 * App.css — the frontend has no `@types/node`, so `fs` is not available here,
 * and the node environment below is only for `crypto.subtle`.
 */

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import html from '../../index.html?raw';
import nginxHeaders from '../../security-headers.conf?raw';

const csp = (() => {
  const match = nginxHeaders.match(/add_header Content-Security-Policy "([^"]+)"/);
  if (!match) throw new Error('No Content-Security-Policy in security-headers.conf');
  return match[1];
})();

/** The text content of every inline <tag> (i.e. one with no src attribute). */
function inlineBlocks(tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  const blocks: string[] = [];
  for (const match of html.matchAll(pattern)) {
    if (!/\ssrc=/.test(match[0])) blocks.push(match[1]);
  }
  return blocks;
}

/** The CSP source expression for a block: `'sha256-<base64>'`. */
async function sha256(source: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return `'sha256-${btoa(binary)}'`;
}

describe('Content-Security-Policy', () => {
  it('allows every inline block index.html actually contains', async () => {
    const inline = [...inlineBlocks('script'), ...inlineBlocks('style')];
    // Two: the anti-flash <style> and the theme <script>. A third would need a
    // hash of its own — this assertion is what says so out loud.
    expect(
      inline,
      'index.html has gained or lost an inline block. Each one needs its own hash in the ' +
      'script-src / style-src of frontend/security-headers.conf.'
    ).toHaveLength(2);

    for (const block of inline) {
      const hash = await sha256(block);
      // The fix when this fires is mechanical, so say it here rather than
      // leaving the next person to guess — a tripwire nobody knows how to
      // satisfy gets deleted instead of satisfied.
      expect(
        csp,
        `An inline block in index.html changed and no longer matches the CSP.\n` +
        `Paste ${hash} into the matching directive in frontend/security-headers.conf ` +
        `(script-src for the theme script, style-src for the anti-flash style), replacing the ` +
        `stale hash. Do NOT add 'unsafe-inline' instead — that is the whole point of the policy.`
      ).toContain(hash);
    }
  });

  it('never falls back to allowing inline script', () => {
    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain('*');
  });

  it('keeps inline <style> ELEMENTS on hashes, and only style attributes open', () => {
    // React's `style={{…}}` and every SVG element recharts positions are style
    // attributes, which CSP cannot hash. Scoping the exception to -attr means an
    // injected <style> element is still refused.
    const styleSrc = csp.match(/style-src ([^;]+)/)?.[1] ?? '';
    expect(styleSrc).not.toContain("'unsafe-inline'");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it('lets the app reach its own API and nothing else', () => {
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('allows the sources the built app genuinely needs', () => {
    // blob: for the receipt preview and the token-authenticated image fetch;
    // data: for the one SVG data-URI in the built stylesheet.
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("worker-src 'self'"); // public/sw.js
    expect(csp).toContain("font-src 'self'"); // the two self-hosted Newsreader cuts
  });
});

describe('The other headers', () => {
  it('carries the ones OWASP publishes, each with `always`', () => {
    for (const header of [
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      const line = nginxHeaders.match(new RegExp(`add_header ${header} "[^"]*"[^;]*;`))?.[0];
      expect(line).toBeDefined();
      // Without `always`, nginx drops the header on error responses — which is
      // where a page is most likely to be doing something unexpected.
      expect(line).toContain('always;');
    }
  });

  it('sets X-Frame-Options to DENY and nosniff, per the cheat sheet', () => {
    expect(nginxHeaders).toContain('add_header X-Frame-Options "DENY" always;');
    expect(nginxHeaders).toContain('add_header X-Content-Type-Options "nosniff" always;');
  });

  it('denies the camera — the receipt scan does not need the permission', () => {
    // Settled after research (see the comment in security-headers.conf): the
    // 'camera' policy feature gates getUserMedia() only, and the scan flow is
    // an <input type="file" capture> whose native picker returns a finished
    // file. If a camera stream is ever genuinely needed (live preview, say),
    // this assertion is the reminder that the policy must change first.
    const permissions = nginxHeaders.match(/add_header Permissions-Policy "([^"]+)"/)?.[1] ?? '';
    expect(permissions).toContain('camera=()');
    expect(permissions).toContain('microphone=()');
    expect(permissions).toContain('geolocation=()');
  });
});
