import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react-native";

import { ThemeProvider } from "../theme/theme-context";

type WrapperProps = {
    children: React.ReactNode;
};

function TestProviders({ children }: WrapperProps) {
    return (
        <ThemeProvider>
            {children}
        </ThemeProvider>
    );
}

export function renderWithProviders(
    ui: React.ReactElement,
    options?: Omit<RenderOptions, "wrapper">
): RenderResult {
    return render(ui, {
        wrapper: TestProviders,
        ...options,
    });
}
