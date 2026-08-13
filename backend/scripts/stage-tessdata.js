#!/usr/bin/env node
/**
 * Stage Tesseract language data into `backend/tessdata/`.
 *
 * Build tooling, not application code — it copies files, it never imports the
 * app. `services/receipt/tesseract.ts` reads the directory this produces, and
 * without it the first receipt scan has to download ~5.6 MB from a CDN, which
 * is precisely the moment a self-hosted box is least likely to manage it.
 *
 * The data is already on disk after `npm install`: `@tesseract.js-data/<lang>`
 * are declared as devDependencies, so the bytes arrive through the same
 * registry and the same package-lock integrity check as everything else —
 * rather than through a second network host with a hand-maintained checksum.
 * The Dockerfile stages them out before `npm prune --production` runs.
 *
 * Mind what a single-stage image does and does not reclaim. `npm prune` runs in
 * a later layer than `npm ci`, so it masks the ~25 MB of packages rather than
 * removing them. These 5.6 MB cost about 11 MB, because the `chown -R` that
 * follows rewrites every file it touches into a layer of its own. Cleaning
 * npm's cache inside the `npm ci` layer — the only layer that can reclaim it —
 * more than pays for both: measured, the image went from 463 MB before this
 * change to 451 MB with the language data inside it.
 *
 * Usage:  npm run tessdata            # honours RECEIPT_OCR_LANGS (default pol+eng)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The LSTM-only build of the 4.0.0 data. It has to match the engine the
// extractor asks for (OEM.LSTM_ONLY): the sibling `4.0.0` directory carries the
// legacy models too, which is four times the bytes for accuracy we never use.
const VARIANT = '4.0.0_best_int';

const root = path.join(__dirname, '..');
const dest = path.join(root, 'tessdata');

const langs = (process.env.RECEIPT_OCR_LANGS || 'pol+eng')
  .split('+')
  .map((lang) => lang.trim())
  .filter(Boolean);

fs.mkdirSync(dest, { recursive: true });

const missing = [];
let staged = 0;

for (const lang of langs) {
  const file = `${lang}.traineddata.gz`;
  const src = path.join(root, 'node_modules', '@tesseract.js-data', lang, VARIANT, file);

  if (!fs.existsSync(src)) {
    missing.push(lang);
    continue;
  }

  fs.copyFileSync(src, path.join(dest, file));
  staged += fs.statSync(src).size;
  console.log(`tessdata: ${file}`);
}

console.log(`tessdata: ${(staged / 1024 / 1024).toFixed(1)} MB in ${dest}`);

if (missing.length > 0) {
  // Not fatal: the extractor only prefers the bundle when it covers every
  // requested language, and otherwise falls back to the CDN exactly as before.
  // Say so plainly rather than failing a build over an optional optimisation.
  console.error(
    `tessdata: no local copy of ${missing.join(', ')} — add ` +
    missing.map((lang) => `@tesseract.js-data/${lang}`).join(', ') +
    ` as a devDependency, or that language will be downloaded at first scan.`
  );
}
