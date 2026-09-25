# Challonge CORS proxy

Challonge's v2.1 REST API (`/v2.1/*`) answers the browser's CORS
preflight but never sends `Access-Control-Allow-Origin` on the actual
response - confirmed live against `api.challonge.com`. That means
every real request (create tournament, add participants, report a
match score) gets silently blocked by the browser after Challonge
replies, no matter how the request is shaped. The OAuth token exchange
(`/oauth/token`) is unaffected - it sends proper CORS headers and Pool
Master Counter calls it directly.

This is a small Cloudflare Worker that sits between the app and
Challonge for the REST calls only: it forwards the request to
Challonge server-side (no CORS concept between two servers) and adds
the missing header on the way back. It only forwards `/v2.1/*` paths
to `api.challonge.com` - it is not a general-purpose open proxy, and
the user's Challonge client id/secret never pass through it (only the
short-lived bearer token from the OAuth exchange does, same as it
would going directly to Challonge).

Deployed at:
`https://pool-master-counter-challonge-proxy.poolmastercounter.workers.dev`

`js/app.js`'s `CHALLONGE_API_BASE` points here instead of directly at
`api.challonge.com/v2.1`.

## Redeploying

```
cd challonge-proxy
npx wrangler login   # first time only
npx wrangler deploy
```
