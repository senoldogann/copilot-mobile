import Foundation

struct BridgeStatusEnvelope: Decodable {
    let status: BridgeStatusSnapshot
}

struct BridgeStatusSnapshot: Decodable {
    let pid: Int
    let port: Int
    let publicUrl: String
    let companionId: String?
    let relay: RelayStatusSnapshot?
    let hasClient: Bool
    let pairingActive: Bool
    let qrExpiresAt: Int64?
}

struct RelayStatusSnapshot: Decodable {
    let connectedToRelay: Bool
    let connectedToLocalBridge: Bool
    let relayUrl: String
}

enum CompanionLaunchMode: String, CaseIterable, Identifiable {
    case relayLocal = "Relay"
    case directLan = "Direct"

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .relayLocal:
            return "Local Relay"
        case .directLan:
            return "Direct LAN"
        }
    }

    var subtitle: String {
        switch self {
        case .relayLocal:
            return "Starts the local relay stack and bridge together."
        case .directLan:
            return "Starts the bridge directly on the local network only."
        }
    }

    var commandDisplayName: String {
        switch self {
        case .relayLocal:
            return "pnpm dev:companion:local"
        case .directLan:
            return "pnpm dev:bridge:direct"
        }
    }

    var commandArguments: [String] {
        switch self {
        case .relayLocal:
            return ["pnpm", "dev:companion:local"]
        case .directLan:
            return ["pnpm", "dev:bridge:direct"]
        }
    }
}

enum BridgeControlError: LocalizedError {
    case repositoryRootNotFound(filePath: String)
    case invalidStatusResponse(url: String)
    case processAlreadyRunning(command: String)
    case dashboardOpenFailed(url: String)

    var errorDescription: String? {
        switch self {
        case .repositoryRootNotFound(let filePath):
            return "Could not resolve repository root from source path: \(filePath)"
        case .invalidStatusResponse(let url):
            return "Bridge status response was invalid for URL: \(url)"
        case .processAlreadyRunning(let command):
            return "A managed bridge process is already running for command: \(command)"
        case .dashboardOpenFailed(let url):
            return "Could not open dashboard URL in the browser: \(url)"
        }
    }
}
