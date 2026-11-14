# Hosting: we-volt.eu on GitLab Pages

The site's address is **https://we-volt.eu/**, and GitLab Pages serves it.

```
GitHub (this repository)                    GitLab (the project "We-Volt")
  scheduled imports from the Parliament
  commit the records
  .github/workflows/pages.yml
     ├─ gitlab job ── copies the branch ──▶  .gitlab-ci.yml builds the site
     │                                         └─ GitLab Pages ─▶ https://we-volt.eu/
     └─ old github.io address: the full site until we-volt.eu answers,
        then a page that forwards every old link to the same page there
```

The records are collected on GitHub because that is where the scheduled imports
run, for free. Every publish copies the repository to GitLab, and GitLab builds
the same site from it: the vote pages, their preview pictures, the sitemap. On
that build the "source code", "issues" and "NOTICE" links are pointed at the
GitLab project (`scripts/stamp-repo.mjs`), as long as the project is public.

Make changes on GitHub. The GitLab copy is overwritten with GitHub's branch on
every publish, so a commit made only on GitLab would be lost.

## Setting it up, once

### 1. The GitLab project

Create the project **empty**: untick *Initialize repository with a README*. If
it already has a README commit, allow force push on `main` once (Settings →
Repository → Protected branches), or the first copy is refused.

Make it **public** (Settings → General → Visibility) so the site's source links
can point to it. While it is private they keep pointing at GitHub.

GitLab.com runs the build on its shared runners. A new account may first have to
verify itself (GitLab asks for a phone number or card) before they run any job.
Each build takes a few minutes of the free tier's monthly CI minutes.

### 2. Let GitHub copy to it

On GitHub, in this repository's **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
|---|---|---|
| Variable | `GITLAB_PROJECT` | the project's path, as in its address: for `https://gitlab.com/name/We-Volt`, `name/We-Volt` |
| Secret | `GITLAB_TOKEN` | a GitLab access token with the `write_repository` scope |

Create the token in GitLab under **User settings → Access tokens** (or, on a
paid plan, the project's own Settings → Access tokens). GitLab tokens expire —
about a year after they are made, at most — and GitLab e-mails before that
happens: put a new one in the secret.

If you would rather nothing expired, use a **deploy key** instead of the token:
an SSH key pair whose public half is added in the GitLab project under
Settings → Repository → Deploy keys, with *Grant write permissions* ticked.
Its private half goes in a secret named `GITLAB_DEPLOY_KEY`.

Optional variables: `GITLAB_HOST` (default `gitlab.com`, for a self-hosted
GitLab) and `GITLAB_BRANCH` (default `main`).

Then run **Actions → Publish → Run workflow**. The `gitlab` job copies the
repository, and the GitLab project's pipeline (Build → Pipelines) builds and
publishes the site.

### 3. The domain

In the GitLab project: **Deploy → Pages → New domain**, `we-volt.eu`, with
automatic certificates (Let's Encrypt) left on. GitLab then shows two DNS
records to add wherever we-volt.eu is registered:

- an **A** record for `we-volt.eu` pointing to `35.185.44.232`, GitLab Pages' address;
- a **TXT** record named `_gitlab-pages-verification-code.we-volt.eu` with the code GitLab shows.

For `www.we-volt.eu`, add it as a second domain in the same place, with a
**CNAME** to `<your-namespace>.gitlab.io` and its own TXT record.

Once GitLab says the domain is verified and the certificate is issued, the site is
at https://we-volt.eu/.

## The old address

Every publish on GitHub first asks whether https://we-volt.eu/ answers with the
site — its front page and its vote records — and whether those records are up to
date, no more than a week behind the repository's (`where` job in `pages.yml`).
Until both are true, the old github.io address keeps serving the full site, so
nothing goes dark during the move, and a GitLab copy that stops updating is not
where anyone gets sent: the run shows a warning instead. From the first
publish after it does, the old address serves only a page that forwards each
link to the same place on we-volt.eu — `/We-Volt/v/196157/` to
`https://we-volt.eu/v/196157/` — so votes shared before the move still open.
Nothing needs switching by hand.

The pages name `https://we-volt.eu/` as their address (`canonical`, `og:url`, the
preview pictures, the sitemap), so search engines and link previews already
treat it as the site.
