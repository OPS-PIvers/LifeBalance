---
name: review_prs
description: Review all open PRs (not drafts) for merge readiness, make all necessary changes from nitpick to critical, address reviewer comments, merge methodically, verify deployment, and clean up branches
disable-model-invocation: false
argument-hint: [optional: specific PR number]
allowed-tools:
  - Bash(gh *)
  - Bash(git *)
  - Read
  - Edit
  - Write
  - Glob
  - Grep
---

# Review and Merge Pull Requests

Automate the complete PR review, fix, merge, and cleanup workflow.

## Objective

Review all open PRs (excluding drafts) for merge readiness. Make all necessary changes from nitpick to critical, then merge them methodically ensuring that at the end of the process, the code is all pushed to main and the workflow to build and deploy succeeds. This includes reading reviewer comments and addressing any unresolved issues that need to be fixed. Clean up local and remote PR branches after merging.

## Process

### Phase 1: Discovery and Triage

1. **List all open PRs** (exclude drafts):
   ```bash
   gh pr list --state open --json number,title,isDraft,author,updatedAt,reviewDecision,statusCheckRollup
   ```

2. **Filter out draft PRs** - Only work with ready-for-review PRs

3. **If $ARGUMENTS provided** - Focus only on that specific PR number

4. **Prioritize PRs** by:
   - Approved PRs with passing checks (merge first)
   - PRs with requested changes (fix next)
   - PRs awaiting review (review and provide feedback)

### Phase 2: Deep Review (For Each PR)

For each PR in priority order:

1. **Fetch PR details**:
   ```bash
   gh pr view [NUMBER] --json title,body,number,headRefName,baseRefName,mergeable,reviews,comments,commits,statusCheckRollup
   ```

2. **Check out the PR branch**:
   ```bash
   gh pr checkout [NUMBER]
   ```

3. **Review the code changes**:
   ```bash
   gh pr diff [NUMBER]
   ```
   - Read all changed files
   - Identify potential issues (bugs, style, security, performance)
   - Check against project standards in [CLAUDE.md](../../CLAUDE.md)
   - **CRITICAL**: Check for lint suppressions (see CLAUDE.md Code Quality Standards)

4. **Read all reviewer comments**:
   ```bash
   gh pr view [NUMBER] --comments
   ```
   - Identify unresolved threads
   - Note requested changes
   - Track nitpicks vs. critical issues

5. **Check CI/CD status**:
   ```bash
   gh pr checks [NUMBER]
   ```
   - Verify all checks pass
   - If failing, investigate logs and fix root causes

### Phase 3: Fix Issues

For each issue identified:

1. **Make necessary changes**:
   - Use Read, Edit, Write tools to fix code
   - Address reviewer comments one by one
   - Fix lint errors (NEVER add suppressions - see CLAUDE.md)
   - Fix type errors properly (no @ts-ignore)
   - Ensure code follows project patterns
   - Run local validation if possible

2. **Commit fixes**:
   ```bash
   git add [files]
   git commit -m "Address review feedback: [specific issue]

   - Fix: [specific change 1]
   - Fix: [specific change 2]

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
   ```

3. **Push changes**:
   ```bash
   git push origin [branch-name]
   ```

4. **Verify checks pass** after pushing:
   ```bash
   gh pr checks [NUMBER] --watch
   ```

5. **Respond to review comments** (mark as resolved):
   ```bash
   gh pr comment [NUMBER] --body "✅ Addressed: [summary of fix]"
   ```

### Phase 4: Merge Preparation

Before merging each PR:

1. **Verify ALL criteria met**:
   - ✅ All reviewer comments addressed
   - ✅ All CI/CD checks passing
   - ✅ No merge conflicts
   - ✅ Code follows project standards
   - ✅ No new lint/type suppressions added
   - ✅ Tests pass (if applicable)

2. **Update from main** (if behind):
   ```bash
   git fetch origin main
   git merge origin/main
   # Resolve any conflicts
   git push origin [branch-name]
   ```

3. **Final check**:
   ```bash
   gh pr view [NUMBER] --json mergeable,statusCheckRollup
   ```

### Phase 5: Merge

1. **Merge the PR** (using squash merge for clean history):
   ```bash
   gh pr merge [NUMBER] --squash --delete-branch --auto
   ```

   If auto-merge fails, use:
   ```bash
   gh pr merge [NUMBER] --squash --delete-branch
   ```

2. **Verify merge succeeded**:
   ```bash
   gh pr view [NUMBER] --json state,merged,mergedAt
   ```

3. **Clean up local branch**:
   ```bash
   git checkout main
   git pull origin main
   git branch -D [branch-name]
   ```

4. **Verify remote branch deleted**:
   ```bash
   gh pr view [NUMBER] --json headRefName
   git ls-remote --heads origin [branch-name]  # Should return empty
   ```

### Phase 6: Post-Merge Validation

After ALL PRs are merged:

1. **Ensure on main branch**:
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Verify build and deploy workflow**:
   ```bash
   gh run list --workflow=.github/workflows/deploy.yml --limit 1 --json status,conclusion,url
   gh run watch  # Watch the latest workflow run
   ```

3. **If workflow fails**:
   - Investigate the failure logs
   - Create a hotfix commit to main if needed
   - Push the fix and verify workflow succeeds

4. **Final verification**:
   ```bash
   gh pr list --state open  # Should show fewer PRs (or none if all merged)
   git branch --list  # Verify no leftover PR branches locally
   ```

## Important Guidelines

### Code Quality (CRITICAL)

From [CLAUDE.md](../../CLAUDE.md):

- **NEVER add lint suppressions** (`/* eslint-disable */`, `@ts-ignore`, etc.)
- **FIX the actual issues** instead of suppressing errors
- See CLAUDE.md "Code Quality Standards" section for detailed rules
- If you find existing suppressions in the PR, REMOVE them and fix the underlying issues

### Commit Messages

- Follow the project's commit message style (check recent commits)
- Be descriptive about what was fixed
- Reference the PR number in the message
- Always include Co-Authored-By for Claude

### Merge Strategy

- Use **squash merge** to keep main history clean
- Delete branch immediately after merge
- Verify each merge before moving to next PR

### Error Handling

- If a PR cannot be merged (conflicts, failing checks), **skip it** and note it for the user
- Do NOT force-merge failing PRs
- Ask user for guidance on complex review comments you're unsure about

### Branch Cleanup

- Delete remote branches via `gh pr merge --delete-branch`
- Delete local branches manually with `git branch -D`
- Verify cleanup completed before finishing

## Output Format

For each PR, provide:

1. **PR Summary**: #[number] - [title]
2. **Status**: ✅ Merged | ⚠️ Fixed, pending checks | ❌ Blocked (reason)
3. **Changes Made**: List of fixes applied
4. **Comments Addressed**: Count of resolved review threads

At the end, provide:

- **Total PRs processed**: X
- **Successfully merged**: Y
- **Remaining open**: Z
- **Build/Deploy status**: ✅ Passing | ❌ Failed (details)

## Example Workflow

```bash
# 1. Discover PRs
gh pr list --state open --json number,title,isDraft
# Result: PR #347, #348, #349 (0 drafts)

# 2. Review PR #347
gh pr checkout 347
gh pr diff 347
# Found: 2 lint errors, 1 reviewer comment

# 3. Fix issues
# ... edit files ...
git add .
git commit -m "Address review: fix lint errors in BudgetCalendar"
git push

# 4. Verify and merge
gh pr checks 347 --watch
gh pr merge 347 --squash --delete-branch

# 5. Repeat for #348, #349

# 6. Final verification
git checkout main
gh run watch
# ✅ Deploy workflow succeeded
```

## Notes

- This workflow assumes you have `gh` CLI configured and authenticated
- Requires write access to the repository
- May require approval for certain tool uses (Bash git/gh commands)
- If unsure about any review comment, ask the user for clarification before making changes
- Always verify the deploy workflow succeeds before considering the task complete
