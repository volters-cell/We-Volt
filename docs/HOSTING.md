# Hosting: we-volt.eu on GitLab

The site's address is **https://we-volt.eu/**. GitLab serves it, from the project
**volt/we-volt** on **gitlab.cybermindnet.eu**:

    git@gitlab.cybermindnet.eu:volt/we-volt.git

```
GitHub (this repository)                    gitlab.cybermindnet.eu (volt/we-volt)
  scheduled imports from the Parliament
  commit the records
  .github/workflows/pages.yml
     ├─ gitlab job ── copies the branch ──▶  .gitlab-ci.yml builds the site
     │                                         └─ GitLab Pages ─▶ https://we-volt.eu/
     └─ old github.io address: the full site until we-volt.eu answers,
        then a page that forwards every old link to the same page there
```

The records are collected on GitHub because that is where the scheduled imports
run. Every publish copies the repository to the GitLab project, and GitLab builds
the same site from it: the vote pages, their preview pictures, the sitemap. On
that build the "source code", "issues" and "NOTICE" links are pointed at the
GitLab project (`scripts/stamp-repo.mjs`), as long as the project is public.

Make changes on GitHub. The GitLab copy is overwritten with GitHub's branch on
every publish, so a commit made only on GitLab would be lost.

## Setting it up, once

### 1. Let GitHub write to the project

The project is already filled in (`pages.yml`). What GitHub needs is permission
to push to it — one secret, in this repository's **Settings → Secrets and
variables → Actions → New repository secret**. Either:

- **`GITLAB_DEPLOY_KEY`** — recommended, because it never expires. Make an SSH
  key pair on any computer:

      ssh-keygen -t ed25519 -N "" -C we-volt-copy -f we-volt-copy

  In GitLab, open the project, **Settings → Repository → Deploy keys → Add new
  key**, paste the contents of `we-volt-copy.pub`, and tick **Grant write
  permissions to this key**. On GitHub, paste the contents of `we-volt-copy`
  (the file without `.pub`) as the secret. Then delete both files.

- **`GITLAB_TOKEN`** — simpler, but it expires. In the project, **Settings →
  Access tokens → Add new token**, role *Maintainer*, scope `write_repository`.
  GitLab caps how long a token lives (a year, unless the server's administrator
  set otherwise) and e-mails before it runs out: put a new one in the secret.

Then run **Actions → Publish → Run workflow**. The `gitlab` job copies the
repository, and the project's pipeline (Build → Pipelines) builds and publishes
the site.

### 2. Things on the GitLab side

- If the project has commits of its own — a README GitLab created, an earlier
  copy — the first push is refused. Allow force push on `main` once (Settings →
  Repository → Protected branches) or empty the branch.
- Make the project **public** (Settings → General → Visibility) so the site's
  source links can point to it. While it is private they keep pointing at GitHub.
- The build runs on the server's own runners, so the minute limits of gitlab.com
  do not apply. The `pages` job uses a container image
  (`mcr.microsoft.com/playwright`, with the browser that draws the preview
  pictures), so it needs a runner with the Docker executor that can pull it.
- GitLab Pages must be enabled on the server, with we-volt.eu added to the
  project under **Deploy → Pages → Domains**. The domain already answers, so this
  is done; if it is ever redone, the server shows the DNS records it wants.

## The old address

Every publish on GitHub first asks whether https://we-volt.eu/ answers with the
site — its front page and its vote records — and whether those records are up to
date, no more than a week behind the repository's (`where` job in `pages.yml`).
Until both are true, the old github.io address keeps serving the full site, so
nothing goes dark during the move, and a GitLab copy that stops updating is not
where anyone gets sent: the run shows a warning instead. From the first publish
where both hold, the old address serves only a page that forwards each link to
the same place on we-volt.eu — `/We-Volt/v/196157/` to
`https://we-volt.eu/v/196157/` — so votes shared before the move still open.
Nothing needs switching by hand.

The pages name `https://we-volt.eu/` as their address (`canonical`, `og:url`, the
preview pictures, the sitemap), so search engines and link previews already
treat it as the site.
