# aigentify

## Mental model

aigentify audits whether a product is ready for agents and creates the public files that agents need.

## The faces

- Library: import `auditTarget` and `generate` from `aigentify`.
- CLI: use `aigentify audit`, `aigentify init`, `aigentify gen`, or `aigentify mcp`.
- MCP: connect to `aigentify-mcp` over stdio.

## MCP tools

| Tool | Input | Result |
| --- | --- | --- |
| audit | `{ target }` | A score and a list of agent-readiness gaps. |
| gen | `{ artifact, params }` | Generated artifact text. |

## The loop

1. Audit the product directory or URL.
2. Fix the highest-impact gap.
3. Generate the missing public artifact.
4. Audit again.

## Rules

- Treat product facts as source facts.
- Keep public instructions about the product and its use.
- State prices plainly.
- Use the same artifact names across the library, CLI, and MCP tool.

## Offer

aigentify is free to use.

Price: USD 0

<!-- pr-standards:start -->

## Pull requests

One issue. One PR. One concern. Under 500 counted lines.

Open the issue first. No issue, no branch. The issue number ties the branch, the
title, the body and the merged commit to one agreed piece of work.

```text
branch:  aig-<issue>-<slug>          aig-142-fix-onboarding-drop-off
title:   [AIG-<issue>] <Subject>   [AIG-142] Fix onboarding drop-off
body:    Closes #142
         ## What / ## Why / ## How I verified
         Assisted-by: <agent>:<model>
```

Subject line: imperative mood, 10-50 characters, no trailing period, no emoji.
Write "Fix the drop-off", not "Fixed the drop-off".

Hard caps, failed by the `pr-standards` CI check: 500 counted lines, 40 counted
files, exactly one `Closes #`. Lockfiles, build output, snapshots, generated
code and migrations are not counted. There is no label that clears the cap and
no one to ask for one. Split the change.

Settings for this repo are in `.github/pr-standards.json`. The standard is at
https://github.com/pooriaarab/scripts/blob/main/pr-standards.md

<!-- pr-standards:end -->
