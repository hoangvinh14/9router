"""Static artifact/link/hash checks only; never imports app or opens private state."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

PLAN = Path(__file__).resolve().parents[1]
ROOT = PLAN.parents[1]
REFS = PLAN / "references"
# Disabled unconditionally on integration before any historical payload access.
# Original tool remains immutable at preservation 7a4f3a3e, not runnable authority.
raise SystemExit(
    "Archival validator disabled: original reviewed baseline/evidence was not "
    "restored or certified on integration. Use the fresh integration record."
)

manifest = {}  # Historical body below is retained for source reference only.
files = {
    **manifest["files"],
    **manifest.get("supplementalCliFiles", {}),
    **manifest.get("supplementalSourceFiles", {}),
}
drift = [
    name for name, digest in files.items()
    if not (ROOT / name).is_file()
    or hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest
]
missing = []
links = 0
for document in PLAN.rglob("*.md"):
    for target in re.findall(r"\]\(([^)]+)\)", document.read_text()):
        if target.startswith(("http:", "https:", "#", "mailto:")):
            continue
        links += 1
        if not (document.parent / target.split("#")[0]).resolve().exists():
            missing.append({"file": str(document.relative_to(ROOT)), "link": target})
contract = (REFS / "brainstorm-contract.md").read_text()
report = (REFS / "audit-report.md").read_text()
requirements = [f"B{number:02d}" for number in range(1, 9)]
uncovered = [item for item in requirements if item not in contract or item not in report]
refs = {
    name: subprocess.check_output(["git", "rev-parse", name], cwd=ROOT, text=True).strip()
    for name in ("HEAD", "develop", "master")
}
valid = not (drift or missing or uncovered) and refs == manifest["refs"]
result = {
    "type": "static-document-and-scoped-source-validation",
    "status": "passed" if valid else "failed",
    "sourcePathsChecked": len(files), "sourceDrift": drift,
    "localLinksChecked": links, "missingLinks": missing, "anchorsChecked": False,
    "requirementIds": requirements, "uncoveredRequirements": uncovered,
    "refsStable": refs == manifest["refs"],
    "runtimeTests": {"status": "not_run", "reason": "Documentation/static audit only"},
    "security": "Scoped static source review, not certification",
    "markdownDiagnostics": "marksman silent on report; not clean proof; no full lint claim",
    "advisor": "Concise facts/draft reviewed; bounded negative findings and conditional simplifications incorporated",
    "exclusions": manifest["exclusions"],
    "assurance": "Only listed source paths checked. Supplemental paths captured when added; not a whole-tree immutability claim.",
    "initialCheck": "First local-link check found validation.json not yet created; artifact created, checks repeated without runtime activity.",
    "journalValidation": "ak journal validate 2026-11-13-api-key-budget-scope-audit returned ok",
}
(REFS / "validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(0 if valid else 1)
