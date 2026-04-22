// Çekmece layout — hamburger menü sohbet geçmişi kenar çubuğu

import React from "react";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { withLayoutContext } from "expo-router";
import DrawerContent from "../../src/components/DrawerContent";
import { useAppTheme } from "../../src/theme/theme-context";

const { Navigator } = createDrawerNavigator();
const Drawer = withLayoutContext(Navigator);

export default function DrawerLayout() {
    const theme = useAppTheme();

    return (
        <Drawer
            drawerContent={(props) => <DrawerContent {...props} />}
            screenOptions={{
                headerShown: false,
                drawerStyle: {
                    backgroundColor: theme.colors.bgSecondary,
                    width: 300,
                },
                drawerType: "front",
                swipeEdgeWidth: 50,
                overlayColor: theme.colors.overlay,
            }}
        >
            <Drawer.Screen
                name="index"
                options={{ title: "Chat" }}
            />
        </Drawer>
    );
}
