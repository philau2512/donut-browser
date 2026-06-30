#!/usr/bin/env python3
"""
Script to add all missing automation.nodes.* translation keys to locale files.

This script extracts all labelKey, descriptionKey, documentKey from catalog files
and adds them to both en.json and vi.json with appropriate placeholder values.
"""

import json
import re
from pathlib import Path
from typing import Dict, Set, Any


def extract_keys_from_catalogs(src_dir: Path) -> Set[str]:
    """Extract all automation.nodes.* keys from catalog files."""
    keys = set()

    # Pattern to match labelKey, descriptionKey, documentKey values
    pattern = re.compile(r'(labelKey|descriptionKey|documentKey):\s*["\']([^"\']+)["\']')

    for file_path in src_dir.rglob("*.ts"):
        if "catalog" in str(file_path):
            try:
                content = file_path.read_text(encoding="utf-8")
                for match in pattern.finditer(content):
                    keys.add(match.group(2))
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


def add_keys_to_locale(
    locale_path: Path,
    keys_to_add: Set[str],
    default_value: str
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

    # Find which keys are actually missing
    keys_missing = []
    for key in keys_to_add:
        if key not in existing_automation:
            keys_missing.append(key)

    if not keys_missing:
        print(f"  No new keys to add to {locale_path.name}")
        return 0

    # Create new entries for missing keys
    new_entries: Dict[str, Any] = {}
    for key in sorted(keys_missing):
        # Remove "automation." prefix for nested structure
        nested_key = key.replace("automation.", "")
        nested = create_nested_structure(nested_key, default_value)
        new_entries = deep_merge(new_entries, nested)

    # Merge new entries into automation section
    updated_automation = deep_merge(automation_section, new_entries)
    locale_data["automation"] = updated_automation

    # Write back to file
    with open(locale_path, "w", encoding="utf-8") as f:
        json.dump(locale_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"  Added {len(keys_missing)} keys to {locale_path.name}")
    return len(keys_missing)


def main():
    project_root = Path(__file__).parent.parent
    src_dir = project_root / "src"
    locales_dir = src_dir / "i18n" / "locales"

    en_json = locales_dir / "en.json"
    vi_json = locales_dir / "vi.json"

    print("=" * 60)
    print("Automation Nodes i18n Key Migration Script")
    print("=" * 60)
    print()

    # Step 1: Extract all automation.nodes.* keys from catalog files
    print("Step 1: Extracting automation.nodes.* keys from catalog files...")
    all_keys = extract_keys_from_catalogs(src_dir)
    print(f"  Found {len(all_keys)} unique automation.nodes.* keys in catalog files")
    print()

    if not all_keys:
        print("⚠️  No keys found! Check catalog files.")
        return

    # Step 2: Add missing keys to locale files
    print("Step 2: Adding missing keys to locale files...")

    # For English: use readable placeholder
    added_en = add_keys_to_locale(
        en_json,
        all_keys,
        default_value="[TODO: Add English translation]"
    )

    # For Vietnamese: use Vietnamese placeholder
    added_vi = add_keys_to_locale(
        vi_json,
        all_keys,
        default_value="[TODO: Thêm bản dịch tiếng Việt]"
    )

    print()
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Keys added to en.json: {added_en}")
    print(f"  Keys added to vi.json: {added_vi}")
    print(f"  Total unique keys processed: {len(all_keys)}")
    print()
    print("⚠️  IMPORTANT: Review the added keys and provide proper translations!")
    print("   Search for '[TODO:' in the locale files to find placeholders.")


if __name__ == "__main__":
    main()
