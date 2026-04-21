import AppKit
import Combine
import Foundation

@MainActor
final class BridgeControlModel: ObservableObject {
    @Published var selectedMode: CompanionLaunchMode
    @Published var status: BridgeStatusSnapshot?
    @Published var isRefreshing: Bool
    @Published var isStarting: Bool
    @Published var errorText: String?
    @Published var logOutput: String
    @Published var dashboardReloadToken: UUID

    private let session: URLSession
    private let dashboardURL: URL
    private let statusURL: URL
    private let repositoryRoot: URL
    private var managedProcess: Process?
    private var pollTask: Task<Void, Never>?
    private var outputHandle: FileHandle?
    private var errorHandle: FileHandle?

    init() throws {
        let resolvedRepositoryRoot = try Self.resolveRepositoryRoot(filePath: #filePath)
        let resolvedDashboardURL = URL(string: "http://127.0.0.1:9876/__copilot_mobile/dashboard")
        let resolvedStatusURL = URL(string: "http://127.0.0.1:9876/__copilot_mobile/status")

        guard let dashboardURL = resolvedDashboardURL else {
            throw BridgeControlError.invalidStatusResponse(url: "http://127.0.0.1:9876/__copilot_mobile/dashboard")
        }

        guard let statusURL = resolvedStatusURL else {
            throw BridgeControlError.invalidStatusResponse(url: "http://127.0.0.1:9876/__copilot_mobile/status")
        }

        self.selectedMode = .relayLocal
        self.status = nil
        self.isRefreshing = false
        self.isStarting = false
        self.errorText = nil
        self.logOutput = ""
        self.dashboardReloadToken = UUID()
        self.session = URLSession(configuration: .default)
        self.dashboardURL = dashboardURL
        self.statusURL = statusURL
        self.repositoryRoot = resolvedRepositoryRoot
    }

    deinit {
        pollTask?.cancel()
    }

    var isManagedProcessRunning: Bool {
        managedProcess?.isRunning == true
    }

    var statusSummary: String {
        guard let status else {
            return "Bridge offline"
        }

        if status.hasClient {
            return "Mobile connected"
        }

        if status.pairingActive {
            return "Waiting for pairing"
        }

        return "Bridge online"
    }

    var dashboardAddress: String {
        dashboardURL.absoluteString
    }

    var dashboardURLValue: URL {
        dashboardURL
    }

    func start() async {
        isStarting = true
        errorText = nil

        do {
            try startManagedProcess(mode: selectedMode)
            appendLog(text: "Started \(selectedMode.commandDisplayName)\n")
            try await Task.sleep(for: .seconds(1))
            await refreshStatus()
        } catch {
            errorText = Self.describe(error: error)
            appendLog(text: "Start failed: \(Self.describe(error: error))\n")
        }

        isStarting = false
    }

    func stop() {
        errorText = nil

        guard let process = managedProcess else {
            appendLog(text: "No managed process to stop.\n")
            return
        }

        stopManagedProcess(process: process)
        appendLog(text: "Requested bridge shutdown.\n")
        dashboardReloadToken = UUID()
    }

    func refreshStatus() async {
        isRefreshing = true
        defer {
            isRefreshing = false
        }

        do {
            let nextStatus = try await fetchStatus()
            status = nextStatus
            dashboardReloadToken = UUID()
        } catch {
            status = nil
            errorText = offlineErrorText(error: error)
        }
    }

    func openDashboardInBrowser() {
        let opened = NSWorkspace.shared.open(dashboardURL)
        if !opened {
            errorText = Self.describe(error: BridgeControlError.dashboardOpenFailed(url: dashboardURL.absoluteString))
        }
    }

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            guard let self else {
                return
            }

            while !Task.isCancelled {
                await self.refreshStatus()

                do {
                    try await Task.sleep(for: .seconds(2))
                } catch {
                    return
                }
            }
        }
    }

    private func fetchStatus() async throws -> BridgeStatusSnapshot {
        let (data, response) = try await session.data(from: statusURL)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw BridgeControlError.invalidStatusResponse(url: statusURL.absoluteString)
        }

        guard httpResponse.statusCode == 200 else {
            let responseBody = String(decoding: data, as: UTF8.self)
            throw NSError(
                domain: "CopilotMobileCompanion",
                code: httpResponse.statusCode,
                userInfo: [
                    NSLocalizedDescriptionKey: "Status request failed",
                    "url": statusURL.absoluteString,
                    "statusCode": httpResponse.statusCode,
                    "responseBody": responseBody,
                ]
            )
        }

        let envelope = try JSONDecoder().decode(BridgeStatusEnvelope.self, from: data)
        return envelope.status
    }

    private func startManagedProcess(mode: CompanionLaunchMode) throws {
        if let managedProcess, managedProcess.isRunning {
            throw BridgeControlError.processAlreadyRunning(command: mode.commandDisplayName)
        }

        let process = Process()
        process.executableURL = URL(filePath: "/usr/bin/env")
        process.arguments = mode.commandArguments
        process.currentDirectoryURL = repositoryRoot

        let outputPipe = Pipe()
        let errorPipe = Pipe()

        process.standardOutput = outputPipe
        process.standardError = errorPipe

        observeOutput(handle: outputPipe.fileHandleForReading, source: "stdout")
        observeOutput(handle: errorPipe.fileHandleForReading, source: "stderr")

        process.terminationHandler = { [weak self] terminatedProcess in
            Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                self.outputHandle?.readabilityHandler = nil
                self.errorHandle?.readabilityHandler = nil
                self.outputHandle = nil
                self.errorHandle = nil
                self.managedProcess = nil
                self.appendLog(text: "Process exited with code \(terminatedProcess.terminationStatus).\n")
                await self.refreshStatus()
            }
        }

        try process.run()

        managedProcess = process
        outputHandle = outputPipe.fileHandleForReading
        errorHandle = errorPipe.fileHandleForReading
    }

    private func stopManagedProcess(process: Process) {
        outputHandle?.readabilityHandler = nil
        errorHandle?.readabilityHandler = nil
        outputHandle = nil
        errorHandle = nil
        process.terminate()
        managedProcess = nil
    }

    private func observeOutput(handle: FileHandle, source: String) {
        handle.readabilityHandler = { [weak self] fileHandle in
            let data = fileHandle.availableData
            if data.isEmpty {
                return
            }

            let chunk = String(decoding: data, as: UTF8.self)
            Task { @MainActor [weak self] in
                self?.appendLog(text: "[\(source)] \(chunk)")
            }
        }
    }

    private func appendLog(text: String) {
        let nextLog = logOutput + text
        let limitedLog = Self.limitLogSize(text: nextLog, maximumCharacters: 12_000)
        logOutput = limitedLog
    }

    private static func limitLogSize(text: String, maximumCharacters: Int) -> String {
        if text.count <= maximumCharacters {
            return text
        }

        let startIndex = text.index(text.endIndex, offsetBy: -maximumCharacters)
        return String(text[startIndex...])
    }

    private static func resolveRepositoryRoot(filePath: String) throws -> URL {
        let fileURL = URL(filePath: filePath)
        let sourceDirectory = fileURL.deletingLastPathComponent()
        let repositoryRoot = deleteLastPathComponents(url: sourceDirectory, count: 4)

        let packageManifestURL = repositoryRoot.appendingPathComponent("package.json")
        if !FileManager.default.fileExists(atPath: packageManifestURL.path()) {
            throw BridgeControlError.repositoryRootNotFound(filePath: filePath)
        }

        return repositoryRoot
    }

    private static func deleteLastPathComponents(url: URL, count: Int) -> URL {
        var currentURL = url

        for _ in 0..<count {
            currentURL.deleteLastPathComponent()
        }

        return currentURL
    }

    private static func describe(error: Error) -> String {
        if let localizedError = error as? LocalizedError, let description = localizedError.errorDescription {
            return description
        }

        return String(describing: error)
    }

    private func offlineErrorText(error: Error) -> String? {
        if let urlError = error as? URLError {
            let offlineCodes: Set<URLError.Code> = [
                .cannotConnectToHost,
                .notConnectedToInternet,
                .networkConnectionLost,
                .timedOut,
            ]

            if offlineCodes.contains(urlError.code) && !isManagedProcessRunning {
                return nil
            }
        }

        return Self.describe(error: error)
    }
}
