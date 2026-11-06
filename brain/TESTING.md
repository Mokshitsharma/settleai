# Testing

Author: Mokshit Sharma

## Layout

`tests/` holds `contract`, `db`, `e2e`, `fixtures`, `property`, `reliability`, `security` and `unit`. `eval/` holds scenario evaluation.

## Run

```bash
pnpm test
```

Single-threaded form used in this review: `npx vitest run --no-file-parallelism --maxWorkers=1`.

## Results (2026-11-06)

30 test files, 443 tests passed, 0 failed, before and after the fixes.

Build: not run in the final pass. An earlier build on 16.3.8 failed while resolving Google font files. `pnpm eval` and the Playwright tests were not run in this review.

## Gaps

The new Next.js version needs a build and an end-to-end run.
