/* Give every asset a version, so a new deploy is never served as the old one.
 *
 * The site is static files on GitHub Pages, which sends them with a cache
 * lifetime and no way to set one of our own. Nothing in a plain
 * <script src="assets/js/app.js"> tells a browser that the file behind it has
 * changed, so a phone that has been to the site once keeps running the
 * JavaScript it already has — for ten minutes on a good day, and until the
 * user clears their site data on a bad one. A change can ship, pass its
 * checks, deploy green, and still not be there when someone looks.
 *
 * So at publish time every reference the pages make to their own assets is
 * stamped with the commit being published: app.js?v=36d694b6. The address
 * changes whenever the build does, which is the whole of the mechanism — a
 * browser cannot serve a cached copy of an address it has never seen.
 *
 * The stamp is applied to the checkout the workflow uploads, never committed:
 * a version in the repository would change on every commit and be wrong by
 * definition the moment it was written.
 *
 *   node scripts/stamp-assets.mjs            # stamp with the current commit
 *   node scripts/stamp-assets.mjs --check    # say what would be stamped
 *
 * Run it after the single-file bundle, which reads these same tags.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

function version() {
  // In Actions the commit is handed to us; on a laptop, ask git; failing both,
  // the clock, which at least changes.
  const sha = process.env.GITHUB_SHA;
  if (sha) return sha.slice(0, 8);
  try {
    return execSync('git rev-parse --short=8 HEAD', { cwd: ROOT }).toString().trim();
  } catch (error) {
    return Date.now().toString(36);
  }
}

/* Only the pages' own tags, and only where there is no query already: a second
   run must not stamp a stamp. Runtime fetches — the records, the portraits,
   the groups' marks — are left alone; they are additive, and versioning them
   would mean teaching every fetch about the build. */
const REFERENCE = /(\s(?:src|href)=")(assets\/[^"?#]+)(")/g;

const stamp = version();
const files = (await readdir(ROOT)).filter((name) => name.endsWith('.html'));
let total = 0;

for (const name of files) {
  const file = path.join(ROOT, name);
  const before = await readFile(file, 'utf8');
  let count = 0;
  let after = before.replace(REFERENCE, function (whole, open, asset, close) {
    count += 1;
    return open + asset + '?v=' + stamp + close;
  });

  // A line saying which build this is, for anyone wondering whether what they
  // are looking at is what was last published.
  if (count && /<meta name="build"/.test(after) === false) {
    after = after.replace(/(\s*)<title>/,
      '$1<meta name="build" content="' + stamp + '">$1<title>');
  }

  total += count;
  console.log(name.padEnd(14), count, 'reference' + (count === 1 ? '' : 's'));
  if (!CHECK && count) await writeFile(file, after);
}

console.log((CHECK ? 'would stamp ' : 'stamped ') + total + ' references as v=' + stamp);
