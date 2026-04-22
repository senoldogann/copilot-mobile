const jestExpoPreset = require("jest-expo/jest-preset");

module.exports = {
    ...jestExpoPreset,
    setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
    transformIgnorePatterns: [
        "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|react-native-svg|react-native-reanimated|react-native-gesture-handler|zustand))",
    ],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
};
