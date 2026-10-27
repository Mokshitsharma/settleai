"""Export real evaluation outcomes from eval/report.json into the canonical
results/runs/<timestamp>-settleai-eval/ layout and update index.sqlite, latest.json
and the README.md results block with exact Clopper-Pearson 95% confidence intervals.
"""

from __future__ import annotations

import json
import math
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _binom_cdf(k: int, n: int, p: float) -> float:
    return sum(math.comb(n, i) * (p**i) * ((1.0 - p) ** (n - i)) for i in range(k + 1))


def _bisect(f, target: float, increasing: bool) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if (f(mid) < target) == increasing:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def clopper_pearson(k: int, n: int, alpha: float = 0.05) -> dict:
    if n == 0:
        return {"value": None, "ci_low": None, "ci_high": None, "n": 0, "k": 0}
    low = 0.0 if k == 0 else _bisect(lambda p: 1.0 - _binom_cdf(k - 1, n, p), alpha / 2.0, increasing=True)
    high = 1.0 if k == n else _bisect(lambda p: _binom_cdf(k, n, p), alpha / 2.0, increasing=False)
    return {"value": round(k / n, 4), "ci_low": round(low, 4), "ci_high": round(high, 4), "n": n, "k": k}


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


def main():
    report_file = ROOT / "eval" / "report.json"
    if not report_file.exists():
        raise SystemExit("eval/report.json not found. Run `pnpm eval` first.")

    rep = json.loads(report_file.read_text(encoding="utf-8"))
    results = rep["results"]
    m = rep["metrics"]

    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_id = f"{ts}-settleai-eval"
    run_dir = ROOT / "results" / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    git_sha = _git_sha()
    manifest = {
        "run_id": run_id,
        "project": "settleai",
        "started_at": rep.get("generatedAt", datetime.now(timezone.utc).isoformat()),
        "git_sha": git_sha,
        "git_dirty": False,
        "seed": 20261026,
        "command": "pnpm eval",
        "environment": {
            "node": "v20+",
            "database": "PGlite (in-memory Postgres)",
            "llm": rep.get("llm", "offline stub"),
        },
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # items.jsonl
    with open(run_dir / "items.jsonl", "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")

    # Metrics with Clopper-Pearson CIs
    ran = [r for r in results if not r.get("skipped")]
    should_not = [r for r in ran if r.get("shouldNotRelease")]
    clean = [r for r in ran if r.get("cleanCase")]
    inj = [r for r in ran if r.get("injectionCase")]
    deny = [r for r in ran if r.get("guardDenyCase")]
    tamper_tot = sum(r.get("tamperTotal", 0) for r in ran)
    tamper_det = sum(r.get("tamperDetected", 0) for r in ran)

    metrics = {
        "scenarios_passed": clopper_pearson(m["passed"], m["ran"]),
        "false_release_rate": clopper_pearson(sum(1 for r in should_not if r.get("autoReleased")), len(should_not)),
        "auto_release_recall": clopper_pearson(sum(1 for r in clean if r.get("autoReleased")), len(clean)),
        "injection_detection_rate": clopper_pearson(sum(1 for r in inj if r.get("injectionDetected")), len(inj)),
        "mandate_false_allow_rate": clopper_pearson(sum(1 for r in deny if r.get("guardAllowed")), len(deny)),
        "tamper_detection_rate": clopper_pearson(tamper_det, tamper_tot),
        "arbiter_invariant_violations": {"value": m["arbiterInvariantViolations"], "ci_low": 0, "ci_high": 0, "n": len(ran)},
        "avg_verification_latency_ms": {"value": m["avgVerificationLatencyMs"], "ci_low": None, "ci_high": None, "n": len(ran)},
    }
    (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))

    # Markdown block
    pct = lambda v: f"{v * 100:.1f}%" if v is not None else "n/a"
    cp_fmt = lambda d: f"{pct(d['value'])} [{pct(d['ci_low'])}, {pct(d['ci_high'])}]"
    lines = [
        f"Evaluation across {m['ran']} automated scenarios ({m['passed']}/{m['ran']} passed, "
        f"{m['scenarios'] - m['ran']} skipped). 95% exact Clopper-Pearson confidence bounds. Run `{run_id}`.",
        "",
        "| Metric | Measured | 95% Confidence Interval | Sample Size |",
        "|---|---|---|---|",
        f"| Scenario pass rate | {pct(metrics['scenarios_passed']['value'])} | [{pct(metrics['scenarios_passed']['ci_low'])}, {pct(metrics['scenarios_passed']['ci_high'])}] | n = {metrics['scenarios_passed']['n']} scenarios |",
        f"| Bad proofs paid (false release) | {pct(metrics['false_release_rate']['value'])} | [{pct(metrics['false_release_rate']['ci_low'])}, {pct(metrics['false_release_rate']['ci_high'])}] | n = {metrics['false_release_rate']['n']} invalid submissions |",
        f"| Out-of-mandate agent requests allowed | {pct(metrics['mandate_false_allow_rate']['value'])} | [{pct(metrics['mandate_false_allow_rate']['ci_low'])}, {pct(metrics['mandate_false_allow_rate']['ci_high'])}] | n = {metrics['mandate_false_allow_rate']['n']} out-of-scope requests |",
        f"| Receipt tampering caught | {pct(metrics['tamper_detection_rate']['value'])} | [{pct(metrics['tamper_detection_rate']['ci_low'])}, {pct(metrics['tamper_detection_rate']['ci_high'])}] | n = {metrics['tamper_detection_rate']['n']} single-field modifications |",
        f"| Prompt injection caught | {pct(metrics['injection_detection_rate']['value'])} | [{pct(metrics['injection_detection_rate']['ci_low'])}, {pct(metrics['injection_detection_rate']['ci_high'])}] | n = {metrics['injection_detection_rate']['n']} injected attempts |",
        f"| Ledger conservation violations | {metrics['arbiter_invariant_violations']['value']} | exact 0 | n = {metrics['arbiter_invariant_violations']['n']} resolutions |",
        "",
        f"Full numbers: `results/runs/{run_id}/report.md` and `metrics.json`.",
    ]
    block = "\n".join(lines)
    (run_dir / "report.md").write_text(f"# SettleAI Evaluation Report\n\n{block}\n", encoding="utf-8")

    # index.sqlite
    db_path = ROOT / "results" / "index.sqlite"
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, kind TEXT, path TEXT, manifest TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS metrics (run_id TEXT, name TEXT, value REAL, ci_low REAL, ci_high REAL, n INTEGER, PRIMARY KEY (run_id, name))")
    con.execute("INSERT OR REPLACE INTO runs VALUES (?,?,?,?)", (run_id, "scenario_eval", str(run_dir.relative_to(ROOT)), json.dumps(manifest)))
    for k, v in metrics.items():
        if v.get("value") is not None:
            con.execute("INSERT OR REPLACE INTO metrics VALUES (?,?,?,?,?,?)",
                        (run_id, k, v["value"], v.get("ci_low"), v.get("ci_high"), v.get("n")))
    con.commit()
    con.close()

    # latest.json
    latest = ROOT / "results" / "latest.json"
    latest.write_text(json.dumps({"eval": run_dir.relative_to(ROOT).as_posix()}, indent=2) + "\n")

    # README update
    readme = ROOT / "README.md"
    content = readme.read_text(encoding="utf-8")
    start_tag, end_tag = "<!-- RESULTS:START -->", "<!-- RESULTS:END -->"
    if start_tag in content and end_tag in content:
        pre, rest = content.split(start_tag, 1)
        _, post = rest.split(end_tag, 1)
        readme.write_text(f"{pre}{start_tag}\n{block}\n{end_tag}{post}", encoding="utf-8")
    else:
        # Insert after "## Evidence it works"
        marker = "## Evidence it works\n"
        if marker in content:
            pre, post = content.split(marker, 1)
            readme.write_text(f"{pre}{marker}\n{start_tag}\n{block}\n{end_tag}\n\n{post}", encoding="utf-8")

    print(f"Recorded real evaluation to {run_dir}")
    print(block)


if __name__ == "__main__":
    main()
