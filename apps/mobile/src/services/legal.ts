import { Linking } from "react-native";

export const POLICY_URL = "https://www.senoldogan.dev/app-policy/code-companion";

export async function openPolicyUrl(): Promise<void> {
    await Linking.openURL(POLICY_URL);
}
