const SILENT_RESUME_FATAL_ERRORS = [
    "[AUTH_ERROR] Invalid device credential",
    "Certificate verification failed",
] as const;

export function shouldClearStoredCredentialsAfterSilentDirectResumeFailure(
    error: string | null
): boolean {
    if (error === null) {
        return false;
    }

    return SILENT_RESUME_FATAL_ERRORS.some((fatalError) => error.includes(fatalError));
}
