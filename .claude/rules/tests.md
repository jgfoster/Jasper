---
paths:
  - "**/*.test.ts"
  - "**/__tests__/**"
---

# Tests

Repo-wide test conventions (all workspaces). Workspace specifics live in their respective nested rules.

Test names should use plain language, not code identifiers. Describe the scenario from a functional or user perspective — avoid mirroring internal field names, variable names, or implementation details.

- ✗ `when isNewMethod is true`
- ✓ `when the previous URI is a template`

Test names state what is always true, not what happens to be true in this one run. `'returns 3 when adding 1 + 2'` describes the example; `'adds two positive numbers'` describes the guarantee. If the example changes, the first name rots; the second stays valid.

- ✗ `returns 3 when adding 1 + 2`
- ✓ `adds two positive numbers`

**Test structure: three parts, separated by blank lines.**
Tests have up to three parts — setup (optional), exercise, and assert(s) — each separated by a blank line. Always use blank lines between present parts; they make the structure scannable at a glance. Never use section-label comments.
