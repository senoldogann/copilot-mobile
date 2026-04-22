const appJson = require("./app.json");

function readProjectId() {
    const envProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || process.env.EAS_PROJECT_ID;
    if (typeof envProjectId === "string" && envProjectId.trim().length > 0) {
        return envProjectId.trim();
    }

    const configuredProjectId = appJson.expo?.extra?.eas?.projectId;
    if (typeof configuredProjectId === "string" && configuredProjectId.trim().length > 0) {
        return configuredProjectId.trim();
    }

    return undefined;
}

module.exports = () => {
    const projectId = readProjectId();

    return {
        ...appJson.expo,
        extra: {
            ...(appJson.expo.extra ?? {}),
            eas: {
                ...(appJson.expo.extra?.eas ?? {}),
                ...(projectId !== undefined ? { projectId } : {}),
            },
        },
    };
};
