import { NextRequest } from "next/server";

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = `${API_BASE}/api/${path.join("/")}${req.nextUrl.search}`;

  // SSE: stream the response
  if (path[0] === "events") {
    const upstream = await fetch(url, {
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const res = await fetch(url, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = `${API_BASE}/api/${path.join("/")}`;
  const body = await req.text();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("Content-Type") || "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body,
  });
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
