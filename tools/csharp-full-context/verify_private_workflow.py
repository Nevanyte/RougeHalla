#!/usr/bin/env python3
"""Static private-dispatch guard and unchanged-job verification; never dispatches or runs a suite."""
import copy
import itertools
import json
from pathlib import Path
import re
import subprocess

import yaml

ROOT = Path(__file__).resolve().parents[2]
BASE = "3426d0d46a04251572234e49d9488f38065736d3"
REF = "refs/heads/codex/csharp-full-context-linux-once"
TUPLE = ("github.event_name == 'workflow_dispatch' && github.ref == '" + REF
         + "' && inputs.allocation_context_diagnostic == true")
DIAGNOSTIC = "${{ always() && (" + TUPLE + ") }}"
INVERSE = "${{ !(" + TUPLE + ") }}"
SYNC = "${{ success() || (always() && (" + TUPLE + ")) }}"


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def git(path):
    return subprocess.check_output(["git", "show", BASE + ":" + path], cwd=ROOT, text=True)


def evaluate(expression, event, ref, flag, succeeded):
    # Only the exact three validated expressions are evaluated, not arbitrary workflow source.
    require(expression in (DIAGNOSTIC, INVERSE, SYNC), "unreviewed expression")
    value = expression[3:-2].strip()
    value = value.replace("github.event_name", "event").replace("github.ref", "ref")
    value = value.replace("inputs.allocation_context_diagnostic", "flag")
    value = value.replace("always()", "True").replace("success()", "succeeded")
    value = re.sub(r"\btrue\b", "True", value).replace("&&", "and").replace("||", "or")
    value = re.sub(r"!(?!=)", "not ", value)
    return bool(eval(value, {"__builtins__": {}}, {"event": event, "ref": ref, "flag": flag, "succeeded": succeeded}))


def main():
    path = ".github/workflows/rust.yml"
    before = yaml.load(git(path), Loader=yaml.BaseLoader)
    after = yaml.load((ROOT / path).read_text(), Loader=yaml.BaseLoader)
    require(before["permissions"] == after["permissions"] == {"contents": "read"}, "permissions changed")
    for event in ("push", "pull_request"):
        require(before["on"][event] == after["on"][event], "normal trigger changed")
    require(after["on"]["workflow_dispatch"] == {"inputs": {"allocation_context_diagnostic": {
        "description": "Run the one approved private C# full-context diagnostic", "type": "boolean",
        "required": "true", "default": "false"}}}, "explicit Boolean schema changed")
    require(set(before["jobs"]) == set(after["jobs"]), "job set changed")
    require(before["jobs"]["provenance"] == after["jobs"]["provenance"], "provenance changed")
    for name in ("simulation", "rust", "card-runtime-source"):
        job = copy.deepcopy(after["jobs"][name])
        require(job.pop("if") == INVERSE, "heavy-job guard changed")
        require(job == before["jobs"][name], "heavy-job body changed")
    current = copy.deepcopy(after["jobs"]["csharp"])
    steps = current.pop("steps")
    original = copy.deepcopy(before["jobs"]["csharp"])
    original_steps = original.pop("steps")
    require(current == original, "C# job configuration changed")
    require(len(original_steps) == 4 and len(steps) == 9, "step cohort changed")
    first = copy.deepcopy(steps[:4])
    require(first[3].pop("if") == SYNC, "sync guard changed")
    require(first == original_steps, "normal suite/sync order or command changed")
    proposal = git("docs/evidence/csharp-full-context/proposed-workflow.patch")
    append = "\n".join(line[1:] for line in proposal.splitlines()
                       if line.startswith("+") and not line.startswith("+++")) + "\n"
    frozen_steps = yaml.load(git(path) + append, Loader=yaml.BaseLoader)["jobs"]["csharp"]["steps"][4:]
    for actual, frozen in zip(steps[4:], frozen_steps):
        actual, frozen = copy.deepcopy(actual), copy.deepcopy(frozen)
        require(actual.pop("if") == DIAGNOSTIC, "diagnostic guard changed")
        require(frozen.pop("if") == "always()" and actual == frozen, "diagnostic command/source changed")

    cases = []
    for event, ref, flag, succeeded in itertools.product(
            ("push", "pull_request", "workflow_dispatch"),
            (REF, "refs/heads/optimization_port", "refs/heads/codex/other"), (None, False, True), (False, True)):
        active = event == "workflow_dispatch" and ref == REF and flag is True
        require(evaluate(DIAGNOSTIC, event, ref, flag, succeeded) == active, "diagnostic truth boundary")
        require(evaluate(INVERSE, event, ref, flag, succeeded) == (not active), "heavy-job truth boundary")
        require(evaluate(SYNC, event, ref, flag, succeeded) == (succeeded or active), "sync failure boundary")
        cases.append({"event": event, "ref": ref, "input": flag, "normalSucceeded": succeeded,
                      "diagnostic": active, "heavyJobsEligible": not active, "sync": succeeded or active})
    print(json.dumps({"scope": "Static YAML/source and expression truth model; no GitHub execution claim",
                      "base": BASE, "privateRef": REF, "cases": cases, "count": len(cases)}, indent=2))


if __name__ == "__main__":
    main()
