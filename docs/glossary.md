# Glossary

One name per idea. The app's language files (`languages/*.json`) use these words and no others for
these ideas. `node tests/test_strings.js` checks the parts a script can check: every key in all five
languages, no "(target 1)" or "1 wins", no "game(s)", no "Q-Score", and the rating words below.

| Idea | English | Français | Español | Tagalog | 粵語 |
|---|---|---|---|---|---|
| **Game / rack** — one game of pool, from the break until someone wins it. When games count toward a race the board calls them racks. | game, rack | partie, manche | partida | laro, rack | 局 |
| **Race** — first to win N racks wins the race ("Race to 5"). | race to N | course à N | carrera a N | race to N | 搶 N |
| **No race** — games are counted one by one; nothing ends at a number. | No race | Pas de course | Sin carrera | Walang race | 唔搶局 |
| **Rotation** — the game type changes on its own every N games. Its opposite is **Rotation off** (not "Single game"). | Rotation / Rotation off | Rotation / Sans rotation | Rotación / Sin rotación | Rotation / Walang rotation | 輪換 / 唔輪換 |
| **Match** — two sides playing a race against each other in a tournament or league. | match | match | partido | laban | 場 |
| **Session** — the players and settings in use now, from Start until it's saved or a new session starts. | session | session | sesión | session | 場次 |
| **Night** (pool day) — everything played from 5 a.m. to 5 a.m.; 🌙 End night sums it up and shares it. | night | soirée | noche | gabi | 今晚 |
| **Day Report** — the written summary of one pool day. | Day Report | Rapport du jour | Informe del día | Report ng araw | 每日報告 |
| **Rating** — the app's own Elo-style number (starts at 400) that moves after every rated game. Never "Q-Score". | Rating | cote | puntuación | rating | 評分 |
| **Fargo** — only a real FargoRate number looked up on FargoRate.com. Never the app's rating. | Fargo, FargoRate | Fargo | Fargo | Fargo | Fargo |
| **Balanced race** (⚖️) — the lower-rated side races to a shorter target, set by the rating gap. | balanced race | course équilibrée | carrera equilibrada | balanseng race | 平衡賽 |
| **Handicap** — a league's head start from Skill Levels (APA, BCA, VNBA, TAP). | handicap | handicap | hándicap | handicap | 讓分 |
| **Skill Level** — a league player's level in that league's system. | Skill Level | Niveau de compétence | Nivel de habilidad | Skill Level | 技術等級 |
| **Leaderboard** — players ranked over a period (today, week, all time). | Leaderboard | Classement | Clasificación | Leaderboard | 排行榜 |
| **Standings** — this session's race progress, or a league's or tournament's table. | Standings | Classement | Clasificación | Standings | 排名 |
| **All players** — the page with every player's card and the games chart (once "Global Stats"). | All players | Tous les joueurs | Todos los jugadores | Lahat ng manlalaro | 所有玩家 |
| **Save to history** — copies this session's games into a player's saved history (once "Export Stats"). | Save to history | Enregistrer dans l'historique | Guardar en el historial | I-save sa history | 存入紀錄 |
| **Winner stays** — the winner keeps the table; the next player in line comes in. | Winner stays | Le gagnant reste | El ganador se queda | Winner stays | 贏家留場 |
| **Practice** — nothing is saved: no games, stats or ratings. | Practice | Entraînement | Práctica | Practice | 練習 |
| **Undo** (↩) — takes back the last score: one point or one rack win. | Undo | Annuler | Deshacer | I-undo | 撤銷 |
| **Backup** — one file with everything on this device except videos. | Backup | Sauvegarde | Copia | Backup | 備份 |
| **MVP** — the night's most valuable player; on teams, who sank the winning balls. | MVP | MVP | MVP | MVP | MVP |
| **Bracket** — a tournament's draw (winners, losers, grand final). | bracket | tableau | cuadro | bracket | 對戰表 |
| **Session format** — how a session ends: race to wins, no race, timed. (Not "Tournament Type".) | Session format | Format de la session | Formato de la sesión | Format ng session | 場次賽制 |
| **Tournament format** — double elimination, round robin or Swiss. | Tournament format | Format du tournoi | Formato del torneo | Format ng tournament | 錦標賽賽制 |

## Writing rules

- Counts use the language's own plural rule: `TP(key, n, vars)` picks `key + "One"` when
  `Intl.PluralRules` says "one" (French counts 0 and 1 that way); `countPhrase(kind, n)` gives
  "1 game" / "3 games" from `count.<kind>` to drop into a longer sentence. Never write "game(s)".
- A one-rack game has no "(target 1)".
- Help and explanations: sentences of about 20 words; the button names in them are the buttons'
  real labels in that language.
