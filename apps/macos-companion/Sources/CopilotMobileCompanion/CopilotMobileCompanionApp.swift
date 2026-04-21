import SwiftUI

@main
struct CopilotMobileCompanionApp: App {
    @StateObject private var model: BridgeControlModel

    init() {
        _model = StateObject(wrappedValue: Self.makeModel())
    }

    var body: some Scene {
        WindowGroup {
            CompanionWindowView(model: model)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .windowStyle(.titleBar)
        .windowResizability(.contentSize)
    }

    private static func makeModel() -> BridgeControlModel {
        do {
            return try BridgeControlModel()
        } catch {
            fatalError("Failed to initialize companion model: \(error)")
        }
    }
}
