import { json } from "@sveltejs/kit";
import { activeRuns } from "$lib/server/runner";
export const GET = () =>
  json({ status: activeRuns.size ? "HealthyBusy" : "Healthy" });
