import Constants from "expo-constants";
import { Alert, Linking, Platform } from "react-native";

const FEEDBACK_EMAIL = "contact@senoldogan.dev";

function buildFeedbackMailtoUrl(message: string, sessionId: string | null): string {
    const appName = Constants.expoConfig?.name ?? "Code Companion";
    const appVersion = Constants.expoConfig?.version ?? "unknown";
    const bodyLines = [
        message.trim().length > 0
            ? message.trim()
            : "Describe what happened, what you expected, and what went wrong.",
        "",
        "---",
        `App: ${appName}`,
        `Version: ${appVersion}`,
        `Platform: ${Platform.OS}`,
        `Session: ${sessionId ?? "none"}`,
    ];

    return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`${appName} feedback`)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}

export async function openFeedbackEmail(message: string, sessionId: string | null): Promise<boolean> {
    const url = buildFeedbackMailtoUrl(message, sessionId);
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
        Alert.alert(
            "Email app unavailable",
            `Please email ${FEEDBACK_EMAIL} manually with your feedback.`
        );
        return false;
    }

    try {
        await Linking.openURL(url);
        return true;
    } catch (error) {
        Alert.alert(
            "Could not open email",
            error instanceof Error ? error.message : `Please email ${FEEDBACK_EMAIL} manually.`
        );
        return false;
    }
}
