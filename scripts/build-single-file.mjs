#!/usr/bin/env node
/*
 * Bundle the whole site into one HTML file: styles, scripts and every record
 * inlined, no server needed. Useful for sharing a link, for an offline demo,
 * and for handing a reviewer something that opens with a double-click.
 *
 *   node scripts/build-single-file.mjs           -> dist/eu-tracker.html
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REPO = 'https://github.com/volters-cell/We-Volt/blob/main';

const SCRIPTS = ['projection.js', 'data.js', 'map.js', 'panel.js', 'app.js'];

const read = (relative) => readFile(path.join(ROOT, relative), 'utf8');

async function collectData() {
  const bundle = {};
  const add = async (relative) => { bundle[relative] = JSON.parse(await read(relative)); };

  await add('data/reference/member-states.json');
  await add('data/eu-countries.geo.json');
  await add('data/decisions/index.json');
  for (const entry of bundle['data/decisions/index.json'].decisions) {
    await add(entry.file);
  }
  return bundle;
}

const html = await read('index.html');
const title = html.match(/<title>([^<]*)<\/title>/)[1];
let body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));

// Relative links to the repository's own docs have nowhere to point once the
// page is a single file, so send them to the repository instead.
body = body
  .replace(/href="(docs\/[^"]+)"/g, `href="${REPO}/$1"`)
  .replace(/\s*<script src="assets\/js\/[^"]+"><\/script>/g, '');

const css = await read('assets/css/style.css');
const scripts = await Promise.all(SCRIPTS.map((name) => read(`assets/js/${name}`)));
const data = await collectData();

const page = `<title>${title}</title>
<style>
${css}
</style>
${body.trim()}
<script>window.__EU_TRACKER_DATA__ = ${JSON.stringify(data)};</script>
${scripts.map((source) => `<script>\n${source}\n</script>`).join('\n')}
`;

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist/eu-tracker.html');
await writeFile(out, page, 'utf8');

console.log(`${out} — ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB, ` +
  `${Object.keys(data).length} data files inlined`);
