# Local test and build tools

Not part of the app - helpers for testing and for running this machine's own copy of it.

- `publicbuild/build-public.js` - makes the minified copy of the site (`publicbuild/site/`, not
  committed): inline and separate scripts and styles minified, comments and indentation stripped,
  the camera's vendor files and models copied as they are.
- `publicbuild/rebuild_server_min.sh` - rebuilds the local server app (ports 4173 http / 4174
  https) to serve that minified copy; `publicbuild/rebuild_server.sh` puts the plain one back.
  Both use machine-specific paths (the signing-free test server binary, its certificates and
  Node 24) set at the top of each script.
- `publicbuild/noopen/open` - a stand-in `open` so the rebuilt server doesn't open a browser.
- `probe_debug_collapse.js` - browser check of Visual Scoring's collapsible "Debugging visual
  matching" section: `node tests/probe_debug_collapse.js http://localhost:4235/ <screenshot dir>`
  against a test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_walking_paths.js` - walks synthetic people through the camera page's real detection loop
  (`PMCCueDebug.posesOverride`) to check walking paths: a player out of view for a moment comes back
  on their path with the same track id and name; nobody off the path, nobody two lost players could
  be, and nobody after 12 s does; crossing walkers keep their ids; a returning player bent over a
  shot is credited to them. `node tests/probe_walking_paths.js http://localhost:4236/ [--calibrated]`
  against a test server (`HOME=tests/tmphome PORT=4236 node server/server.js`).
- `probe_new_day_shirts.js` - seeds the camera page's same-device sample store with yesterday's
  samples (synthetic colour counts) and checks a new day: a player in a new shirt - even another
  player's colour from yesterday - is still recognized by trousers, cap and build; a stranger in a
  player's old shirt isn't; the appearance models and the "plenty pressed" count use only today's
  samples; a day runs 5 a.m. to 5 a.m. `node tests/probe_new_day_shirts.js http://localhost:4237/`
  against a test server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
- `probe_room_map.js` - the camera page's room map against a synthetic camera and room: the
  camera's lens, position and height from the table calibration (also with the corners tapped the
  other way round, with tapping errors, and looking nearly straight down); the room's shape from a
  ray-traced depth map (the table's size, the floor, a cabinet, the walls, the camera); synthetic
  walkers projected through the camera into the real detection loop - their spots, who they are,
  where one who walked out of view could be, back on their path; every debugging id in the SVG.
  `node tests/probe_room_map.js http://localhost:4237/ [screenshot.png]` against a test server
  (`HOME=tests/tmphome PORT=4237 node server/server.js`).
- `probe_camera_icon_states.js` - the scoreboard with two players and the same-device camera in its
  iframe (fake video, a synthetic calibrated camera, synthetic people): each score card's camera
  icon through its states - light grey (nothing known), yellow (someone in view carrying the
  player's walking path), green (a sure look), blue (out of view, placed by the walking path, then
  by the room map), grey again once the camera stops talking - its size (60px) with the name left
  where it was, no flashing, and the colour kept across a redraw of the cards.
  `node tests/probe_camera_icon_states.js http://localhost:4237/ [screenshot dir]` against a test
  server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
- `test_voice_parser.js` - the voice commands' sentence parser on its own, in Node: every sentence
  on the "Voice commands" sheet and the usual mishearings ("Luke" for Luc, "at one point", "race 2
  7", "Luigi's", "queue score") into the right command and players; unknown and doubled names
  refused. `node tests/test_voice_parser.js`
- `probe_voice.js` - voice commands in the page with the microphone replaced by a fake that "hears"
  a given sentence when the hold ends: the number pad's "." key and the 🎤 Talk button held (a tap
  shows the sentences), game / race / rotation / players / teams / points (with the keypad's beep)
  / an 8-ball win with balls left (the "." key not typed into the focused field) / "Nice game" /
  spoken Q-score and score; unknown names, the sheet, phone width.
  `node tests/probe_voice.js http://localhost:4235/ [screenshot dir]` against a test server
  (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_voice_siri.js` - voice commands from a Siri Shortcut: sentences sent to the server's
  `/voice` (JSON, form, plain text, `?text=`) are done on the open scoreboard and the answer comes
  back as plain text for Siri to speak ("Luc plus 1, now 1"); the page doesn't speak them itself;
  "Help" opens the sheet with the Shortcut's steps and this computer's address; with two
  scoreboards open only the one used last acts; none open: 503.
  `node tests/probe_voice_siri.js http://localhost:4235/` against a test server
  (`HOME=tests/tmphome PORT=4235 node server/server.js`) started after the change.
- `probe_camera_zoom.js` - the camera page's zoom and upside-down turn, with a fake camera playing
  a still test picture (generated into `tmphome/`): the picture zoomed / turned pixel by pixel, the
  camera asked for 4K when zooming, the table calibration and the furniture snapshot converted
  exactly and back to the original when undone, and Zoom / "Camera mounted upside down" set in
  the scoreboard's Capture Settings reaching the camera page. `node tests/probe_camera_zoom.js
  http://localhost:4235/` against a test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_ball_sensitivity.js` - ball detection sensitivity against the empty-room snapshot, on a
  synthetic table (green felt under a lamp, corners under half as bright): the snapshot taken from
  the empty table, then the camera page reopened on the table with a red ball, the cue ball and a
  ball of the felt's own colour 30% darker. At 5 the red and cue balls; at 10 the dark one too and
  no false ball in the dark corners (the snapshot knows the lighting); at 1 the red ball still; the
  pink preview; the slider right under the picture; the setting kept; the scoreboard field.
  `node tests/probe_ball_sensitivity.js http://localhost:4235/ [screenshot dir]` against a test
  server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_room_tags.js` - room tags: a fake camera plays a still room photo (any photo of a room with
  a pool table - checked with the public-domain "Pool Table—Valley Forge Farm.jpg" from Wikimedia
  Commons); the empty-room snapshot gets tagged (pool table, chairs...), the tags kept with it and
  back after a reload without the model running again; a "person" inside a tagged picture set
  aside, a bigger one not; one on a tagged chair looking like the empty room set aside; 4 rails and
  6 pockets; the tags drawn on the picture; forgetting the snapshot forgets them.
  `node tests/probe_room_tags.js http://localhost:4235/ <room photo> [screenshot dir]` against a
  test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_recorder.js` - the recording page and its cues end to end: a fake camera (a still test
  picture) in a headless browser, the scoreboard and record.html in two tabs (BroadcastChannel),
  the server keeping the video in `<test HOME>/Movies/Pool Master Counter`: the recording's own
  crop zoom; parts sent to the computer and a new file every 5 s here (each a real video, ffprobe);
  "mark" / "finish" said on the scoreboard (the recording tab in the background) make a cue named
  [player]-vs-[opponent]-[game]-[position]-[duration]-[date]-[time]-cued, never said out loud;
  the score section's ⭐ Cue button and the "/" key set and end one (the button counting), "/"
  still the shot counter's pause when nothing records; the recorded sound (the fake microphone's
  beep, measured) silent for a moment at a cue, then back; cues.html lists it and plays it from
  the recording; "mark" with no recording says so; a cue deleted from its row (asks first); a
  recording that's still recording can't be deleted, a stopped one goes to `<test HOME>/.Trash`
  with its cues, the exported clip kept. The cue viewer (js/cue-viewer.js) on the
  recording page while it records: the cue plays from the file still being written, its start and
  end nudged / set at the playhead and saved (the name's length and time follow), exported on the
  spot (cut, downloaded, kept in Clips, about as long as set), a cue added by hand; then the cues
  page's same viewer plays it from its set start.
  `node tests/probe_recorder.js http://localhost:4235/` against a test server
  (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_shot_detect.js` - the camera page's shots (for the 🎯 Auto cue) on a synthetic table: a
  looping video where the cue ball rolls to another spot = a shot (begin, then end with `shot:
  true`, the balls moved, "ms ago" times about as long as the rolling), a dark arm sweeping over the
  cloth = not a shot, no calibration = `watch` with ok false. Heard as a listener on /ws-camera.
  `node tests/probe_shot_detect.js http://localhost:4235/` (same test server).
- `probe_auto_cue.js` - the 🎯 Auto cue end to end (scoreboard + recording page, the camera's shots
  fed in through `PMCCameraBridge.reportShot`): dimmed and refused with no camera; "*" then a shot
  -> kept 5 s before the aim to 5 s after the balls stop, the button counting meanwhile; a shot just
  before the press (look-back); a non-shot then nothing -> "No shot within ..." and no clip; cancel;
  "auto cue" said; the recording page's own button and A key; a shot heard twice counted once.
  `node tests/probe_auto_cue.js http://localhost:4235/` (same test server).
- `probe_drive_backup.js` - backups into the linked Google Drive folder: a fake Google Drive for
  desktop under its own test HOME (folders marked with `com.google.drivefs.item-id#S`, as Drive for
  desktop marks them); starts its own server on 4236 with `PMC_CLOUD_STORAGE` and
  `PMC_CLIPBOARD_FILE` (the real clipboard is never touched). The folder found from the link, All
  Data saved straight into it (complete, carrying the link, a second one beside it); a folder not
  synced -> kept in Documents › Pool Master Counter Backups + copied + asked to open the folder; no
  server -> downloaded + asked; a file link -> a plain download; a fresh device importing the file
  gets the link; Import & Replace takes it (its automatic backup kept quietly).
  `node tests/probe_drive_backup.js`.
- `probe_drive_connect.js` - Google Drive signed in with the user's own OAuth client
  (server/google-drive.js), against a fake Google it runs itself on 4299 (sign-in page, token
  endpoint checking PKCE and refresh tokens, revoke, a small Drive with resumable uploads), the
  scoreboard's server on 4237 with a throwaway HOME and `PMC_GOOGLE_*` pointing at the fake. The
  client saved on this computer only (bad ID refused, secret never sent back, file mode 600);
  Connect -> sign-in -> "Connected as ..."; All Data uploaded into the linked folder (no secret or
  token in it); Import lists and reads the folder's backups through the sign-in; the access token
  renewed; Disconnect revokes; a sign-in Google ended -> "press Connect again"; set-up refused from
  another device. `node tests/probe_drive_connect.js`.
- `probe_drive_browser.js` - Google Drive signed in on the device itself (the GitHub page on an
  iPad, no Mac server): the site from a plain file server (no /api, like GitHub Pages) on 4240, a
  fake Google with CORS on 4298 (a fake Google Identity Services library at /gsi/client, a small
  Drive), the page pointed at it by `window.PMC_TEST_GOOGLE_API` / `PMC_TEST_GIS_SRC`. No secret
  field; the ID kept on this device; Connect (full Drive, consent the first time); All Data uploaded
  (no client ID or token in it, the token for this tab only); an hour later the next backup asks
  Google again without consent and still uploads; Import lists and reads; Disconnect revokes.
  `node tests/probe_drive_browser.js`.
- `probe_backup_simple.js` - the simpler Backup & Restore and its rule, no dead ends (every button
  shown can finish its job on this device). The Mac (its server on 4241, a throwaway HOME, a fake
  Google Drive for desktop folder), the GitHub site (a plain file server on 4243) and a pretend tablet
  with a share sheet; a little web server on 4242. Plain words (no API key / client ID / "iCloud
  Sync"); Share Standings in Publish Daily Report, Share Last Session kept; GitHub: nothing
  Google-related (the owner's setup only with ?owner); computer: Downloads; tablet: the share sheet,
  "saved where you chose", cancel said; Mac: the Drive folder straight in, no "isn't set up" scare;
  Restore: a file -> Add / Replace; From a link: a Drive folder synced on the Mac listed, a web
  address read, a Drive folder/file a device can't open -> said, with "Open the link"; phone fit.
  `node tests/probe_backup_simple.js [screenshot dir]`.
- `probe_day_report_share.js` - Publish Daily Report sharing with attachments (the backup and the
  colorful report picture) and the colorful report page's own Share, on a GitHub-like file server
  (4244). Safari only opens the share sheet straight from the tap, so a pretend share sheet notes
  whether it was asked during the tap, and what it got: during the tap, with the backup (no contacts),
  a real PNG and the text. `node tests/probe_day_report_share.js`.
- `probe_race_to_one.js` - a race to 1 is no race: Quick Game's "🎱 Open play" and Current
  Session's "🎯 Single Game" keep a running tally (no "won the tournament" popup, no fanfare, no new
  session, no tournament in the stats, no 🏁, "Wins" on the card); Quick Game's "🏁 Race to [n]" is a
  real race (milestone exactly at n) and is remembered; the leaderboard says "1 win" and "1 tournament
  win". The fanfare is spotted by counting Web Audio oscillators. Its own file server on 4245.
  `node tests/probe_race_to_one.js [screenshot dir]`.
- `probe_pool_day.js` - a night is one "pool day" (5 a.m. to 5 a.m.) and saving keeps all of it:
  Save & Start New Session a week later files a 21:10-00:20 night under the night's own date, for
  every name in it (a player since removed too), and its report is archived once under that date;
  past 200 games the oldest go into the stats before they leave the board; a new Quick Game saves
  the board first, Start Without Saving still drops it; importing a 19:00-01:00 night keeps all 13
  games in Los Angeles and in Manila (time zones emulated). Its own file server on 4246.
  `node tests/probe_pool_day.js`.
- `probe_ratings.js` - ratings that stay right: 600 rated games (past the 500-point history cap)
  give the same ratings and games played on three starts in a row, histories in time order;
  merging another iPad's backup ("Add to what's here") gives the ratings of every game played on one
  device; "José" typed as one character or e + accent, and "Jo  Bob" with two spaces, are one
  player in stats and ratings; "reset all ratings" stays reset after a restart; the rules: both
  players move by the same amount (ratings add up; a regular vs a newcomer: the card's +X/-Y is what
  happens), team games are rated (each side by its average), a longer game counts more (Straight
  Pool to 100: +32 against +12 for a rack), an old team game stays unrated until a recompute. Its
  own file server on 4247. `node tests/probe_ratings.js`.
- `probe_storage.js` - storage you can trust: with the storage full, the next score shows the red
  "NOT SAVED" bar (Back up now, See storage), gone again after the next save that works; Backup &
  Restore's storage meter and "What's using it"; 1.5 MB of game logs comes in with little room left
  (they go to IndexedDB - js/big-store.js), while an import that can't be written ("Add to what's
  here" and "Replace") changes no key and no game log and says so; an older version's game logs move
  into the database on the first start and are in the backup; a backup carries the camera page's
  room plan, tags, map options and view, Quick Game's race and the Drive folder link. Fills the
  storage on purpose with a junk key. Its own file server on 4249. `node tests/probe_storage.js`.
  (Tests that read game logs or the report archive read them from IndexedDB - see readBig in
  probe_pool_day.js and the others.)
- `probe_scores.js` - every score is kept, and so is in every backup: a Straight Pool game to 10
  keeps both players' points (10-7) and the race tally, in the players' game logs and the backup
  file; the game that ends a race to 3 holds its final score (3-1); a finished 4-player single
  elimination keeps its game, race, all 3 matches with scores, and the placings (the two semi-final
  losers sharing 3rd). Its own file server on 4250. `node tests/probe_scores.js`.
- `test_brackets.js` (node, no browser) - brackets built the standard way: the real functions pulled
  out of js/app.js and played with random results for every field size 3-64, single and double
  elimination: byes only in round 1, at most one each, to the top seeds (seed 1 meets seed 2 in the
  final when the higher seed wins); the wins needed to take the title differ by at most one; no
  deadlock; everyone out on their 1st/2nd loss; the losers bracket no longer than the standard
  2 x (rounds - 1); nobody's first losers match against the player who just beat them; the grand
  final resets; "Match Similar Ratings" pairs neighbours. `node tests/test_brackets.js`.
- `probe_brackets_ui.js` - the same on screen: 9 players single elimination is a "Round of 16" with
  7 byes and 8 matches to a champion; 6 players double elimination shows "If you lose: Losers R..."
  on every winners match, plays the losers bracket and ends with placings. Its own file server on
  4251. `node tests/probe_brackets_ui.js [screenshot dir]`.
- `probe_tournament_fixes.js` - a tournament director can fix things: ↩ Undo last rack (the game
  and its rating change gone, exactly); ✏️ a finished match's result changed before the next match
  is played (the right player moves on, racks and ratings follow the score), refused once that next
  match is under way, naming it; a walkover (no game, no rating change); a withdrawal in a round
  robin (walkovers, the event finishes); a late player into a round-1 bye; "⚠️ Reset Tournament"
  leaves a tournament in progress alone; Abandon takes out only that tournament's racks and ratings,
  not a casual game meanwhile; a league match's score changed and one deleted, the standings
  following. Its own file server on 4252. `node tests/probe_tournament_fixes.js`.
- `probe_out_of_view.js` - out of view: a named player who walks out of the picture keeps a tag at
  the edge they left by (name, time, arrow), is kept past the 12 s a hidden player is looked for,
  and gets their path and name back coming in at that edge; hidden mid-picture as long: no name;
  two named players gone the same way: the next one in gets neither; the room map's tag spot just
  out of the camera's sight, its circle capped at 5 ft. Synthetic people as probe_walking_paths.js.
  `node tests/probe_out_of_view.js http://localhost:4236/` against a test server
  (`HOME=tests/tmphome PORT=4236 node server/server.js`).
- `probe_expected_shooter.js` - the turn order as a hint for the camera: a keypad switch in
  Straight Pool sends "expected-shooter" (not in 8-Ball, not the camera's own pick); the relay
  passes it to the camera; camera.html keeps it for Playing players and uses it to break ties and
  for a shooter nobody's looks name - never over a clear match of someone else.
  `node tests/probe_expected_shooter.js http://localhost:4236/` against a test server
  (`HOME=tests/tmphome PORT=4236 node server/server.js`).
- `make_voice_pdf.js` - makes `docs/voice-commands.pdf` (and its .html): how to talk to the
  scoreboard, every sentence (from js/voice.js's own SHEET and english.json, so it can't drift),
  the Siri Shortcut set-up with this computer's address, troubleshooting, recording marks.
  `node tests/make_voice_pdf.js [http://<address>:4173]`.
- `probe_setup_layout.js` - Current Session › Tournament Type and the score card line: "🏁 Race to
  [n] wins" beside "🎯 Single Game" (the number in its option, big; Single Game keeps it shown; a tap
  selects it, typing picks Race to Wins; Race to Wins uses it - no question); "Rotate game types
  automatically — change every [n] games" (= Games Rotations' Switch every); Timed Tournament under it
  with "— ends after [n] minutes"; Q-Score and its explanation on one line; "🎱 Now playing 8-Ball -
  target [x] rack — switches to 9-Ball in [y] games." (x, y their own colour, bigger; x keeps the
  rotation's target, y the games left, kept to Switch every).
  `node tests/probe_setup_layout.js http://localhost:4235/ [screenshot dir]`.
- `test_mp4_clip.js` - js/mp4-clip.js in Node: an ffmpeg-made fragmented MP4 (like MediaRecorder's)
  fed to the Indexer in random pieces, then cut at three stretches: each clip starts on the right key
  frame, is as long as asked, decodes cleanly. `node tests/test_mp4_clip.js`.
- `probe_local_recorder.js` - 🎬 Record this session (js/local-recorder.js), on a GitHub-like file
  server (4247) with a fake camera and microphone: the panel only without a server and not on an
  iPhone; the header's 🎬 Record opens it; recording (MP4), the score card's ⭐ Cue there (no 🎯 Auto
  cue), "/" sets and ends a cue named as usual; kept on this device with its fragments indexed; ⬇ Save
  clip = an ordinary MP4 about as long as the cue (ffprobe, decodes); the whole recording saved; on a
  tablet Save prepares then "📤 Share it now" opens the share sheet from that tap; 🗑 asks first.
  `node tests/probe_local_recorder.js [screenshot dir]`.

- `test_challonge.js` - Challonge pushes that tell the truth: the real push code (pulled out of
  js/app.js) against a fake Challonge (`challonge_mock.js`). A day pushed mid-day sends only the pairs
  that played (no 1-1 ties for the rest); pushed again, only the new pair and the changed totals; a
  changed score is sent again; "Bob beat Ann" and "Ann beat Bob" are one pair, and an older record's
  roster-order "Dan|Cat" still counts for Cat|Dan; 🔒 Close alone sends the never-played pairs as 1-1
  ties and closes. A round robin tournament: mid-event, later, a corrected score, Close. Every page of
  the match list (66 matches, 25 a page; a Challonge ignoring the page number doesn't loop). Single
  elimination: our seeds make Challonge draw our round 1, every result lands, Challonge's champion is
  ours; a draw it can't copy and Swiss send the roster only; double elimination against a different
  losers bracket stops at the first losers match and sends nothing after. New tournaments are private
  and named "<venue> — <date> — <format>". `node tests/test_challonge.js`.
- `challonge_mock.js` - the fake Challonge v2.1 both Challonge tests use (round robin, single
  elimination drawn the standard way from the seeds, pages of 25).
- `probe_challonge.js` - the same on screen (4253), the fake Challonge answering inside the browser:
  Review Before Pushing lists exactly what goes ("➕", "✏️ ... Challonge has ...", "✓ already on
  Challonge") and says unplayed pairs aren't sent; Push sends just that, private, named after the
  venue typed in the ☁️ Challonge panel; 🔒 Close names the never-played pairs before sending them as
  1–1 ties; a round robin tournament's ☁️ Push opens the dialog for it; a Race to 2 goes to Challonge
  only from the 🏆 screen's ☁️ button, after a confirm, and the day's push then leaves its games out.
  `node tests/probe_challonge.js [screenshot dir]`.
