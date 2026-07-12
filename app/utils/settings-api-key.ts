export function resolveSubmittedGeminiApiKey(
  submittedValue: FormDataEntryValue | null,
  hasEncryptedApiKey: boolean,
  apiKeyEdited: boolean,
): string {
  const submittedApiKey = typeof submittedValue === "string" ? submittedValue.trim() : "";

  // Existing settings forms can be populated by a password manager without
  // user intent. Initial setup still accepts the field because it is required.
  return !hasEncryptedApiKey || apiKeyEdited ? submittedApiKey : "";
}
