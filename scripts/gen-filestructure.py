#!/usr/bin/env python3
"""Regenerates filestructure.txt as a sorted, indented directory tree.

Excludes noisy/generated directories that add no value to a structural
overview: node_modules, .git, dist/dist-ssr, Rust build output (target),
and Piper's bundled espeak-ng dictionary data (src-tauri/resources/piper/
piper/espeak-ng-data) — the latter is ~700 near-identical per-language
*_dict entries that swamped the previous version of this file without
describing anything about the app's own structure. The directory itself
is still listed; only its contents are pruned, with a note.
"""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT = os.path.join(ROOT, "filestructure.txt")

EXCLUDE_DIRS = {"node_modules", ".git", "dist", "dist-ssr", "target"}
# Relative POSIX paths (from repo root) whose *contents* are pruned rather
# than the directory itself being excluded.
PRUNE_CONTENTS = {"src-tauri/resources/piper/piper/espeak-ng-data"}


def walk(path: str, rel: str, depth: int, lines: list[str]) -> None:
    try:
        entries = sorted(os.listdir(path), key=str.lower)
    except OSError:
        return
    indent = "    " * depth
    for name in entries:
        full = os.path.join(path, name)
        entry_rel = f"{rel}/{name}" if rel else name
        if os.path.isdir(full):
            if name in EXCLUDE_DIRS:
                continue
            lines.append(f"{indent}|-- {name}")
            if entry_rel in PRUNE_CONTENTS:
                lines.append(f"{indent}    |-- (pruned: {len(os.listdir(full))} files omitted)")
                continue
            walk(full, entry_rel, depth + 1, lines)
        else:
            lines.append(f"{indent}|-- {name}")


def main() -> None:
    lines: list[str] = []
    walk(ROOT, "", 0, lines)
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {len(lines)} lines to {OUTPUT}")


if __name__ == "__main__":
    main()
