import type { HarnessDecision, HarnessInput } from "./domain.js";

// Generic evidence/completeness validation. Required fields are policy data;
// this does not choose patient wording or enumerate missing-field combinations.
export function collectionFeedback(decision: HarnessDecision, input: HarnessInput): string | undefined {
  if (input.useCase !== "IDENTITY_CONFIRMATION" ||
      ["IDENTITY_CONFIRMATION_DECLINED", "UNSUPPORTED_CLIENT"].includes(decision.reason)) return;
  const fields = input.responsePolicy.collectionFields;
  if (!fields?.length) throw new Error("Identity collection policy is missing");
  const details = decision.collectedDetails;
  if (!details || fields.some((field) => !Object.hasOwn(details, field.key))) {
    return `Return collectedDetails with every configured key: ${fields.map((field) => field.key).join(", ")}. Use null for missing or unclear details. Evaluate these details before choosing an action.`;
  }
  const patientBodies = [input.trigger.content, ...input.priorMessages
    .filter((message) => message.direction === "member_to_care_team" && message.conversationId === input.trigger.conversationId)
    .map((message) => message.content)];
  const invalid = fields.filter((field) => {
    const value = details[field.key];
    if (value === null) return false;
    return !value?.trim() || !patientBodies.some((body) => body.includes(value)) ||
      (field.type === "date" && !isCompleteCalendarDate(value));
  });
  if (invalid.length) {
    return `Unsupported or invalid patient evidence for: ${invalid.map((field) => field.key).join(", ")}. Use exact substrings of patient message bodies, never metadata or assistant text. Dates must contain a valid day, month, and four-digit year. Use null for details without valid evidence, and ask for them naturally.`;
  }
  const missing = fields.filter((field) => details[field.key] === null);
  if (missing.length && ["IDENTITY_DETAILS_COLLECTED", "IDENTITY_CONVERSATION_COMPLETE"].includes(decision.reason)) {
    return `Collection is NOT complete. Missing details: ${missing.map((field) => field.label).join(", ")}. Return SEND_MESSAGE with reason IDENTITY_FOLLOW_UP and naturally ask only for missing information. A previous assistant acknowledgment cannot override this check.`;
  }
}

export function isCompleteCalendarDate(value: string): boolean {
  let year: number, month: number, day: number;
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const named = value.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})$/i);
  if (iso) {
    [, year, month, day] = iso.map(Number) as [number, number, number, number];
  } else if (numeric) {
    [, month, day, year] = numeric.map(Number) as [number, number, number, number];
  } else if (named) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    month = months.findIndex((name) => name === named[1]!.toLowerCase() || name.slice(0, 3) === named[1]!.toLowerCase()) + 1;
    day = Number(named[2]); year = Number(named[3]);
  } else return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && month >= 1 && month <= 12 &&
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
