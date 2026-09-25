// Minimal CORS-unblocking relay for Challonge's v2.1 REST API.
//
// Challonge's OAuth token endpoint (/oauth/token) sends proper CORS
// headers on its real responses, so Pool Master Counter calls it
// directly from the browser. Every other v2.1 endpoint (create
// tournament, add participants, report scores) answers the CORS
// preflight but never sends Access-Control-Allow-Origin on the actual
// response - confirmed live against api.challonge.com - so browsers
// block reading those responses no matter what the request looks
// like. This worker exists only to sit between the browser and
// Challonge for those calls: it forwards the request to Challonge
// server-side (no CORS concept between servers) and adds the missing
// header on the way back.
//
// Scope is deliberately narrow: only /v2.1/* paths are forwarded, and
// only to api.challonge.com - this is not a general-purpose open
// proxy. The user's Challonge client id/secret never pass through
// here (only the short-lived bearer token from the OAuth exchange
// does, exactly as it would going directly to Challonge).

const CHALLONGE_ORIGIN = "https://api.challonge.com";
const ALLOWED_PREFIX = "/v2.1/";
const FORWARDED_REQUEST_HEADERS = ["authorization", "authorization-type", "content-type", "accept"];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400"
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith(ALLOWED_PREFIX)) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const targetUrl = CHALLONGE_ORIGIN + url.pathname + url.search;
    const forwardHeaders = new Headers();
    FORWARDED_REQUEST_HEADERS.forEach(function (name) {
      var value = request.headers.get(name);
      if (value) forwardHeaders.set(name, value);
    });

    var init = { method: request.method, headers: forwardHeaders };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
    }

    var challongeRes;
    try {
      challongeRes = await fetch(targetUrl, init);
    } catch (e) {
      return new Response(JSON.stringify({ error: "proxy_fetch_failed", detail: String(e) }), {
        status: 502,
        headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders())
      });
    }

    var body = await challongeRes.text();
    var headers = new Headers(corsHeaders());
    var contentType = challongeRes.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);

    return new Response(body, { status: challongeRes.status, headers: headers });
  }
};
