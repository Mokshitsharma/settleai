# Data and models

Author: Mokshit Sharma

## Data

`eval/scenarios.json` defines the scenarios. Demo history comes from `src/core/db/seed-history.ts`. All money is sandbox or mock.

## Models

Scoping, verification and arbiter agents in `src/core/agents`, selected by `LLM_PROVIDER` and `LLM_MODEL`, with offline stubs. Inputs and outputs follow the schemas in that folder.

## Evaluation

The README reports results from run `20261027-165621-settleai-eval`. `pnpm eval` was not reproduced in this review, so those figures are not confirmed here.

## Limitations

Sample sizes are small: for example, 2 prompt-injection attempts and 8 invalid submissions. Scenarios S07 and S08 are not built.
