#!/usr/bin/env python3
"""
Script to add missing automation translation keys to locale JSON files.

This script:
1. Extracts all automation.* keys used in the codebase
2. Compares with keys defined in locale files
3. Adds missing keys with English placeholder values (or Vietnamese translations if provided)
4. Preserves existing structure and formatting
"""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Dict, Set, Any


def extract_keys_from_code(src_dir: Path) -> Set[str]:
    """Extract all automation.* translation keys used in TypeScript/React code."""
    keys = set()

    # Pattern to match t("automation.something") or t('automation.something')
    # Keys are like "automation.script.toast.duplicated" so we capture everything after "automation."
    pattern = re.compile(r't\(["\']automation\.([^"\']+)["\']')

    # Search in all .ts and .tsx files
    for file_path in src_dir.rglob("*.ts*"):
        if file_path.is_file():
            try:
                content = file_path.read_text(encoding="utf-8")
                for match in pattern.finditer(content):
                    keys.add(match.group(1))
            except Exception as e:
                print(f"Warning: Could not read {file_path}: {e}")

    return keys


def flatten_json(obj: Dict[str, Any], prefix: str = "") -> Dict[str, str]:
    """Flatten nested JSON object to dot-notation keys."""
    result = {}
    for key, value in obj.items():
        new_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(flatten_json(value, new_key))
        else:
            result[new_key] = value
    return result


def unflatten_json(flat_dict: Dict[str, str]) -> Dict[str, Any]:
    """Convert dot-notation keys back to nested structure."""
    result: Dict[str, Any] = {}
    for key, value in flat_dict.items():
        parts = key.split(".")
        current = result
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]
        current[parts[-1]] = value
    return result


def get_missing_keys(code_keys: Set[str], locale_keys: Set[str]) -> Set[str]:
    """Find keys that are in code but missing from locale."""
    return code_keys - locale_keys


def create_nested_structure(key: str, value: str) -> Dict[str, Any]:
    """Create nested dict structure from dot-notation key."""
    parts = key.split(".")
    result: Dict[str, Any] = {}
    current = result
    for part in parts[:-1]:
        current[part] = {}
        current = current[part]
    current[parts[-1]] = value
    return result


def deep_merge(base: Dict[str, Any], addition: Dict[str, Any]) -> Dict[str, Any]:
    """Deep merge two dictionaries."""
    result = base.copy()
    for key, value in addition.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def add_missing_keys_to_locale(
    locale_path: Path,
    missing_keys: Set[str],
    default_value: str = "[TODO: Add translation]"
) -> int:
    """
    Add missing keys to a locale JSON file.

    Returns the number of keys added.
    """
    # Read existing locale file
    with open(locale_path, "r", encoding="utf-8") as f:
        locale_data = json.load(f)

    # Get existing automation section
    automation_section = locale_data.get("automation", {})

    # Flatten existing automation keys
    existing_automation = flatten_json(automation_section, "automation")

    # Find which missing keys are actually missing from automation section
    keys_to_add = []
    for key in missing_keys:
        full_key = f"automation.{key}"
        if full_key not in existing_automation:
            keys_to_add.append(key)

    if not keys_to_add:
        print(f"  No new keys to add to {locale_path.name}")
        return 0

    # Create new entries for missing keys
    new_entries: Dict[str, Any] = {}
    for key in sorted(keys_to_add):
        # Create nested structure for this key
        nested = create_nested_structure(key, default_value)
        new_entries = deep_merge(new_entries, nested)

    # Merge new entries into automation section
    updated_automation = deep_merge(automation_section, new_entries)
    locale_data["automation"] = updated_automation

    # Write back to file (preserve formatting with indent=2)
    with open(locale_path, "w", encoding="utf-8") as f:
        json.dump(locale_data, f, ensure_ascii=False, indent=2)
        f.write("\n")  # Add trailing newline

    print(f"  Added {len(keys_to_add)} keys to {locale_path.name}")
    return len(keys_to_add)


def main():
    # Paths - script is in PROJECTS/donut-browser/scripts/
    # So parent.parent = PROJECTS/donut-browser (project root)
    project_root = Path(__file__).parent.parent
    src_dir = project_root / "src"
    locales_dir = src_dir / "i18n" / "locales"

    en_json = locales_dir / "en.json"
    vi_json = locales_dir / "vi.json"

    print("=" * 60)
    print("Automation i18n Key Migration Script")
    print("=" * 60)
    print()

    # Step 1: Extract all automation keys from code
    print("Step 1: Extracting automation keys from codebase...")
    code_keys = extract_keys_from_code(src_dir)
    print(f"  Found {len(code_keys)} unique automation keys in code")
    print()

    # Step 2: Load locale files and extract existing automation keys
    print("Step 2: Analyzing existing locale files...")

    with open(en_json, "r", encoding="utf-8") as f:
        en_data = json.load(f)
    en_automation = flatten_json(en_data.get("automation", {}), "automation")
    print(f"  en.json has {len(en_automation)} automation keys")

    with open(vi_json, "r", encoding="utf-8") as f:
        vi_data = json.load(f)
    vi_automation = flatten_json(vi_data.get("automation", {}), "automation")
    print(f"  vi.json has {len(vi_automation)} automation keys")
    print()

    # Step 3: Find missing keys
    print("Step 3: Finding missing keys...")
    missing_from_en = get_missing_keys(code_keys, set(k.replace("automation.", "") for k in en_automation.keys()))
    missing_from_vi = get_missing_keys(code_keys, set(k.replace("automation.", "") for k in vi_automation.keys()))

    print(f"  Missing from en.json: {len(missing_from_en)} keys")
    print(f"  Missing from vi.json: {len(missing_from_vi)} keys")
    print()

    if not missing_from_en and not missing_from_vi:
        print("✓ All automation keys are present in both locale files!")
        return

    # Step 4: Add missing keys
    print("Step 4: Adding missing keys...")

    # For English: use the key itself as placeholder (readable)
    added_en = add_missing_keys_to_locale(
        en_json,
        missing_from_en,
        default_value="[TODO: Add English translation]"
    )

    # For Vietnamese: use Vietnamese placeholder
    added_vi = add_missing_keys_to_locale(
        vi_json,
        missing_from_vi,
        default_value="[TODO: Thêm bản dịch tiếng Việt]"
    )

    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Keys added to en.json: {added_en}")
    print(f"  Keys added to vi.json: {added_vi}")
    print(f"  Total keys processed: {len(code_keys)}")
    print()
    print("⚠️  IMPORTANT: Review the added keys and provide proper translations!")
    print("   Search for '[TODO:' in the locale files to find placeholders.")


if __name__ == "__main__":
    main()
