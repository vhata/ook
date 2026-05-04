@AGENTS.md

# ook

What I'm reading, what I've read, and the bingo card I'm chasing.

## Required reading before substantive work

Three documents form the canonical brief. Read all three before any non-trivial task in this repository.

- **`SPEC.md`** — what this project is.
- **`ARCHITECTURE.md`** — how it is built.
- **`PROCESS.md`** — how we work.

The disciplines in `ARCHITECTURE.md` and `PROCESS.md` are not advisory; they govern the work.

## Patterns established by feedback

Load-bearing patterns the user has explicitly asked for. These live here, in git, so they survive a laptop death.

### Codify new ideas in TODO.md before deciding to implement

When a new feature, polish item, or design idea surfaces in conversation — whether it came from the assistant or the user — the immediate move is an entry in `TODO.md` with the rationale captured at idea-time. _Then_, separately, decide whether to implement now or leave it. Do not ask "should we build this now?" without writing it down first; ideas evaporate, and the in-conversation tradeoff analysis is the most valuable part to preserve. The default is "codify, then defer"; pulling the entry forward is a second decision the user makes deliberately.

### Use `npx -y vercel@latest`, never assume a global `vercel`

**Why:** the user's `vercel` install state varies (pnpm-installed at one point, possibly brew-installed at another, possibly neither). Pinning the project to `npx -y vercel@latest` removes that variability — every CLI invocation fetches the current release into the npx cache, no global package-manager state required.

**How to apply:** when you reach for the Vercel CLI (`vercel ls`, `vercel inspect`, `vercel env add`, `vercel --prod`, etc.), prefix with `npx -y vercel@latest`. Do not run a bare `vercel` even if it appears to be on PATH — you might be talking to a stale version that errors mid-deploy. The same rule covers `gh` (assume installed via brew), but it does NOT cover npm/pnpm/git themselves — those are baseline dev tooling.

<!-- Add patterns as feedback surfaces them. Each pattern: lead with the rule, then a Why: line and a How to apply: line. -->
