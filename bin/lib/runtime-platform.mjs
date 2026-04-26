import process from "node:process";

export function getSupportedDesktopPlatform() {
    switch (process.platform) {
        case "darwin":
            return "macos";
        case "win32":
            return "windows";
        default:
            return null;
    }
}

export function requireSupportedDesktopPlatform() {
    const platform = getSupportedDesktopPlatform();
    if (platform === null) {
        throw new Error(
            `Code Companion desktop companion currently supports macOS and Windows only. Detected platform: ${process.platform}.`
        );
    }

    return platform;
}

export function getDesktopPlatformDescription(platform) {
    return platform === "macos" ? "macOS" : "Windows";
}

export function getDesktopServiceLabel(platform) {
    return platform === "macos" ? "LaunchAgent" : "Background daemon";
}
