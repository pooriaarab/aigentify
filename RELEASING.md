# Releasing aigentify

Three long-lived branches drive the pipeline:

| Branch       | On push                                       | npm result         |
| ------------ | --------------------------------------------- | ------------------ |
| `main`       | CI runs `npm run verify`                      | none (development) |
| `staging`    | verify, then publish a throwaway prerelease   | `aigentify@next`   |
| `production` | verify, then publish `package.json`'s version | `aigentify@latest` |

## One-time setup

Add an npm **automation token** as the repo secret `NPM_TOKEN`
(npm → Access Tokens → Generate → Automation). CI reads it as `NODE_AUTH_TOKEN`.

## Cut a release

1. Bump the version on `main`: `npm version patch` (or `minor` / `major`), then open a PR and merge.
2. Promote to production: fast-forward `production` to `main` and push. The
   `Publish` workflow publishes that version to `@latest`.
3. To test first, push to `staging` — it publishes a `@next` prerelease you can
   `npm i aigentify@next` and try before promoting.

npm rejects re-publishing an existing version, so always bump before promoting to
`production`.
