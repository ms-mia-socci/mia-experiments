export function firstMessageTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 65
    ? clean.slice(0, 62).replace(/\s+\S*$/, "") + "…"
    : clean || "New conversation";
}
