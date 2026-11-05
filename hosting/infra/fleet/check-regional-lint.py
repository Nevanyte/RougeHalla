"""Allow only the pinned registry's two missing Canada resource types, never arbitrary lint failure."""
import json
import sys

findings = json.load(open(sys.argv[1], encoding="utf-8"))
status = int(sys.argv[2])
expected = {
    ("E3006", ("Resources", "GroupDefinition", "Type")),
    ("E3006", ("Resources", "Fleet", "Type")),
}
actual = {(f["Rule"]["Id"], tuple(f["Location"]["Path"])) for f in findings}
if status == 0 and not findings:
    print("ca-central-1 schema: clean")
elif status == 2 and len(findings) == 2 and actual == expected:
    print("ca-central-1 schema: only the two known missing container resource types")
else:
    print(json.dumps(findings, indent=2))
    sys.exit(1)
