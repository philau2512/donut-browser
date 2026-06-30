#!/usr/bin/env python3
"""
Fill Vietnamese translations for automation keys that have English placeholders.
"""

import json
from pathlib import Path
from typing import Dict, Any


# Vietnamese translations for automation keys
VI_TRANSLATIONS: Dict[str, str] = {
    # Actions
    "automation.actions.run": "Chạy",
    "automation.actions.starting": "Đang bắt đầu...",
    "automation.actions.stopAll": "Dừng tất cả",

    # Editor - Boolean
    "automation.editor.booleanEnabled": "Bật",

    # Editor - Comment
    "automation.editor.comment.characters": "ký tự",
    "automation.editor.comment.title": "Chú thích",

    # Editor - Errors
    "automation.editor.errors.loadFailed": "Tải script thất bại",
    "automation.editor.errors.saveFailed": "Lưu script thất bại",

    # Editor - Linear
    "automation.editor.linearHint": "Chế độ tuyến tính",

    # Editor - Name
    "automation.editor.name": "Tên script",
    "automation.editor.namePlaceholder": "Nhập tên script...",

    # Editor - Properties
    "automation.editor.properties.continueOnError": "Tiếp tục khi lỗi",
    "automation.editor.properties.continueOnErrorHint": "Bỏ qua lỗi và tiếp tục các bước tiếp theo",
    "automation.editor.properties.document": "Tài liệu",
    "automation.editor.properties.options": "Tùy chọn",
    "automation.editor.properties.setting": "Cài đặt",

    # Editor - Saving
    "automation.editor.saving": "Đang lưu...",

    # Editor - Toast
    "automation.editor.toast.saved": "Đã lưu script",
    "automation.editor.toast.startFromHere": "Bắt đầu từ đây",

    # Editor - Toolbar
    "automation.editor.toolbar.delete": "Xóa",
    "automation.editor.toolbar.edit": "Chỉnh sửa",
    "automation.editor.toolbar.startFromHere": "Bắt đầu từ đây",

    # Editor - Variables
    "automation.editor.variables.add": "Thêm biến",
    "automation.editor.variables.autoInjected": "Tự động inject",
    "automation.editor.variables.description": "Mô tả",
    "automation.editor.variables.reserved": "Biến hệ thống",
    "automation.editor.variables.title": "Biến",

    # Errors
    "automation.errors.readFlowFailed": "Đọc script thất bại",
    "automation.errors.startFailed": "Khởi động script thất bại",
    "automation.errors.stopFailed": "Dừng script thất bại",

    # Flow
    "automation.flow.empty": "Script trống",
    "automation.flow.label": "Nhãn",
    "automation.flow.placeholder": "Nhập nhãn...",
    "automation.flow.refresh": "Làm mới",

    # Grid
    "automation.grid.empty": "Chưa có script nào",
    "automation.grid.stopProfile": "Dừng profile",

    # Log
    "automation.log.allProfiles": "Tất cả profile",
    "automation.log.empty": "Chưa có log nào",
    "automation.log.openFile": "Mở file",
    "automation.log.scrollLock": "Khóa cuộn",
    "automation.log.scrollUnlock": "Mở khóa cuộn",
    "automation.log.title": "Nhật ký",

    # Profiles
    "automation.profiles.deselectAll": "Bỏ chọn tất cả",
    "automation.profiles.empty": "Không có profile",
    "automation.profiles.label": "Profile",
    "automation.profiles.selectAll": "Chọn tất cả",

    # Review
    "automation.review.confirm": "Xác nhận",
    "automation.review.description": "Mô tả",
    "automation.review.noSelectors": "Không có selector",
    "automation.review.noUrls": "Không có URL",
    "automation.review.selectors": "Selector",
    "automation.review.templatedOrInvalidHost": "Host không hợp lệ hoặc có template",
    "automation.review.title": "Xem lại",
    "automation.review.urls": "URL",

    # Run Info
    "automation.runInfo": "Thông tin chạy",

    # Script - Confirm
    "automation.script.confirm.deleteDescription": "Bạn có chắc muốn xóa script này?",
    "automation.script.confirm.deleteTitle": "Xóa script",
    "automation.script.confirm.exportVariables": "Script này chứa biến. Xuất luôn các biến?",
    "automation.script.confirm.overwriteImport": "Script '{name}' đã tồn tại. Ghi đè?",

    # Script - Errors
    "automation.script.errors.deleteFailed": "Xóa script thất bại: {error}",
    "automation.script.errors.duplicateFailed": "Nhân bản script thất bại: {error}",
    "automation.script.errors.exportFailed": "Xuất script thất bại: {error}",
    "automation.script.errors.importFailed": "Nhập script thất bại: {error}",

    # Script - Loading
    "automation.script.loading": "Đang tải...",

    # Script - Modified At
    "automation.script.modifiedAt": "Sửa lần cuối: {date}",

    # Script - No Matches
    "automation.script.noMatches": "Không tìm thấy script nào",

    # Script - Actions
    "automation.script.delete": "Xóa",
    "automation.script.duplicate": "Nhân bản",
    "automation.script.edit": "Chỉnh sửa",
    "automation.script.export": "Xuất",

    # Script - Toast
    "automation.script.toast.deleted": "Đã xóa script '{name}'",
    "automation.script.toast.duplicated": "Đã nhân bản script thành '{name}'",
    "automation.script.toast.exported": "Đã xuất script '{name}'",
    "automation.script.toast.imported": "Đã nhập script '{name}'",

    # Settings
    "automation.settings.closeOnComplete": "Đóng khi hoàn tất",
    "automation.settings.closeOnCompleteHint": "Tự động đóng trình duyệt sau khi script hoàn tất",
    "automation.settings.concurrency": "Số profile chạy đồng thời",
    "automation.settings.concurrencyHint": "Số lượng profile tối đa chạy cùng lúc",
    "automation.settings.delayOpen": "Độ trễ mở profile (ms)",
    "automation.settings.delayOpenHint": "Đợi bao lâu trước khi mở profile tiếp theo",
    "automation.settings.headless": "Chế độ headless",
    "automation.settings.headlessHint": "Chạy trình duyệt ẩn (không hiển thị cửa sổ)",
    "automation.settings.noOverlapping": "Không chồng chéo",
    "automation.settings.noOverlappingHint": "Không chạy nhiều script trên cùng profile",
    "automation.settings.title": "Cài đặt",
    "automation.settings.writeLogs": "Ghi log",
    "automation.settings.writeLogsHint": "Lưu nhật ký chi tiết vào file",
}


def deep_set(d: Dict[str, Any], key_path: str, value: str) -> None:
    """Set a nested value using dot notation."""
    parts = key_path.split(".")
    current = d
    for part in parts[:-1]:
        if part not in current:
            current[part] = {}
        current = current[part]
    current[parts[-1]] = value


def main():
    project_root = Path(__file__).parent.parent
    vi_json = project_root / "src" / "i18n" / "locales" / "vi.json"

    print("Loading vi.json...")
    with open(vi_json, "r", encoding="utf-8") as f:
        vi_data = json.load(f)

    automation_section = vi_data.get("automation", {})

    # Count placeholders that need translation
    placeholders_found = 0
    translations_added = 0

    # Check for TODO placeholders and replace them
    def replace_placeholders(obj: Any, path: str = "") -> Any:
        nonlocal placeholders_found, translations_added

        if isinstance(obj, dict):
            return {k: replace_placeholders(v, f"{path}.{k}" if path else k) for k, v in obj.items()}
        elif isinstance(obj, str):
            if obj.startswith("[TODO:"):
                placeholders_found += 1
                # Try to find Vietnamese translation
                full_key = f"automation.{path}"
                if full_key in VI_TRANSLATIONS:
                    translations_added += 1
                    return VI_TRANSLATIONS[full_key]
                else:
                    # Keep the TODO marker but indicate it's untranslated
                    return obj
            return obj
        else:
            return obj

    print("Replacing placeholders with Vietnamese translations...")
    updated_automation = replace_placeholders(automation_section)
    vi_data["automation"] = updated_automation

    # Write back
    with open(vi_json, "w", encoding="utf-8") as f:
        json.dump(vi_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print()
    print("=" * 60)
    print("Vietnamese Translation Summary")
    print("=" * 60)
    print(f"  Placeholders found: {placeholders_found}")
    print(f"  Translations added: {translations_added}")
    print(f"  Still need manual translation: {placeholders_found - translations_added}")
    print()

    if placeholders_found > translations_added:
        print("⚠️  Some keys still have [TODO:] placeholders.")
        print("   Run this script again after adding more translations to VI_TRANSLATIONS dict.")


if __name__ == "__main__":
    main()
