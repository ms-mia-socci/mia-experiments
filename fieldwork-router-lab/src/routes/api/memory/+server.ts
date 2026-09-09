import { json, error } from "@sveltejs/kit";
import { requireUser, requireOrigin } from "$lib/server/auth";
import {
  memoryProfile,
  memoryConfigured,
  memoryStatus,
  saveMemorySettings,
  inspectMemory,
  resetMemory,
} from "$lib/server/memory";
export const GET: import("./$types").RequestHandler = async (event) => {
  const owner = requireUser(event).id;
  let records;
  let unavailable = false;
  if (event.url.searchParams.get("inspect") === "1")
    try {
      records = await inspectMemory(owner);
    } catch {
      unavailable = true;
    }
  return json({
    settings: (await memoryProfile(owner)).settings,
    configured: memoryConfigured(),
    status: await memoryStatus(owner),
    records,
    unavailable,
  });
};
export const PATCH: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const owner = requireUser(event).id;
  try {
    return json({
      settings: (await saveMemorySettings(owner, await event.request.json()))
        .settings,
    });
  } catch {
    error(400, "Invalid memory settings");
  }
};
export const DELETE: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  return json(await resetMemory(requireUser(event).id));
};
