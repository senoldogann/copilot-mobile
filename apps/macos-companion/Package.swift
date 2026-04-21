// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "CopilotMobileCompanion",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(
            name: "CopilotMobileCompanion",
            targets: ["CopilotMobileCompanion"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "CopilotMobileCompanion",
            path: "Sources/CopilotMobileCompanion"
        ),
    ]
)
