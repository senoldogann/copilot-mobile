import SwiftUI

struct CompanionWindowView: View {
    @ObservedObject var model: BridgeControlModel

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 18) {
                headerSection
                controlsSection
                statusSection
                logSection
            }
            .frame(minWidth: 340, idealWidth: 380, maxWidth: 440)
            .padding(24)

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Dashboard")
                        .font(.title2.weight(.semibold))
                    Spacer()
                    Button("Open in Browser") {
                        model.openDashboardInBrowser()
                    }
                    .buttonStyle(.bordered)
                }

                DashboardWebView(
                    dashboardURL: model.dashboardURLValue,
                    reloadToken: model.dashboardReloadToken
                )
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
            }
            .padding(24)
        }
        .background(
            LinearGradient(
                colors: [Color(red: 0.08, green: 0.10, blue: 0.09), Color(red: 0.10, green: 0.13, blue: 0.12)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .preferredColorScheme(.dark)
        .task {
            model.startPolling()
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Copilot Mobile Companion")
                .font(.system(size: 28, weight: .bold, design: .rounded))

            Text(model.statusSummary)
                .font(.headline)
                .foregroundStyle(.secondary)

            if let errorText = model.errorText {
                Text(errorText)
                    .font(.subheadline)
                    .foregroundStyle(.red)
            }
        }
    }

    private var controlsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Launch Mode")
                .font(.headline)

            Picker("Launch Mode", selection: $model.selectedMode) {
                ForEach(CompanionLaunchMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Text(model.selectedMode.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Button(model.isStarting ? "Starting…" : "Start") {
                    Task {
                        await model.start()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isStarting || model.isManagedProcessRunning)

                Button("Stop") {
                    model.stop()
                }
                .buttonStyle(.bordered)
                .disabled(!model.isManagedProcessRunning)

                Button(model.isRefreshing ? "Refreshing…" : "Refresh") {
                    Task {
                        await model.refreshStatus()
                    }
                }
                .buttonStyle(.bordered)
                .disabled(model.isRefreshing)
            }
        }
        .padding(18)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Bridge Status")
                .font(.headline)

            statusLine(title: "Public URL", value: model.status?.publicUrl ?? "Offline")
            statusLine(title: "Companion ID", value: model.status?.companionId ?? "—")
            statusLine(title: "Client Attached", value: boolLabel(value: model.status?.hasClient ?? false))
            statusLine(title: "Pairing Active", value: boolLabel(value: model.status?.pairingActive ?? false))
            statusLine(title: "Relay Link", value: relayLabel(status: model.status?.relay))
            statusLine(title: "PID", value: model.status.map { String($0.pid) } ?? "—")
        }
        .padding(18)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var logSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Managed Process Log")
                .font(.headline)

            ScrollView {
                Text(model.logOutput.isEmpty ? "No logs yet." : model.logOutput)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }
            .frame(minHeight: 220)
            .padding(12)
            .background(Color.black.opacity(0.22))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func statusLine(title: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer(minLength: 16)
            Text(value)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }

    private func boolLabel(value: Bool) -> String {
        value ? "Yes" : "No"
    }

    private func relayLabel(status: RelayStatusSnapshot?) -> String {
        guard let status else {
            return "Disabled"
        }

        if status.connectedToRelay && status.connectedToLocalBridge {
            return "Connected"
        }

        if status.connectedToRelay {
            return "Relay only"
        }

        return "Disconnected"
    }
}
