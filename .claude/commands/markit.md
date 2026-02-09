---
allowed-tools: Bash(git *), Read, Edit, Write, Glob, Grep
description: Wrap up session (delegates to canonical markit in the-derple-dex)
---

## Proxy Skill

This is a proxy to the canonical `/markit` skill located in the-derple-dex.

**Current project context:** !`pwd`

## Instructions

1. Read the canonical markit skill instructions from:
   `/mnt/c/Users/eldri/projects/the-derple-dex/.claude/commands/markit.md`

2. Execute those instructions **for this current project** (not the-derple-dex).

3. The context data below is for THIS project - use it when following the canonical instructions.

## This Project's Context

- Git status: !`git status --short`
- Recent work (last 5 commits): !`git log --oneline -5 2>/dev/null || echo "No commits yet"`
- CLAUDE.md exists: !`test -f CLAUDE.md && echo "Yes" || echo "No"`
- Uncommitted changes: !`git diff --stat HEAD 2>/dev/null | tail -5`

Now read the canonical skill file and execute its steps for this project.
