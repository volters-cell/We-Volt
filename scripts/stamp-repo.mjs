#!/usr/bin/env node
/* Point the pages' "source code", "issues" and "NOTICE" links at the copy of
   the repository the site is being built from.

   The pages are written with the GitHub address, where the records are
   collected. When GitLab builds the site — the copy served at we-volt.eu —
   those links should open the GitLab project instead, so a reader who follows
   them stays where the site is. GitLab hands every build its project's
   address, and this rewrites the links to it, with GitLab's own paths:
   /issues becomes /-/issues, /blob/HEAD/NOTICE becomes /-/blob/HEAD/NOTICE.

   Only a public project is linked to. A private one would answer every
   reader's click with a sign-in page, which is worse than the public copy on
   GitHub, so then the links are left as they are and the log says why.

     node scripts/stamp-repo.mjs                 on GitLab: uses CI_PROJECT_URL
     SITE_REPOSITORY=https://… node scripts/…    anywhere: link there instead

   Run at publish time on the checkout, like stamp-assets; never committed.
   Without either variable it does nothing, so it is safe to run anywhere.
*/
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB = 'https://github.com/volters-cell/We-Volt';

/* GitLab puts a /-/ before the parts of a project that are not the project's
   own name: /-/issues, /-/blob/HEAD/NOTICE, /-/tree/HEAD/data. */
export function toGitLab(href, project) {
  const rest = href.slice(GITHUB.length).replace(/^\.git(?=$|[/?#])/, '');
  const moved = rest.replace(/^\/(issues|blob|tree|commits|commit|raw|blame)(?=$|[/?#])/, '/-/$1');
  return project.replace(/\/+$/, '') + moved;
}

export function restamp(html, project, gitlab) {
  const pattern = new RegExp(GITHUB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])[^"\'\\s<)]*', 'g');
  let count = 0;
  const out = html.replace(pattern, function (href) {
    count++;
    return gitlab ? toGitLab(href, project) : project.replace(/\/+$/, '') + href.slice(GITHUB.length);
  });
  return { html: out, count };
}

async function main() {
  const override = process.env.SITE_REPOSITORY;
  const onGitLab = Boolean(process.env.CI_PROJECT_URL);
  const project = override || process.env.CI_PROJECT_URL;
  if (!project) {
    console.log('stamp-repo: not on GitLab and no SITE_REPOSITORY; links left as written.');
    return;
  }
  if (!override && process.env.CI_PROJECT_VISIBILITY && process.env.CI_PROJECT_VISIBILITY !== 'public') {
    console.warn(`stamp-repo: ${project} is ${process.env.CI_PROJECT_VISIBILITY}, so readers could not open it. ` +
      'The links keep pointing at the public repository on GitHub. Make the GitLab project public ' +
      '(Settings → General → Visibility) and the next build links to it.');
    return;
  }
  // An override is linked as given, with GitLab paths only if it is GitLab.
  const gitlab = override ? /gitlab/i.test(new URL(override).hostname) : onGitLab;

  const files = (await readdir(ROOT)).filter((name) => name.endsWith('.html'))
    .map((name) => path.join(ROOT, name));
  const bundle = path.join(ROOT, 'dist', 'eu-tracker.html');
  if (existsSync(bundle)) files.push(bundle);

  let total = 0;
  for (const file of files) {
    const before = await readFile(file, 'utf8');
    const { html, count } = restamp(before, project, gitlab);
    if (count) {
      await writeFile(file, html, 'utf8');
      total += count;
      console.log(`  ${path.relative(ROOT, file)}: ${count} link${count === 1 ? '' : 's'}`);
    }
  }
  console.log(`stamp-repo: ${total} link${total === 1 ? '' : 's'} now point at ${project}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
