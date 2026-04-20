// QR Kod tarama ekranı — bridge sunucusuna bağlanmak için QR okuma

import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { qrPayloadSchema } from "@copilot-mobile/shared";
import { connectWithQR } from "../src/services/bridge";
import { useConnectionStore } from "../src/stores/connection-store";
import { colors, borderRadius } from "../src/theme/colors";

export default function ScanScreen() {
    const router = useRouter();
    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);
    const [isPairing, setIsPairing] = useState(false);
    const hasShownErrorRef = useRef(false);
    const connectionState = useConnectionStore((s) => s.state);
    const connectionError = useConnectionStore((s) => s.error);

    useEffect(() => {
        if (connectionState === "authenticated") {
            router.replace("/");
        }
    }, [connectionState, router]);

    useEffect(() => {
        if (connectionError === null || hasShownErrorRef.current) {
            return;
        }

        hasShownErrorRef.current = true;
        setIsPairing(false);
        setScanned(false);

        Alert.alert("Connection Error", connectionError, [
            {
                text: "Retry",
                onPress: () => {
                    hasShownErrorRef.current = false;
                },
            },
        ]);
    }, [connectionError]);

    function handleBarCodeScanned(result: { data: string }): void {
        if (scanned) return;
        setScanned(true);

        try {
            const parsed: unknown = JSON.parse(result.data);
            const qrPayloadResult = qrPayloadSchema.safeParse(parsed);

            if (!qrPayloadResult.success) {
                Alert.alert("Invalid QR Code", "This QR code does not belong to a Copilot Mobile bridge.", [
                    { text: "Retry", onPress: () => setScanned(false) },
                ]);
                return;
            }

            hasShownErrorRef.current = false;
            setIsPairing(true);
            connectWithQR(qrPayloadResult.data);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Could not read QR code.";
            Alert.alert("QR Code Error", errorMessage, [
                {
                    text: "Retry",
                    onPress: () => {
                        setIsPairing(false);
                        setScanned(false);
                    },
                },
            ]);
            console.warn("QR scan error:", errorMessage);
        }
    }

    if (permission === null) {
        return (
            <View style={styles.container}>
                <Text style={styles.text}>Checking camera permission...</Text>
            </View>
        );
    }

    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={styles.text}>Camera permission required</Text>
                <Text style={styles.subtext}>
                    Camera access is needed to scan QR codes.
                </Text>
                <Pressable style={styles.button} onPress={requestPermission}>
                    <Text style={styles.buttonText}>Grant Permission</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                    barcodeTypes: ["qr"],
                }}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />

            <View style={styles.overlay}>
                <View style={styles.scanFrame} />
                <Text style={styles.instructions}>
                    {isPairing
                        ? "Connecting to bridge server..."
                        : "Scan the QR code on your bridge server"}
                </Text>
            </View>

            {scanned && !isPairing && (
                <View style={styles.rescanContainer}>
                    <Pressable
                        style={styles.button}
                        onPress={() => setScanned(false)}
                    >
                        <Text style={styles.buttonText}>Scan Again</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.bg,
        justifyContent: "center",
        alignItems: "center",
    },
    camera: {
        ...StyleSheet.absoluteFillObject,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: "center",
        alignItems: "center",
    },
    scanFrame: {
        width: 250,
        height: 250,
        borderWidth: 2,
        borderColor: colors.accent,
        borderRadius: borderRadius.xl,
        backgroundColor: "transparent",
    },
    instructions: {
        marginTop: 24,
        fontSize: 16,
        color: colors.textOnAccent,
        textAlign: "center",
        paddingHorizontal: 32,
    },
    text: {
        fontSize: 18,
        color: colors.textOnAccent,
        marginBottom: 8,
        textAlign: "center",
    },
    subtext: {
        fontSize: 14,
        color: colors.textPlaceholder,
        marginBottom: 24,
        textAlign: "center",
        paddingHorizontal: 32,
    },
    button: {
        backgroundColor: colors.accent,
        paddingVertical: 14,
        paddingHorizontal: 32,
        borderRadius: borderRadius.lg,
    },
    buttonText: {
        color: colors.textOnAccent,
        fontSize: 16,
        fontWeight: "600",
    },
    rescanContainer: {
        position: "absolute",
        bottom: 60,
    },
});
