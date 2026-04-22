import React from "react";
import { Text } from "react-native";

import { renderWithProviders } from "../../test/test-utils";

describe("ThemeProvider", () => {
    it("renders children inside the shared mobile providers", () => {
        const screen = renderWithProviders(<Text>theme smoke test</Text>);

        expect(screen.getByText("theme smoke test")).toBeTruthy();
    });
});
