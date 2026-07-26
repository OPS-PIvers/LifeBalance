# Repo Cleanup Runbook

How to reclaim a repo after a multi-agent project leaves dozens of branches and
worktrees behind. Written after the 2026-07-25 sweep, which cleared **90 local
branches → 1, 43 remote → 1, 33 worktrees → 1**.

Work top to bottom. Steps 0–2 are the safety net; skipping them is how work
disappears.

---

## 0. Archive first — this is what makes the rest safe

Everything here is destructive and, for reasons in step 2, has to be *forced*.
One bundle removes the risk. It took 6.5 MB and a few seconds for 134 refs.

```bash
ARC=../LifeBalance-branches-$(date +%F)
git for-each-ref --format='%(objectname) %(refname)' refs/heads refs/remotes/origin refs/tags > "$ARC.manifest.txt"
git bundle create "$ARC.bundle" --all --not origin/main
git bundle verify "$ARC.bundle"
```

Write it **outside** the repo so it doesn't become the next sweep's debris.

`--not origin/main` keeps the bundle small by storing only commits main doesn't
have — which makes `origin/main` a **prerequisite**: the bundle is useless in a
repo that lacks it. That's fine for this purpose and worth knowing before you
rely on it as a general backup.

Recover any branch later with:

```bash
git fetch ../LifeBalance-branches-2026-07-25.bundle refs/heads/some-branch:recovered
```

## 1. Check open PRs before touching remote branches

Deleting a PR's head branch **closes the PR**. On a stacked PR it also orphans
the child and deadlocks retargeting.

```bash
gh pr list --state open --limit 100 --json number,title,headRefName
```

Empty result → the remote is free to clear. Otherwise leave those branches alone.

## 2. Expect `git branch -d` to refuse everything

This repo squash-merges. A squash rewrites the commits, so **no merged branch is
an ancestor of `main`** and git cannot verify it's merged:

```bash
git branch -vv --merged main | grep -c ': gone]'   # → 0, even when all are merged
```

`-d` will refuse all of them and `--merged` will not help you find them. `-D`
(force) is the only option, which is exactly why step 0 is not optional.

Don't try to sort "merged" from "unmerged" by diffing:
`git diff main...branch` shows everything the branch added since the merge-base
regardless of whether it later landed, so it **over-reports** — a squash-merged
branch looks unmerged. To check one specific branch, search `main` for its commit
subject instead:

```bash
git log origin/main --oneline --grep="the commit subject"
```

The reliable danger signal is a branch with **no upstream at all** — never pushed,
so not on GitHub either:

```bash
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  [ -z "$(git for-each-ref --format='%(upstream)' "refs/heads/$b")" ] \
    && [ "$(git rev-list --count origin/main.."$b")" != "0" ] \
    && echo "$b"
done
```

## 3. Free the worktrees (the part that surprises people)

`git worktree remove` fails on any worktree with a populated `node_modules`:

```
error: failed to delete '...': Directory not empty
```

and on Windows the deletion is slow enough that merely *counting* 39 copies of
`node_modules` exceeded a 5-minute timeout.

**The fix: git's registration and the files on disk are independent.** What pins
a branch is the metadata under `.git/worktrees/`, not the directory. Clear the
metadata and the branches are free immediately; delete the files whenever.

```bash
rm -rf .git/worktrees        # deregisters every linked worktree at once
git worktree prune
git worktree list            # → only the primary worktree
```

Then remove the files in the background — minutes, not seconds:

```bash
cmd //c "rmdir /s /q .claude\worktrees"    # Windows; rm -rf elsewhere
```

Only do this when every linked worktree is disposable. It does **not** touch the
primary worktree, but it does discard any uncommitted changes sitting in the
linked ones — check for those first if agents may still be running.

## 4. Delete the branches

Remote, in one round trip (`--delete` takes many refs):

```bash
git push origin --delete $(git for-each-ref --format='%(refname:strip=3)' \
  refs/remotes/origin/ | grep -vE '^(main|HEAD)$' | tr '\n' ' ')
git fetch --prune
```

Local:

```bash
git for-each-ref --format='%(refname:short)' refs/heads/ | grep -vE '^main$' \
  | xargs git branch -D
```

## 5. Verify

```bash
git branch && git branch -r && git worktree list && git status --short --branch
```

Expect `main`, `origin/main` (+ `origin/HEAD`), one worktree, and a clean tree.

---

## Root-level debris

Agent runs leave PR diffs and verification screenshots in the repo root
(`pr1078.diff`, `banner-mobile-light.png`, …). `.gitignore` now covers root-level
`*.diff|*.patch|*.png|*.jpg` — scoped to `/` so assets under `public/` and `docs/`
are untouched. If a root-level image is ever genuinely deliverable, `git add -f`.

Scratch **source** copies (`todoMutations_branch.ts`) are deliberately *not*
ignored: those are rare enough that they should stay visible in `git status`
rather than be silently hidden.

## Keep

`.claude/launch.json` (dev-server config for the Browser pane), `.claude/skills/`,
and `.impeccable/` are tooling config, not debris. Leave them.
