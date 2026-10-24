import { errorResponse, jsonNoStore } from "@/lib/http";
import { collectGarbage } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Garbage collection.
 *
 * The reference project kept its cleanup inside the process; on Vercel there is
 * no long-lived process, so this is a scheduled endpoint instead (`vercel.json`
 * → crons). Vercel sends `Authorization: Bearer $CRON_SECRET` when the variable
 * is set; without the variable the route refuses everything, so a missing secret
 * fails closed rather than exposing a destructive endpoint.
 */
async function run(request: Request): Promise<Response> {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) return jsonNoStore({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonNoStore({ error: "forbidden" }, { status: 403 });
  }
  try {
    const report = await collectGarbage();
    return jsonNoStore({ ok: true, ...report });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
