// Test-only native picker driver. Exact private process/window and native rows.
// No keyboard/mouse injection, clipboard, Finder, arbitrary grant or other window.
import Foundation
import AppKit
import ApplicationServices

func fail(_ message: String) -> Never { fputs("Private data picker: \(message)\n", stderr); exit(2) }
guard CommandLine.arguments.count == 7 else { fail("expected title, pid, executable root, fixture root, mode, relative directory") }
let title = CommandLine.arguments[1]
guard let pid = Int32(CommandLine.arguments[2]), pid > 1 else { fail("invalid private PID") }
let executableRoot = URL(fileURLWithPath: CommandLine.arguments[3]).resolvingSymlinksInPath().path + "/"
let fixtureRoot = URL(fileURLWithPath: CommandLine.arguments[4]).resolvingSymlinksInPath().path
let mode = CommandLine.arguments[5]
guard ["choose", "cancel"].contains(mode), title.hasPrefix("TradeFlow Lite "), title.contains("Test ") else { fail("invalid test scope") }
guard AXIsProcessTrusted() else { fail("accessibility permission unavailable; not requesting or changing permissions") }
guard let process = NSRunningApplication(processIdentifier: pid),
      let executable = process.executableURL?.resolvingSymlinksInPath().path,
      executable.hasPrefix(executableRoot) else { fail("PID does not own this private test executable") }
let launched = process.launchDate
let application = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(application, 2)
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func text(_ element: AXUIElement, _ name: String) -> String { attribute(element, name) as? String ?? "" }
func children(_ element: AXUIElement) -> [AXUIElement] { attribute(element, "AXChildren") as? [AXUIElement] ?? [] }
func nativeTree(_ element: AXUIElement) -> [AXUIElement] {
    var queue = [(element, 0)], output = [AXUIElement]()
    while !queue.isEmpty && output.count < 2400 {
        let (node, depth) = queue.removeFirst()
        if text(node, "AXRole") == "AXWebArea" { continue }
        output.append(node)
        if depth < 18 { queue.append(contentsOf: children(node).map { ($0, depth + 1) }) }
    }
    return output
}
func privateWindow() -> AXUIElement {
    guard let current = NSRunningApplication(processIdentifier: pid), !current.isTerminated,
          current.launchDate == launched, current.executableURL?.resolvingSymlinksInPath().path == executable else { fail("private process identity changed") }
    let windows = attribute(application, "AXWindows") as? [AXUIElement] ?? []
    let matches = windows.filter { text($0, "AXTitle") == title }
    guard matches.count == 1 else { fail("exact private main window not found") }
    return matches[0]
}
func sheet() -> AXUIElement? { nativeTree(privateWindow()).first { text($0, "AXRole") == "AXSheet" } }
func wait(_ label: String, _ condition: () -> AXUIElement?) -> AXUIElement {
    let end = Date().addingTimeInterval(12)
    repeat { if let result = condition() { return result }; Thread.sleep(forTimeInterval: 0.05) } while Date() < end
    fail("timeout waiting for \(label)")
}
let panel = wait("the native directory picker") { sheet() }
if mode == "cancel" {
    let labels = Set(["Cancel", "取消", "キャンセル", "취소", "Abbrechen"])
    let buttons = nativeTree(panel).filter { text($0, "AXRole") == "AXButton" && labels.contains(text($0, "AXTitle")) }
    guard buttons.count == 1, (attribute(buttons[0], "AXEnabled") as? Bool) == true,
          AXUIElementPerformAction(buttons[0], "AXPress" as CFString) == .success else { fail("exact native Cancel button unavailable") }
    print("cancelled_private_picker")
    exit(0)
}
let relative = CommandLine.arguments[6]
guard !relative.isEmpty, !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { fail("invalid fixture directory") }
let directory = URL(fileURLWithPath: fixtureRoot).appendingPathComponent(relative).resolvingSymlinksInPath().path
var isDirectory: ObjCBool = false
guard directory.hasPrefix(fixtureRoot + "/"), FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory), isDirectory.boolValue else { fail("selection must stay inside the test-owned fixture directory") }
func setBoolean(_ element: AXUIElement, _ name: String, _ value: Bool) -> Bool {
    var writable = DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(element, name as CFString, &writable) == .success, writable.boolValue else { return false }
    return AXUIElementSetAttributeValue(element, name as CFString, value ? kCFBooleanTrue : kCFBooleanFalse) == .success
}
func fixtureAncestor(_ row: AXUIElement) -> String? {
    // AppKit may expose a CFURL rather than a String. Never authorize by just
    // a display name: compare the native row URL with this exact fixture path.
    for element in [row] + children(row) + children(row).flatMap({ children($0) }) {
        for name in ["AXURL", "AXFilename"] {
            let value = attribute(element, name)
            var url = value as? URL
            if url == nil, let raw = value as? String {
                if raw.hasPrefix("file:") { url = URL(string: raw) }
                else if raw.hasPrefix("/") { url = URL(fileURLWithPath: raw) }
            }
            if let url = url, url.isFileURL {
                let candidate = url.standardizedFileURL.path
                if candidate == directory || directory.hasPrefix(candidate + "/") { return candidate }
            }
        }
    }
    return nil
}
var expanded = Set<String>(), selected: AXUIElement?
for _ in 0..<24 {
    guard let current = sheet(), CFEqual(current, panel) else { fail("private native picker identity changed") }
    guard let outline = nativeTree(current).first(where: { text($0, "AXRole") == "AXOutline" && text($0, "AXIdentifier") == "ListView" }) else { fail("native file list view unavailable") }
    let rows = nativeTree(outline).filter { text($0, "AXRole") == "AXRow" }
    let candidates = rows.compactMap { row -> (AXUIElement, String)? in
        guard let path = fixtureAncestor(row), !expanded.contains(path) else { return nil }
        return (row, path)
    }.sorted { $0.1.count > $1.1.count }
    guard let (row, path) = candidates.first else {
        if let first = rows.first { var names: CFArray?; AXUIElementCopyAttributeNames(first, &names); fputs("Private native row attributes: \(names as? [String] ?? [])\n", stderr) }
        fail("no exact native URL ancestor of the fixture is visible; nothing selected")
    }
    if path == directory {
        guard setBoolean(row, "AXSelected", true), (attribute(row, "AXSelected") as? Bool) == true else { fail("could not select the exact fixture row") }
        selected = row; break
    }
    guard setBoolean(row, "AXDisclosing", true) || setBoolean(row, "AXExpanded", true) else { fail("native fixture ancestor cannot be expanded") }
    expanded.insert(path); Thread.sleep(forTimeInterval: 0.15)
}
guard let selected = selected, fixtureAncestor(selected) == directory,
      (attribute(selected, "AXSelected") as? Bool) == true, let current = sheet(), CFEqual(current, panel) else { fail("exact fixture was not selected") }
var defaultButton: AXUIElement?
if let value = attribute(current, "AXDefaultButton"), CFGetTypeID(value) == AXUIElementGetTypeID() {
    defaultButton = unsafeBitCast(value, to: AXUIElement.self)
}
if defaultButton == nil {
    let labels = Set(["Open", "Choose", "Select", "打开", "選取", "选取", "选择", "選擇", "열기", "선택", "開く", "選択"])
    let buttons = nativeTree(current).filter { text($0, "AXRole") == "AXButton" && labels.contains(text($0, "AXTitle")) }
    if buttons.count == 1 { defaultButton = buttons[0] }
}
guard let button = defaultButton, (attribute(button, "AXEnabled") as? Bool) == true,
      AXUIElementPerformAction(button, "AXPress" as CFString) == .success else { fail("could not confirm the native directory selection") }
print("selected_private_fixture")
