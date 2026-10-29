# Following a tournament over the internet - a design note

Today the follow page (`follow.html`) and the stream overlay are read-only guests of the relay that
the Mac server runs on the room's network (`server/relay.js`). Anyone on the same Wi-Fi can follow;
nobody outside can. Following from home needs a relay on the internet. This note is the plan; it
isn't built.

## The shape

A hosted relay that does exactly what `server/relay.js` does, nothing more:

- the scoreboard (the host) connects out to it and sends its snapshot after every change;
- followers connect and receive the latest snapshot, then each new one;
- followers never send anything (no actions over the internet - scoring stays in the room).

The cheapest fit is a **Cloudflare Worker with a Durable Object** per event:

- the Worker answers `GET /e/<event-id>` (the follow page, static) and upgrades
  `GET /e/<event-id>/ws` to a WebSocket handed to the event's Durable Object;
- the Durable Object holds the host socket, the follower sockets and the last snapshot in
  memory - it's the same code as `relay.js`, minus guest actions;
- WebSocket hibernation keeps an idle event nearly free; the object is gone when the last socket
  closes and the event is over.

## Cost

Cloudflare's Workers paid plan (US$5 a month) covers this many times over: a night's tournament
is one Durable Object, a few hundred snapshot messages and, say, 50 followers - well inside the
included requests and duration. The free plan works for testing (with its daily request cap).
No database, no storage bill: nothing is kept after the event.

## Privacy - what leaves the room

Only what the follow page shows: the event's snapshot - players' names (or nicknames) as entered,
the bracket or standings, scores, tables and the current matches. **Not** sent: emails, phone
numbers, ratings history, saved sessions, backups, camera data, recordings, Challonge or Drive
keys. The host decides per event ("📡 Share online" off by default), and can stop it any time,
which closes the followers' sockets at once.

To keep it that way:

- the host sends a reduced snapshot built for following (names, matches, scores), never the full
  app state the room's relay carries;
- the event id is random and unguessable (128 bits), so only people given the link or QR can
  follow; the link stops working when the host stops sharing;
- the Worker logs no message bodies; Cloudflare keeps only standard request logs (IP, time).

## Still to decide

- whether a follower may pick "my name" for "my next match" (it's all in the page; nothing is sent);
- a short code instead of a long link for people typing it in;
- who owns the Cloudflare account (the app isn't sold, so a personal account is enough).
