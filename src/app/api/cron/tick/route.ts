import { runDueJobs } from "@/engine/jobs";

export const maxDuration = 60;

async function tick(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (secret ? given !== secret : process.env.NODE_ENV === "production") return new Response("unauthorized", { status: 401 });
  return Response.json(await runDueJobs());
}
export const GET = tick;
export const POST = tick;
