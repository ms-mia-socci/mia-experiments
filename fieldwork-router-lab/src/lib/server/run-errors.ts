export type PublicRunError = {
  code: string;
  message: string;
};

export function publicRunError(
  error: unknown,
  cancelled: boolean,
): PublicRunError {
  if (cancelled)
    return {
      code: "CANCELLED",
      message: "Run stopped.",
    };

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    name === "MaxTokensError" ||
    /maximum token limit|max(?:imum)? tokens?/i.test(message)
  )
    return {
      code: "OUTPUT_LIMIT",
      message:
        "The agent reached its output limit before it could finish. Your conversation is saved; ask for a shorter result or split the task into sections.",
    };

  return {
    code: "ERROR",
    message:
      "The agent could not finish. Your conversation is saved; please try again.",
  };
}
