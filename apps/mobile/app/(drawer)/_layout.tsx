// Çekmece layout — hamburger menü sohbet geçmişi kenar çubuğu

import { Drawer } from "expo-router/drawer";
import React from "react";
import DrawerContent from "../../src/components/DrawerContent";
import { colors } from "../../src/theme/colors";

export default function DrawerLayout() {
    return (
        <Drawer
            drawerContent={(props) => <DrawerContent {...props} />}
            screenOptions={{
                headerShown: false,
                drawerStyle: {
                    backgroundColor: colors.bgSecondary,
                    width: 300,
                },
                drawerType: "front",
                swipeEdgeWidth: 50,
                overlayColor: "rgba(0, 0, 0, 0.6)",
            }}
        >
            <Drawer.Screen
                name="index"
                options={{ title: "Chat" }}
            />
        </Drawer>
    );
}
