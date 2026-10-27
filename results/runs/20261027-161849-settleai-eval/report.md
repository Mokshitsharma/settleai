# SettleAI Evaluation Report

Evaluation across 28 automated scenarios (28/28 passed, 2 skipped). 95% exact Clopper-Pearson confidence bounds. Run `20261027-161849-settleai-eval`.

| Metric | Measured | 95% Confidence Interval | Sample Size |
|---|---|---|---|
| Scenario pass rate | 100.0% | [87.7%, 100.0%] | n = 28 scenarios |
| Bad proofs paid (false release) | 0.0% | [0.0%, 36.9%] | n = 8 invalid submissions |
| Out-of-mandate agent requests allowed | 0.0% | [0.0%, 30.9%] | n = 10 out-of-scope requests |
| Receipt tampering caught | 100.0% | [92.8%, 100.0%] | n = 49 single-field modifications |
| Prompt injection caught | 100.0% | [15.8%, 100.0%] | n = 2 injected attempts |
| Ledger conservation violations | 0 | exact 0 | n = 28 resolutions |

Full numbers: `results/runs/20261027-161849-settleai-eval/report.md` and `metrics.json`.
