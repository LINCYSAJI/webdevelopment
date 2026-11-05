---
name: project-board
description: Sync the Franchise Portal project board. Commits outstanding work on the development branch, checks commits, the development vs production state, test results and phase progress, then updates and republishes the project board artifact at its existing link. Use whenever the user asks to update or check the project board, project status or progress, and ALWAYS run it without being asked after finishing a build phase or feature, after committing a phase's work, or at the end of any session that changed code.
---

# Project board sync

Keeps the project board (an Artifact) in step with the real state of the code. The board's page lives in the repository at `docs/project-board.html`. Its data sits between the `BOARD DATA START` and `BOARD DATA END` markers. Never edit the page code outside those markers unless the user asks for a design change.

- **Artifact link (never create a new one):** https://claude.ai/artifact/PMfkGD7WtUiVsceFvtMRXD
- **Source file:** `docs/project-board.html`
- **Facts come from:** git, `CLAUDE.md` (Build progress), `PRD.md` (screens, open questions §18.2, assumptions §18.1) and test runs. Never invent progress.

Work through the steps in order. Report briefly to the user at the end in plain business language (the owner is non-technical).

## 1. Check the branch (stop if unsafe)

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

- Work only on `development`. If the current branch is `production` or anything else, **stop and ask the user**. Never commit to or push `production` (CLAUDE.md "Git workflow").
- If a merge, rebase or cherry-pick is in progress, stop and ask.

## 2. Commit the work up to this point

If `git status --porcelain` shows changes:

1. Review what changed: `git status --short` and `git diff --stat`, plus `git diff` for anything unclear.
2. **Never commit secrets or local data.** Check that no `.env` file (other than `.env.example`), key, token, `server/.data/` or `server/storage/` content is staged. If one would be, stop and tell the user.
3. Run `npm run typecheck`.
4. Stage everything else (`git add -A`) and commit with a message that says what changed in plain words. Group into several commits only when the changes are clearly unrelated.
   - If the typecheck failed, still commit (the user wants work saved up to this point), but start the subject with `WIP (does not compile):` and say so in the report.
   - End every commit message with the attribution line from the current system reminder (currently `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
   - Never use `--no-verify`, never amend or rewrite existing commits.
   - Write the message to a file and use `git commit -F <file>`. Heredocs with quotes break this shell.

## 3. Gather the facts

```bash
git rev-parse --short development
git rev-list --count development
git rev-parse --short production
git log -1 --format=%s production
git rev-list --count production..development
git log development --format="%h|%ad|%s" --date=short -10
git remote -v
```

- If a remote exists: `git fetch` it, then compare `development` with `origin/development` (`git rev-list --count origin/development..development`). If there are unpushed commits, push with `git push origin development`. The pre-push hook blocks `production`. Never push `production` and never force-push.
- Find the last synced commit in `SYNC.developmentHead` in the board file. List what changed since then: `git log <that>..HEAD --oneline` and `git diff --stat <that>..HEAD`.
- **Tests:** if any file under `server/`, `client/`, `shared/` or `package.json` changed since the last synced commit, run `npm test` (takes a few minutes) and record whether every suite passed and how many suites ran. Otherwise keep the previous result. Never mark tests as passing without a run at or after that commit.

## 4. Decide each card's status

Statuses: `planned`, `notstarted`, `dev`, `test`, `done`. Apply these rules:

| Status | Rule |
|---|---|
| `done` | The feature is committed, its phase is marked ✅ in CLAUDE.md Build progress, and automated tests pass. Also: the previous phase's `test` cards once the next phase has started and the user has reported no problems with them. |
| `test` | The **most recently finished** phase's built features, until the user confirms they tried them or the next phase starts. Also review tasks that need the owner (keep `w: true`). |
| `dev` | Work committed or uncommitted **after** the last ✅ phase that belongs to the next phase (look at changed files and commit messages). |
| `notstarted` | The next phase in CLAUDE.md Build progress that has no work yet. |
| `planned` | Phases after that. |

- **Owner tasks** (`w: true`) stay `test` (or `planned`) until the user says they are done; then set `s: 'done'` and remove `w`.
- **New work not on the board:** add a card with the same fields. These are `t` title, `p` phase (`'1'`–`'9'` or `'L'`), `s` status, `a` area (reuse existing areas), `d` one plain sentence, `r` PRD reference, and `w` if it needs the owner. New phases go in `PHASES`. New screens go in `SCREENS`.
- **Scope changes:** if a PRD change removes something, delete its card. If it changes a screen code, update `SCREENS`.
- Keep `ACTIONS`, `QUESTIONS` and `DEFAULTS` in step with PRD §18 and anything the user has decided. Remove items the user has answered or done.

## 5. Update the data block

Edit only between the markers in `docs/project-board.html`:

- `SYNC`:
  - `date` is today (YYYY-MM-DD).
  - `developmentHead` and `developmentCommits` describe the development branch **after step 2's commits, before the board commit**.
  - `productionHead` and `productionLabel` describe the production branch.
  - `aheadOfProduction` is the number of development commits not yet on production.
  - `remote` is the remote URL, or `null`.
  - `pushed` is a boolean.
  - `tests` is `{ suites, passing, atCommit }`.
  - `uncommittedAtSync` is 0 after step 2.
  - `headline` is one short line, e.g. `'Phase 8 in development · reminders built'`.
- `COMMITS`: the latest 10 development commits as `[hash, 'YYYY-MM-DD', subject]`. Leave out commits whose subject is exactly `Update project board`.
- `CARDS`, `PHASES`, `SCREENS`, `ACTIONS`, `QUESTIONS`, `DEFAULTS` as decided in step 4.

Then check that the page's script still parses. Extract the inline script and run `node --check` on it:

```bash
python -I -c "import re,sys;s=open('docs/project-board.html',encoding='utf-8').read();open(sys.argv[1],'w',encoding='utf-8').write(re.findall(r'<script>(.*?)</script>',s,re.S)[-1])" "<scratchpad>/board-check.js" && node --check "<scratchpad>/board-check.js"
```

## 6. Republish to the same link

1. In a conversation that has not yet published this artifact, first call the Artifact tool with `action: "read"` and `url` set to the link above. A publish without that read is refused.
2. Then publish with `file_path: docs/project-board.html` and `url` set to the link above. Do not pass `icon`. Never publish without `url`, because that creates a second board.
3. If the publish is refused because a newer version exists, read it, carry over anything the user changed, and publish again.

## 7. Commit the board

Commit `docs/project-board.html` with the subject `Update project board` and the attribution line. If a remote exists, push `development` again.

## 8. Report

Tell the user, in a few plain lines:
- what was committed (or that there was nothing to commit);
- development vs production (commits waiting for a reviewed merge) and whether anything was pushed;
- test result;
- what moved on the board (e.g. "Phase 8: 3 cards to In development");
- the board link.
