import "react-native-gesture-handler/jestSetup";

jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
jest.mock("expo-font", () => ({
    loadAsync: jest.fn(() => Promise.resolve()),
    useFonts: () => [true, null],
}));
jest.mock("@expo-google-fonts/inter", () => ({
    Inter_400Regular: 1,
    Inter_400Regular_Italic: 2,
    Inter_500Medium: 3,
    Inter_500Medium_Italic: 4,
    Inter_600SemiBold: 5,
    Inter_600SemiBold_Italic: 6,
    Inter_700Bold: 7,
    Inter_700Bold_Italic: 8,
    Inter_800ExtraBold: 9,
    Inter_800ExtraBold_Italic: 10,
}));
jest.mock("@expo-google-fonts/poppins", () => ({
    Poppins_400Regular: 1,
    Poppins_400Regular_Italic: 2,
    Poppins_500Medium: 3,
    Poppins_500Medium_Italic: 4,
    Poppins_600SemiBold: 5,
    Poppins_600SemiBold_Italic: 6,
    Poppins_700Bold: 7,
    Poppins_700Bold_Italic: 8,
    Poppins_800ExtraBold: 9,
    Poppins_800ExtraBold_Italic: 10,
}));
jest.mock("@expo-google-fonts/manrope", () => ({
    Manrope_400Regular: 1,
    Manrope_500Medium: 2,
    Manrope_600SemiBold: 3,
    Manrope_700Bold: 4,
    Manrope_800ExtraBold: 5,
}));
jest.mock("@expo-google-fonts/roboto", () => ({
    Roboto_400Regular: 1,
    Roboto_400Regular_Italic: 2,
    Roboto_500Medium: 3,
    Roboto_500Medium_Italic: 4,
    Roboto_600SemiBold: 5,
    Roboto_600SemiBold_Italic: 6,
    Roboto_700Bold: 7,
    Roboto_700Bold_Italic: 8,
    Roboto_800ExtraBold: 9,
    Roboto_800ExtraBold_Italic: 10,
}));
