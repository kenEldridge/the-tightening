---
allowed-tools: Bash(git *), Read, Edit, Write, Glob, Grep
description: Wrap up session - update CLAUDE.md, document, cleanup, commit, push
---

## Context

- Current project: !`pwd`
- Git status: !`git status --short`
- Recent work (last 5 commits): !`git log --oneline -5 2>/dev/null || echo "No commits yet"`
- CLAUDE.md exists: !`test -f CLAUDE.md && echo "Yes" || echo "No"`
- Uncommitted changes: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Your Task: Mark It (Wrap Up Session)

You are wrapping up a coding session. Complete these steps in order:

### 1. Document in CLAUDE.md

Review what was accomplished this session and update the project's CLAUDE.md:
- Add any new architecture decisions or patterns
- Document new features, components, or APIs
- Update "Known Issues" if any were found/fixed
- Add to "Future Enhancements" if ideas came up
- Update file descriptions if structure changed

If CLAUDE.md doesn't exist, create a basic one.

### 2. Cleanup Garbage

Look for and remove:
- Unused imports in modified files
- Dead code or commented-out blocks that are no longer needed
- Empty files or test artifacts
- Console.log/debug statements that shouldn't be committed

Be conservative - only remove things that are clearly garbage.

### 3. Add Helpful Comments

For any complex code written this session:
- Add brief comments explaining non-obvious logic
- Document any workarounds or hacks with context
- Add TODO comments for known technical debt

### 4. Git: Add, Commit, Push

Stage all changes and create a meaningful commit:
- Summarize what was accomplished
- Use conventional commit style if the project uses it
- Push to remote

### 5. Chill

After completing all steps, provide a brief session summary:
- What was accomplished
- Any open issues or next steps
- Anything interesting discovered

Remember: Be thorough but efficient. Don't over-document or over-comment.
