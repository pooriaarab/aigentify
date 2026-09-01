# aigentify Design

## Overview

This contract covers CLI output, MCP results, library results, and generated artifacts.
The surface type is `developer-ui`.

Use `src/audit/report.ts` as the text report source.
Use `src/cli.ts` and `src/mcp.ts` as interface sources.
Use `src/generators/` as the artifact source.

Keep output stable, scannable, and suitable for scripts.

## Colors

No color system exists in the repository.
Terminal output inherits the caller's palette.

Do not add ANSI color as the only status cue.
Generated text and JSON must not contain terminal styling.

## Typography

No font is owned or loaded by this repository.
Terminal and generated output use the consumer's font.

Use uppercase status labels from `src/audit/report.ts`.
Keep commands, paths, artifact names, and identifiers unchanged.

Do not depend on font weight, italics, or glyph width for meaning.

## Layout

Start a text audit with `<target>: <score>/100`.
Follow it with one check per line.

Format each check as a four-character uppercase status, identifier, and note.
End with `Gaps:`.

Write `None.` when no gaps exist.
Otherwise, number gaps in check order.

The CLI's `--json` option emits two-space indented JSON.
Generated JSON uses two-space indentation and a final newline.

Keep generated Markdown section order stable within each artifact.
Keep every generated artifact newline-terminated.

## Elevation & Depth

Not applicable.
The repository has no visual layer, overlays, shadows, or stacking rules.

Represent hierarchy through headings, line order, and indentation.

## Shapes

Use text markers defined by `src/audit/report.ts`.
Status labels are `PASS`, `WARN`, `FAIL`, or `NA`.

Use a colon between an identifier and its note.
Use numbered lines for gaps.

Do not use decorative boxes, emoji, or Unicode art as required structure.

## Components

The CLI commands are `audit`, `init`, `gen`, and `mcp`.
The MCP tools are `audit` and `gen`.

`audit` returns a score, checks, and gaps.
`gen` returns one generated artifact as text.

Artifact names are `agents-md`, `server-json`, `offer`, `agents-route`, and `auth-md`.

Write normal output to stdout.
Write caught CLI errors to stderr and set a nonzero exit code.

Keep JSON field names and artifact names stable across interfaces.

## Do's and Don'ts

- Do show the target and score before individual checks.
- Don't hide a failed check behind summary prose.
- Do preserve uppercase status labels and numbered gaps.
- Don't use color as required meaning.
- Do keep JSON valid and generated files newline-terminated.
- Don't add terminal styling to generated artifacts.
- Do use the same command, tool, and artifact names across interfaces.
- Don't rename an artifact in only one interface.
- Do send caught CLI errors to stderr with a nonzero exit code.
- Don't report an error as successful output.
