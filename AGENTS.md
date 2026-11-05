# Agent notes

## Private offline corpora

Private product specs and golden corpora stay offline (Agent Store / Project machines only). Do not commit corpus text, paraphrases, distinctive private entity names, private metric tables, or env gates that point at private files.

- CI fixture: `tests/fixtures/synthetic-pipeline.md`
- CI harness: `tests/spec/synthetic-pipeline.harness.ts`
- Guard: `npm run check:private-corpus` (also in `.github/workflows/check.yml` and optional `.pre-commit-config.yaml`)

Never force-push stack history without Jeff’s per-branch approval.
