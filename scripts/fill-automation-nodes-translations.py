#!/usr/bin/env python3
"""
Fill proper English and Vietnamese translations for automation.nodes.* keys.
"""

import json
from pathlib import Path
from typing import Dict, Any


# English translations for automation.nodes.* keys
EN_TRANSLATIONS: Dict[str, str] = {
    # Navigator nodes
    "automation.nodes.openUrl.label": "Open URL",
    "automation.nodes.openUrl.description": "Navigate to a URL",
    "automation.nodes.openUrl.document": "Opens a URL in the current tab or a new tab.",
    "automation.nodes.newTab.label": "New Tab",
    "automation.nodes.newTab.description": "Open a new tab",
    "automation.nodes.newTab.document": "Opens a new browser tab with an optional URL.",
    "automation.nodes.switchTab.label": "Switch Tab",
    "automation.nodes.switchTab.description": "Switch to another tab",
    "automation.nodes.switchTab.document": "Switches focus to a different browser tab by index.",
    "automation.nodes.closeTab.label": "Close Tab",
    "automation.nodes.closeTab.description": "Close current tab",
    "automation.nodes.closeTab.document": "Closes the currently active browser tab.",
    "automation.nodes.goBack.label": "Go Back",
    "automation.nodes.goBack.description": "Navigate back in history",
    "automation.nodes.goBack.document": "Navigates to the previous page in browser history.",
    "automation.nodes.goForward.label": "Go Forward",
    "automation.nodes.goForward.description": "Navigate forward in history",
    "automation.nodes.goForward.document": "Navigates to the next page in browser history.",
    "automation.nodes.reloadPage.label": "Reload Page",
    "automation.nodes.reloadPage.description": "Reload the current page",
    "automation.nodes.reloadPage.document": "Reloads the current page, optionally bypassing cache.",
    "automation.nodes.getUrl.label": "Get URL",
    "automation.nodes.getUrl.description": "Get current page URL",
    "automation.nodes.getUrl.document": "Retrieves the URL of the current page and stores it in a variable.",
    "automation.nodes.switchFrame.label": "Switch Frame",
    "automation.nodes.switchFrame.description": "Switch to iframe",
    "automation.nodes.switchFrame.document": "Switches context to an iframe for subsequent operations.",

    # Interaction nodes
    "automation.nodes.click.label": "Click",
    "automation.nodes.click.description": "Click an element",
    "automation.nodes.click.document": "Clicks on an element matching the specified selector.",
    "automation.nodes.clickDown.label": "Mouse Down",
    "automation.nodes.clickDown.description": "Press mouse button",
    "automation.nodes.clickDown.document": "Presses and holds a mouse button at the specified position.",
    "automation.nodes.clickUp.label": "Mouse Up",
    "automation.nodes.clickUp.description": "Release mouse button",
    "automation.nodes.clickUp.document": "Releases a previously pressed mouse button.",
    "automation.nodes.type.label": "Type",
    "automation.nodes.type.description": "Type text",
    "automation.nodes.type.document": "Types text into the currently focused element.",
    "automation.nodes.typeText.label": "Type Text",
    "automation.nodes.typeText.description": "Type text into element",
    "automation.nodes.typeText.document": "Types text into an element matching the specified selector.",
    "automation.nodes.clearInput.label": "Clear Input",
    "automation.nodes.clearInput.description": "Clear input field",
    "automation.nodes.clearInput.document": "Clears the value of an input field.",
    "automation.nodes.sendTextToSelector.label": "Send Text to Selector",
    "automation.nodes.sendTextToSelector.description": "Send text to element",
    "automation.nodes.sendTextToSelector.document": "Sends text to an element matching the selector.",
    "automation.nodes.hover.label": "Hover",
    "automation.nodes.hover.description": "Hover over element",
    "automation.nodes.hover.document": "Moves the mouse cursor over an element without clicking.",
    "automation.nodes.dragAndDrop.label": "Drag & Drop",
    "automation.nodes.dragAndDrop.description": "Drag element to target",
    "automation.nodes.dragAndDrop.document": "Drags an element from source to target location.",
    "automation.nodes.scroll.label": "Scroll",
    "automation.nodes.scroll.description": "Scroll the page",
    "automation.nodes.scroll.document": "Scrolls the page to reveal more content.",
    "automation.nodes.wait.label": "Wait",
    "automation.nodes.wait.description": "Wait for condition",
    "automation.nodes.wait.document": "Waits for a specified condition before continuing.",
    "automation.nodes.delay.label": "Delay",
    "automation.nodes.delay.description": "Pause execution",
    "automation.nodes.delay.document": "Pauses script execution for a specified duration.",
    "automation.nodes.pressKey.label": "Press Key",
    "automation.nodes.pressKey.description": "Press keyboard key",
    "automation.nodes.pressKey.document": "Simulates pressing a keyboard key or key combination.",

    # Data nodes
    "automation.nodes.getText.label": "Get Text",
    "automation.nodes.getText.description": "Extract text from element",
    "automation.nodes.getText.document": "Retrieves text content from an element and stores it in a variable.",
    "automation.nodes.getValue.label": "Get Value",
    "automation.nodes.getValue.description": "Get input value",
    "automation.nodes.getValue.document": "Retrieves the value of an input field.",
    "automation.nodes.getAttributeValue.label": "Get Attribute",
    "automation.nodes.getAttributeValue.description": "Get element attribute",
    "automation.nodes.getAttributeValue.document": "Retrieves a specific attribute value from an element.",
    "automation.nodes.elementExists.label": "Element Exists",
    "automation.nodes.elementExists.description": "Check if element exists",
    "automation.nodes.elementExists.document": "Checks whether an element matching the selector exists.",
    "automation.nodes.getCookies.label": "Get Cookies",
    "automation.nodes.getCookies.description": "Retrieve cookies",
    "automation.nodes.getCookies.document": "Retrieves cookies for the current domain.",
    "automation.nodes.setCookies.label": "Set Cookies",
    "automation.nodes.setCookies.description": "Set cookies",
    "automation.nodes.setCookies.document": "Sets cookies for the current domain.",
    "automation.nodes.clearCookies.label": "Clear Cookies",
    "automation.nodes.clearCookies.description": "Clear all cookies",
    "automation.nodes.clearCookies.document": "Removes all cookies from the browser.",

    # Extraction nodes
    "automation.nodes.extractionInText.label": "Extract Text",
    "automation.nodes.extractionInText.description": "Extract using regex",
    "automation.nodes.extractionInText.document": "Extracts text matching a regular expression pattern.",
    "automation.nodes.imageSearch.label": "Image Search",
    "automation.nodes.imageSearch.description": "Find image on screen",
    "automation.nodes.imageSearch.document": "Searches for an image on the screen using template matching.",
    "automation.nodes.getUrl.params.saveToVar": "Save to variable",
    "automation.nodes.getText.params.saveToVar": "Save to variable",
    "automation.nodes.getValue.params.saveToVar": "Save to variable",
    "automation.nodes.getAttributeValue.params.saveToVar": "Save to variable",
    "automation.nodes.extractionInText.params.saveToVar": "Save to variable",
    "automation.nodes.imageSearch.params.saveToVar": "Save to variable",

    # Network nodes
    "automation.nodes.http.label": "HTTP Request",
    "automation.nodes.http.description": "Make HTTP request",
    "automation.nodes.http.document": "Performs an HTTP request and optionally stores the response.",
    "automation.nodes.downloadFile.label": "Download File",
    "automation.nodes.downloadFile.description": "Download a file",
    "automation.nodes.downloadFile.document": "Downloads a file from a URL to the local filesystem.",
    "automation.nodes.setUserAgent.label": "Set User Agent",
    "automation.nodes.setUserAgent.description": "Override user agent",
    "automation.nodes.setUserAgent.document": "Sets a custom User-Agent string for browser requests.",

    # Logic nodes
    "automation.nodes.ifCondition.label": "If Condition",
    "automation.nodes.ifCondition.description": "Conditional branching",
    "automation.nodes.ifCondition.document": "Executes different branches based on a condition.",
    "automation.nodes.while.label": "While Loop",
    "automation.nodes.while.description": "Repeat while condition true",
    "automation.nodes.while.document": "Repeatedly executes a block while a condition remains true.",
    "automation.nodes.loopFor.label": "For Loop",
    "automation.nodes.loopFor.description": "Repeat N times",
    "automation.nodes.loopFor.document": "Executes a block a specified number of times.",
    "automation.nodes.loopElements.label": "Loop Elements",
    "automation.nodes.loopElements.description": "Iterate over elements",
    "automation.nodes.loopElements.document": "Iterates over all elements matching a selector.",
    "automation.nodes.stopLoop.label": "Stop Loop",
    "automation.nodes.stopLoop.description": "Break out of loop",
    "automation.nodes.stopLoop.document": "Exits the current loop immediately.",

    # Utility nodes
    "automation.nodes.evalJs.label": "Evaluate JavaScript",
    "automation.nodes.evalJs.description": "Run custom JS code",
    "automation.nodes.evalJs.document": "Executes arbitrary JavaScript code in the page context.",
    "automation.nodes.addLog.label": "Add Log",
    "automation.nodes.addLog.description": "Write to log",
    "automation.nodes.addLog.document": "Writes a message to the automation log.",
    "automation.nodes.addComment.label": "Add Comment",
    "automation.nodes.addComment.description": "Add a comment",
    "automation.nodes.addComment.document": "Adds a non-executable comment to document the script.",
    "automation.nodes.log.label": "Log Message",
    "automation.nodes.log.description": "Log to console",
    "automation.nodes.log.document": "Logs a message to the browser console.",
    "automation.nodes.random.label": "Random Value",
    "automation.nodes.random.description": "Generate random data",
    "automation.nodes.random.document": "Generates random values of various types.",
    "automation.nodes.setVariable.label": "Set Variable",
    "automation.nodes.setVariable.description": "Store a value",
    "automation.nodes.setVariable.document": "Stores a value in a script variable.",
    "automation.nodes.convertingJson.label": "Convert JSON",
    "automation.nodes.convertingJson.description": "Parse or stringify JSON",
    "automation.nodes.convertingJson.document": "Converts between JSON strings and JavaScript objects.",
    "automation.nodes.readCsv.label": "Read CSV",
    "automation.nodes.readCsv.description": "Read CSV file",
    "automation.nodes.readCsv.document": "Reads and parses a CSV file.",
    "automation.nodes.writeCsv.label": "Write CSV",
    "automation.nodes.writeCsv.description": "Write CSV file",
    "automation.nodes.writeCsv.document": "Writes data to a CSV file.",
    "automation.nodes.screenshot.label": "Screenshot",
    "automation.nodes.screenshot.description": "Capture screenshot",
    "automation.nodes.screenshot.document": "Captures a screenshot of the current page or element.",
    "automation.nodes.runOtherScript.label": "Run Other Script",
    "automation.nodes.runOtherScript.description": "Execute another script",
    "automation.nodes.runOtherScript.document": "Runs another automation script from within this script.",

    # Extension nodes
    "automation.nodes.switchExtensionPopup.label": "Switch Extension Popup",
    "automation.nodes.switchExtensionPopup.description": "Open extension popup",
    "automation.nodes.switchExtensionPopup.document": "Switches context to an extension popup page.",

    # Control flow nodes
    "automation.nodes.delay.params.timeout": "Timeout (ms)",
    "automation.nodes.wait.params.timeout": "Timeout (ms)",
    "automation.nodes.elementExists.params.timeout": "Timeout (ms)",
    "automation.nodes.getText.params.timeout": "Timeout (ms)",
    "automation.nodes.getValue.params.timeout": "Timeout (ms)",
    "automation.nodes.getAttributeValue.params.timeout": "Timeout (ms)",
    "automation.nodes.http.params.timeout": "Timeout (ms)",
    "automation.nodes.imageSearch.params.threshold": "Threshold",
    "automation.nodes.random.params.length": "Length",
    "automation.nodes.random.params.min": "Minimum",
    "automation.nodes.random.params.max": "Maximum",
    "automation.nodes.random.params.quantity": "Quantity",
    "automation.nodes.random.params.domain": "Domain",
    "automation.nodes.extractionInText.params.regex": "Regex Pattern",
    "automation.nodes.extractionInText.params.flags": "Regex Flags",
    "automation.nodes.extractionInText.params.text": "Input Text",
    "automation.nodes.imageSearch.params.imagePath": "Image Path",
    "automation.nodes.http.params.url": "URL",
    "automation.nodes.http.params.method": "Method",
    "automation.nodes.http.params.headers": "Headers",
    "automation.nodes.http.params.body": "Request Body",
    "automation.nodes.runOtherScript.params.scriptName": "Script Name",
    "automation.nodes.runOtherScript.params.vars": "Variables",
    "automation.nodes.setUserAgent.params.userAgent": "User Agent",
    "automation.nodes.getAttributeValue.params.attribute": "Attribute Name",
    "automation.nodes.getAttributeValue.params.selector": "Selector",
    "automation.nodes.elementExists.params.selector": "Selector",
    "automation.nodes.elementExists.params.visibility": "Visibility",
    "automation.nodes.getText.params.selector": "Selector",
    "automation.nodes.getValue.params.selector": "Selector",
    "automation.nodes.sendTextToSelector.params.selector": "Selector",
    "automation.nodes.typeText.params.selector": "Selector",
    "automation.nodes.while.params.leftValue": "Left Value",
    "automation.nodes.while.params.operator": "Operator",
    "automation.nodes.while.params.rightValue": "Right Value",
    "automation.nodes.convertingJson.params.input": "Input",
    "automation.nodes.convertingJson.params.operation": "Operation",
    "automation.nodes.convertingJson.params.saveToVar": "Save to Variable",
    "automation.nodes.convertingJson.options.parse": "Parse",
    "automation.nodes.convertingJson.options.stringify": "Stringify",
    "automation.nodes.elementExists.options.any": "Any",
    "automation.nodes.elementExists.options.visible": "Visible",
    "automation.nodes.elementExists.options.hidden": "Hidden",
    "automation.nodes.random.options.number": "Number",
    "automation.nodes.random.options.email": "Email",
    "automation.nodes.random.options.firstName": "First Name",
    "automation.nodes.random.options.lastName": "Last Name",
    "automation.nodes.random.options.fullName": "Full Name",
    "automation.nodes.random.options.password": "Password",
    "automation.nodes.random.options.randomLetters": "Random Letters",
    "automation.nodes.addLog.params.message": "Message",
    "automation.nodes.addLog.params.level": "Level",
    "automation.nodes.addComment.params.comment": "Comment",
}


# Vietnamese translations
VI_TRANSLATIONS: Dict[str, str] = {
    # Navigator nodes
    "automation.nodes.openUrl.label": "Mở URL",
    "automation.nodes.openUrl.description": "Điều hướng đến URL",
    "automation.nodes.openUrl.document": "Mở URL trong tab hiện tại hoặc tab mới.",
    "automation.nodes.newTab.label": "Tab Mới",
    "automation.nodes.newTab.description": "Mở tab mới",
    "automation.nodes.newTab.document": "Mở tab trình duyệt mới với URL tùy chọn.",
    "automation.nodes.switchTab.label": "Chuyển Tab",
    "automation.nodes.switchTab.description": "Chuyển sang tab khác",
    "automation.nodes.switchTab.document": "Chuyển focus sang tab trình duyệt khác theo chỉ số.",
    "automation.nodes.closeTab.label": "Đóng Tab",
    "automation.nodes.closeTab.description": "Đóng tab hiện tại",
    "automation.nodes.closeTab.document": "Đóng tab trình duyệt đang hoạt động.",
    "automation.nodes.goBack.label": "Quay Lại",
    "automation.nodes.goBack.description": "Điều hướng lịch sử",
    "automation.nodes.goBack.document": "Điều hướng đến trang trước trong lịch sử trình duyệt.",
    "automation.nodes.goForward.label": "Tiến Tới",
    "automation.nodes.goForward.description": "Điều hướng lịch sử",
    "automation.nodes.goForward.document": "Điều hướng đến trang tiếp theo trong lịch sử trình duyệt.",
    "automation.nodes.reloadPage.label": "Tải Lại",
    "automation.nodes.reloadPage.description": "Tải lại trang",
    "automation.nodes.reloadPage.document": "Tải lại trang hiện tại, bỏ qua cache nếu cần.",
    "automation.nodes.getUrl.label": "Lấy URL",
    "automation.nodes.getUrl.description": "Lấy URL trang hiện tại",
    "automation.nodes.getUrl.document": "Lấy URL của trang hiện tại và lưu vào biến.",
    "automation.nodes.switchFrame.label": "Chuyển Frame",
    "automation.nodes.switchFrame.description": "Chuyển sang iframe",
    "automation.nodes.switchFrame.document": "Chuyển context sang iframe để thực hiện các thao tác tiếp theo.",

    # Interaction nodes
    "automation.nodes.click.label": "Click",
    "automation.nodes.click.description": "Click phần tử",
    "automation.nodes.click.document": "Click vào phần tử khớp với selector đã chỉ định.",
    "automation.nodes.clickDown.label": "Nhấn Chuột",
    "automation.nodes.clickDown.description": "Giữ nút chuột",
    "automation.nodes.clickDown.document": "Nhấn và giữ nút chuột tại vị trí đã chỉ định.",
    "automation.nodes.clickUp.label": "Thả Chuột",
    "automation.nodes.clickUp.description": "Thả nút chuột",
    "automation.nodes.clickUp.document": "Thả nút chuột đã nhấn trước đó.",
    "automation.nodes.type.label": "Gõ",
    "automation.nodes.type.description": "Gõ văn bản",
    "automation.nodes.type.document": "Gõ văn bản vào phần tử đang được focus.",
    "automation.nodes.typeText.label": "Gõ Văn Bản",
    "automation.nodes.typeText.description": "Gõ vào phần tử",
    "automation.nodes.typeText.document": "Gõ văn bản vào phần tử khớp với selector.",
    "automation.nodes.clearInput.label": "Xóa Input",
    "automation.nodes.clearInput.description": "Xóa trường nhập",
    "automation.nodes.clearInput.document": "Xóa giá trị của trường nhập liệu.",
    "automation.nodes.sendTextToSelector.label": "Gửi Văn Bản",
    "automation.nodes.sendTextToSelector.description": "Gửi văn bản đến phần tử",
    "automation.nodes.sendTextToSelector.document": "Gửi văn bản đến phần tử khớp với selector.",
    "automation.nodes.hover.label": "Di Chuột",
    "automation.nodes.hover.description": "Di chuột qua phần tử",
    "automation.nodes.hover.document": "Di chuyển con trỏ chuột qua phần tử mà không click.",
    "automation.nodes.dragAndDrop.label": "Kéo Thả",
    "automation.nodes.dragAndDrop.description": "Kéo phần tử đến đích",
    "automation.nodes.dragAndDrop.document": "Kéo phần tử từ nguồn đến vị trí đích.",
    "automation.nodes.scroll.label": "Cuộn",
    "automation.nodes.scroll.description": "Cuộn trang",
    "automation.nodes.scroll.document": "Cuộn trang để hiển thị thêm nội dung.",
    "automation.nodes.wait.label": "Đợi",
    "automation.nodes.wait.description": "Đợi điều kiện",
    "automation.nodes.wait.document": "Đợi một điều kiện cụ thể trước khi tiếp tục.",
    "automation.nodes.delay.label": "Tạm Dừng",
    "automation.nodes.delay.description": "Tạm dừng thực thi",
    "automation.nodes.delay.document": "Tạm dừng thực thi script trong khoảng thời gian nhất định.",
    "automation.nodes.pressKey.label": "Nhấn Phím",
    "automation.nodes.pressKey.description": "Nhấn phím",
    "automation.nodes.pressKey.document": "Mô phỏng nhấn phím hoặc tổ hợp phím.",

    # Data nodes
    "automation.nodes.getText.label": "Lấy Văn Bản",
    "automation.nodes.getText.description": "Trích xuất văn bản",
    "automation.nodes.getText.document": "Lấy nội dung văn bản từ phần tử và lưu vào biến.",
    "automation.nodes.getValue.label": "Lấy Giá Trị",
    "automation.nodes.getValue.description": "Lấy giá trị input",
    "automation.nodes.getValue.document": "Lấy giá trị của trường nhập liệu.",
    "automation.nodes.getAttributeValue.label": "Lấy Thuộc Tính",
    "automation.nodes.getAttributeValue.description": "Lấy thuộc tính phần tử",
    "automation.nodes.getAttributeValue.document": "Lấy giá trị thuộc tính cụ thể từ phần tử.",
    "automation.nodes.elementExists.label": "Kiểm Tra Phần Tử",
    "automation.nodes.elementExists.description": "Kiểm tra phần tử tồn tại",
    "automation.nodes.elementExists.document": "Kiểm tra xem phần tử khớp với selector có tồn tại không.",
    "automation.nodes.getCookies.label": "Lấy Cookies",
    "automation.nodes.getCookies.description": "Lấy cookies",
    "automation.nodes.getCookies.document": "Lấy cookies của domain hiện tại.",
    "automation.nodes.setCookies.label": "Đặt Cookies",
    "automation.nodes.setCookies.description": "Đặt cookies",
    "automation.nodes.setCookies.document": "Đặt cookies cho domain hiện tại.",
    "automation.nodes.clearCookies.label": "Xóa Cookies",
    "automation.nodes.clearCookies.description": "Xóa cookies",
    "automation.nodes.clearCookies.document": "Xóa tất cả cookies khỏi trình duyệt.",

    # Extraction nodes
    "automation.nodes.extractionInText.label": "Trích Xuất",
    "automation.nodes.extractionInText.description": "Trích xuất bằng regex",
    "automation.nodes.extractionInText.document": "Trích xuất văn bản khớp với mẫu biểu thức chính quy.",
    "automation.nodes.imageSearch.label": "Tìm Ảnh",
    "automation.nodes.imageSearch.description": "Tìm ảnh trên màn hình",
    "automation.nodes.imageSearch.document": "Tìm kiếm ảnh trên màn hình bằng template matching.",

    # Network nodes
    "automation.nodes.http.label": "Yêu Cầu HTTP",
    "automation.nodes.http.description": "Gửi request HTTP",
    "automation.nodes.http.document": "Thực hiện request HTTP và lưu response nếu cần.",
    "automation.nodes.downloadFile.label": "Tải File",
    "automation.nodes.downloadFile.description": "Tải file",
    "automation.nodes.downloadFile.document": "Tải file từ URL về hệ thống.",
    "automation.nodes.setUserAgent.label": "Đặt User Agent",
    "automation.nodes.setUserAgent.description": "Ghi đè user agent",
    "automation.nodes.setUserAgent.document": "Đặt chuỗi User-Agent tùy chỉnh cho các request.",

    # Logic nodes
    "automation.nodes.ifCondition.label": "Điều Kiện If",
    "automation.nodes.ifCondition.description": "Rẽ nhánh có điều kiện",
    "automation.nodes.ifCondition.document": "Thực thi các nhánh khác nhau dựa trên điều kiện.",
    "automation.nodes.while.label": "Vòng Lặp While",
    "automation.nodes.while.description": "Lặp khi điều kiện đúng",
    "automation.nodes.while.document": "Thực thi khối lệnh lặp lại khi điều kiện còn đúng.",
    "automation.nodes.loopFor.label": "Vòng Lặp For",
    "automation.nodes.loopFor.description": "Lặp N lần",
    "automation.nodes.loopFor.document": "Thực thi khối lệnh một số lần nhất định.",
    "automation.nodes.loopElements.label": "Lặp Phần Tử",
    "automation.nodes.loopElements.description": "Duyệt qua phần tử",
    "automation.nodes.loopElements.document": "Duyệt qua tất cả phần tử khớp với selector.",
    "automation.nodes.stopLoop.label": "Dừng Vòng Lặp",
    "automation.nodes.stopLoop.description": "Thoát vòng lặp",
    "automation.nodes.stopLoop.document": "Thoát khỏi vòng lặp hiện tại ngay lập tức.",

    # Utility nodes
    "automation.nodes.evalJs.label": "Chạy JavaScript",
    "automation.nodes.evalJs.description": "Chạy code JS",
    "automation.nodes.evalJs.document": "Thực thi code JavaScript tùy ý trong context trang.",
    "automation.nodes.addLog.label": "Ghi Log",
    "automation.nodes.addLog.description": "Ghi vào log",
    "automation.nodes.addLog.document": "Ghi một thông điệp vào log automation.",
    "automation.nodes.addComment.label": "Thêm Chú Thích",
    "automation.nodes.addComment.description": "Thêm chú thích",
    "automation.nodes.addComment.document": "Thêm chú thích không thực thi để ghi chú script.",
    "automation.nodes.log.label": "Log Console",
    "automation.nodes.log.description": "Ghi console",
    "automation.nodes.log.document": "Ghi thông điệp vào console trình duyệt.",
    "automation.nodes.random.label": "Giá Trị Ngẫu Nhiên",
    "automation.nodes.random.description": "Tạo dữ liệu ngẫu nhiên",
    "automation.nodes.random.document": "Tạo giá trị ngẫu nhiên các loại khác nhau.",
    "automation.nodes.setVariable.label": "Đặt Biến",
    "automation.nodes.setVariable.description": "Lưu giá trị",
    "automation.nodes.setVariable.document": "Lưu giá trị vào biến script.",
    "automation.nodes.convertingJson.label": "Chuyển Đổi JSON",
    "automation.nodes.convertingJson.description": "Parse hoặc stringify JSON",
    "automation.nodes.convertingJson.document": "Chuyển đổi giữa chuỗi JSON và đối tượng JavaScript.",
    "automation.nodes.readCsv.label": "Đọc CSV",
    "automation.nodes.readCsv.description": "Đọc file CSV",
    "automation.nodes.readCsv.document": "Đọc và parse file CSV.",
    "automation.nodes.writeCsv.label": "Ghi CSV",
    "automation.nodes.writeCsv.description": "Ghi file CSV",
    "automation.nodes.writeCsv.document": "Ghi dữ liệu ra file CSV.",
    "automation.nodes.screenshot.label": "Chụp Màn Hình",
    "automation.nodes.screenshot.description": "Chụp ảnh màn hình",
    "automation.nodes.screenshot.document": "Chụp ảnh màn hình trang hiện tại hoặc phần tử.",
    "automation.nodes.runOtherScript.label": "Chạy Script Khác",
    "automation.nodes.runOtherScript.description": "Thực thi script khác",
    "automation.nodes.runOtherScript.document": "Chạy script automation khác từ trong script này.",

    # Extension nodes
    "automation.nodes.switchExtensionPopup.label": "Chuyển Popup Extension",
    "automation.nodes.switchExtensionPopup.description": "Mở popup extension",
    "automation.nodes.switchExtensionPopup.document": "Chuyển context sang trang popup của extension.",

    # Param labels
    "automation.nodes.delay.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.wait.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.elementExists.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.getText.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.getValue.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.getAttributeValue.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.http.params.timeout": "Thời gian chờ (ms)",
    "automation.nodes.imageSearch.params.threshold": "Ngưỡng",
    "automation.nodes.random.params.length": "Độ dài",
    "automation.nodes.random.params.min": "Tối thiểu",
    "automation.nodes.random.params.max": "Tối đa",
    "automation.nodes.random.params.quantity": "Số lượng",
    "automation.nodes.random.params.domain": "Domain",
    "automation.nodes.extractionInText.params.regex": "Mẫu Regex",
    "automation.nodes.extractionInText.params.flags": "Cờ Regex",
    "automation.nodes.extractionInText.params.text": "Văn bản đầu vào",
    "automation.nodes.imageSearch.params.imagePath": "Đường dẫn ảnh",
    "automation.nodes.http.params.url": "URL",
    "automation.nodes.http.params.method": "Phương thức",
    "automation.nodes.http.params.headers": "Headers",
    "automation.nodes.http.params.body": "Nội dung request",
    "automation.nodes.runOtherScript.params.scriptName": "Tên script",
    "automation.nodes.runOtherScript.params.vars": "Biến",
    "automation.nodes.setUserAgent.params.userAgent": "User Agent",
    "automation.nodes.getAttributeValue.params.attribute": "Tên thuộc tính",
    "automation.nodes.getAttributeValue.params.selector": "Selector",
    "automation.nodes.elementExists.params.selector": "Selector",
    "automation.nodes.elementExists.params.visibility": "Hiển thị",
    "automation.nodes.getText.params.selector": "Selector",
    "automation.nodes.getValue.params.selector": "Selector",
    "automation.nodes.sendTextToSelector.params.selector": "Selector",
    "automation.nodes.typeText.params.selector": "Selector",
    "automation.nodes.while.params.leftValue": "Giá trị trái",
    "automation.nodes.while.params.operator": "Toán tử",
    "automation.nodes.while.params.rightValue": "Giá trị phải",
    "automation.nodes.convertingJson.params.input": "Đầu vào",
    "automation.nodes.convertingJson.params.operation": "Thao tác",
    "automation.nodes.convertingJson.params.saveToVar": "Lưu vào biến",
    "automation.nodes.convertingJson.options.parse": "Parse",
    "automation.nodes.convertingJson.options.stringify": "Stringify",
    "automation.nodes.elementExists.options.any": "Bất kỳ",
    "automation.nodes.elementExists.options.visible": "Hiển thị",
    "automation.nodes.elementExists.options.hidden": "Ẩn",
    "automation.nodes.random.options.number": "Số",
    "automation.nodes.random.options.email": "Email",
    "automation.nodes.random.options.firstName": "Tên",
    "automation.nodes.random.options.lastName": "Họ",
    "automation.nodes.random.options.fullName": "Họ và tên",
    "automation.nodes.random.options.password": "Mật khẩu",
    "automation.nodes.random.options.randomLetters": "Chữ ngẫu nhiên",
    "automation.nodes.addLog.params.message": "Thông điệp",
    "automation.nodes.addLog.params.level": "Cấp độ",
    "automation.nodes.addComment.params.comment": "Chú thích",
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


def replace_placeholders(obj: Any, translations: Dict[str, str], path: str = "") -> Any:
    """Recursively replace [TODO: ...] placeholders with translations."""
    if isinstance(obj, dict):
        return {k: replace_placeholders(v, translations, f"{path}.{k}" if path else k) for k, v in obj.items()}
    elif isinstance(obj, str):
        if obj.startswith("[TODO:"):
            full_key = f"automation.{path}"
            if full_key in translations:
                return translations[full_key]
            else:
                return obj
        return obj
    else:
        return obj


def main():
    project_root = Path(__file__).parent.parent
    en_json_path = project_root / "src" / "i18n" / "locales" / "en.json"
    vi_json_path = project_root / "src" / "i18n" / "locales" / "vi.json"

    print("Loading locale files...")
    with open(en_json_path, "r", encoding="utf-8") as f:
        en_data = json.load(f)

    with open(vi_json_path, "r", encoding="utf-8") as f:
        vi_data = json.load(f)

    print("Replacing English placeholders...")
    en_automation = replace_placeholders(en_data.get("automation", {}), EN_TRANSLATIONS)
    en_data["automation"] = en_automation

    print("Replacing Vietnamese placeholders...")
    vi_automation = replace_placeholders(vi_data.get("automation", {}), VI_TRANSLATIONS)
    vi_data["automation"] = vi_automation

    # Write back
    with open(en_json_path, "w", encoding="utf-8") as f:
        json.dump(en_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    with open(vi_json_path, "w", encoding="utf-8") as f:
        json.dump(vi_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print()
    print("=" * 60)
    print("Translation Summary")
    print("=" * 60)

    # Count translated keys
    en_translated = sum(1 for k, v in EN_TRANSLATIONS.items() if k.startswith("automation.nodes"))
    vi_translated = sum(1 for k, v in VI_TRANSLATIONS.items() if k.startswith("automation.nodes"))

    print(f"  English translations added: {en_translated}")
    print(f"  Vietnamese translations added: {vi_translated}")
    print()
    print("✓ All automation.nodes.* keys now have proper translations!")


if __name__ == "__main__":
    main()
