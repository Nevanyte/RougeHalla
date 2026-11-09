"""Read-only source checks for the narrow Settings row-height repair; not a Unity test."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

REPO = Path('/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/unity-owned-seat-resume/repo')
BASE = 'cdec00efa6d56661264271ebc3437f7b7f5349c2'
SOURCE_COMMIT = 'cb7f67d93db4e36d97940f3f48713f6c107db234'
SOURCE = 'client-unity/UnityProject/Assets/Scripts/UI/ModernSettingsView.cs'
TEST = 'client-unity/UnityProject/Assets/Tests/Editor/ModernSettingsLayoutEditModeTests.cs'
PACKAGE = Path('/Users/nevinmckinnon/Documents/Projects/RogueHalla-unity-art/client-unity/UnityProject/Library/PackageCache/com.unity.ugui@cd4936b8279f/Runtime/UGUI/UI/Core/Layout/HorizontalOrVerticalLayoutGroup.cs')
LAYOUT_PACKAGE = PACKAGE.with_name('LayoutGroup.cs')
REPORT = REPO / 'docs/evidence/unity-settings-row-layout/SOURCE_REVIEW.json'

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def sha(data):
    return hashlib.sha256(data).hexdigest()

before = git('show', BASE + ':' + SOURCE)
after = (REPO / SOURCE).read_bytes()
source_commit = SOURCE_COMMIT
assert git('rev-parse', source_commit + '^').decode().strip() == BASE
assert sorted(git('diff', '--name-only', BASE, source_commit).decode().splitlines()) == sorted([SOURCE, TEST, TEST + '.meta'])
assert all((REPO / path).read_bytes() == git('show', source_commit + ':' + path) for path in [SOURCE, TEST, TEST + '.meta'])
expected = before.replace(b'vertical.childControlHeight = false;', b'vertical.childControlHeight = true;')
assert before.count(b'vertical.childControlHeight = false;') == 1
assert after == expected, 'Product edit must be exactly one height-control property.'
package = PACKAGE.read_bytes()
layout_package = LAYOUT_PACKAGE.read_bytes()
assert b'min = child.sizeDelta[axis];' in package
assert b'preferred = LayoutUtility.GetPreferredSize(child, axis);' in package
assert b'pos += childSize * scaleFactor + spacing;' in package
assert b'rect.anchorMin = Vector2.up;' in layout_package
assert b'rect.anchorMax = Vector2.up;' in layout_package

prior_tests = git('ls-tree', '-r', '--name-only', BASE, '--', 'client-unity/UnityProject/Assets/Tests/Editor').decode().splitlines()
assert all((REPO / path).read_bytes() == git('show', BASE + ':' + path) for path in prior_tests)
source_text = after.decode()
assert source_text.count('AddButtonRow("') + source_text.count('AddSliderRow("') == 12
row_height = float(re.search(r'const float RowHeight = ([0-9.]+)f;', source_text)[1])
spacing = float(re.search(r'vertical.spacing = ([0-9.]+);', source_text)[1])
new_content_height = 20 + 12 * row_height + 11 * spacing
assert new_content_height == 972
meta_path = REPO / (TEST + '.meta')
new_guid = re.search(r'^guid: ([0-9a-f]{32})$', meta_path.read_text(), re.M)[1]
tracked_metas = git('ls-tree', '-r', '--name-only', BASE, '--', 'client-unity/UnityProject/Assets').decode().splitlines()
existing_guids = []
for path in tracked_metas:
    if path.endswith('.meta'):
        match = re.search(rb'^guid: ([0-9a-f]{32})$', git('show', BASE + ':' + path), re.M)
        if match:
            existing_guids.append(match[1].decode())
assert new_guid not in existing_guids

report = {
    'status': 'SOURCE_REVIEW_ONLY_NATIVE_UNRUN',
    'baseCommit': BASE,
    'sourceCommit': source_commit,
    'scope': 'One existing layout property, one new direct geometry fixture and its meta; no existing tests changed.',
    'productDiffIsExactlyOneProperty': True,
    'existingEditorTestAndMetaFilesUnchanged': len(prior_tests),
    'newMetaGuidUniqueAgainstBase': True,
    'diagnosis': {
        'oldAllocatedRowHeight': 0,
        'oldRowAdvance': spacing,
        'oldContentPreferredHeight': 20 + 11 * spacing,
        'oldRenderedRowHeightNote': 'LayoutGroup pins both anchors to Vector2.up; the final rect has zero height. Content height is 108.',
        'expectedFixedRowHeight': row_height,
        'expectedFixedGap': spacing,
        'expectedFixedContentPreferredHeight': new_content_height,
        'nativeMeasurements': None
    },
    'checksPerformed': ['Exact source diff', 'Existing Editor fixtures and metas byte comparison', 'New meta GUID uniqueness', 'Installed UGUI branch inspection', 'Source-derived layout arithmetic'],
    'notPerformed': ['Compilation', 'Managed tests', 'Unity/native tests', 'Editor actions', 'Browser input', 'Web build', 'Fixed raster capture'],
    'files': {
        SOURCE: {'sha256': sha(after), 'bytes': len(after)},
        TEST: {'sha256': sha((REPO / TEST).read_bytes()), 'bytes': (REPO / TEST).stat().st_size},
        TEST + '.meta': {'sha256': sha(meta_path.read_bytes()), 'bytes': meta_path.stat().st_size}
    },
    'installedUguiSource': {'path': str(PACKAGE), 'sha256': sha(package), 'bytes': len(package)},
    'installedLayoutGroupSource': {'path': str(LAYOUT_PACKAGE), 'sha256': sha(layout_package), 'bytes': len(layout_package)},
    'sourceCheckerSha256': sha(Path(__file__).read_bytes()),
    'testCasesStatus': 'Authored source only; no compiled case inventory and no test result.'
}
REPORT.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'report': str(REPORT), 'reportSha256': sha(REPORT.read_bytes()), 'existingFilesPreserved': len(prior_tests)}))
