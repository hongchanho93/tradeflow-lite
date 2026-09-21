// Read only the test window ID. Never capture the desktop or another App.
import Foundation
import CoreGraphics
let title = CommandLine.arguments[1]
let owner = Int(CommandLine.arguments[2])!
let rows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
// TCC can omit window titles. Restrict the fallback to the exact process owning
// this test's authenticated listener, never another TradeFlow instance.
let matches = rows.filter {
    let bounds = $0[kCGWindowBounds as String] as? [String: Any] ?? [:]
    return ($0[kCGWindowOwnerPID as String] as? Int) == owner
        && ($0[kCGWindowLayer as String] as? Int) == 0
        && (bounds["Width"] as? Double ?? 0) >= 900
        && (bounds["Height"] as? Double ?? 0) >= 600
}
guard matches.count == 1, let id = matches[0][kCGWindowNumber as String] as? NSNumber else {
    let own = rows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == owner }
    fputs("Private process \(owner): \(own.count) windows, \(matches.count) main-window matches; \(own.map { $0[kCGWindowBounds as String] ?? [:] })\n", stderr)
    exit(2)
}
print(id.uint32Value)
