import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CAMERA_AI_MODE = Deno.env.get("CAMERA_AI_MODE") || "disabled";

serve(async (req) => {
  const { method } = req;

  // OPTIONS → 204
  if (method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // GET, PUT, PATCH e DELETE → 405 method_not_allowed
  if (["GET", "PUT", "PATCH", "DELETE"].includes(method)) {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      { 
        status: 405, 
        headers: { "Content-Type": "application/json" } 
      }
    );
  }

  if (method === "POST") {
    // POST com CAMERA_AI_MODE diferente de enabled → 503
    if (CAMERA_AI_MODE !== "enabled") {
      return new Response(
        JSON.stringify({ error: "service_unavailable", message: "Camera AI is disabled" }),
        { 
          status: 503, 
          headers: { "Content-Type": "application/json" } 
        }
      );
    }

    // POST com CAMERA_AI_MODE=enabled, enquanto a implementação ainda não existe → 501
    return new Response(
      JSON.stringify({ error: "not_implemented", message: "OpenAI inference not yet implemented" }),
      { 
        status: 501, 
        headers: { "Content-Type": "application/json" } 
      }
    );
  }

  return new Response(
    JSON.stringify({ error: "not_found" }),
    { 
      status: 404, 
      headers: { "Content-Type": "application/json" } 
    }
  );
});
