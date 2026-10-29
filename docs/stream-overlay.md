# Stream overlay — OBS, YouTube, Facebook

[English](#english) · [Français](#français) · [Español](#español) · [Tagalog](#tagalog) · [廣東話](#廣東話)

---

## English

`overlay.html` is a scoreboard to lay over a live stream: the players' names, their Q-Scores,
the score, "Race to N", the game, the rack number and who breaks — on a see-through background,
following the scoring device as it changes. Nothing on it can be tapped; every option is in its
address.

### 1. Host the session on the device keeping score

Open the scoreboard from the computer running Pool Master Counter's server (the desktop app, or
`npm start` in `server/`), then **☰ Menu › More › Multi Tables › 🎯 Host This Session**. From then
on it sends the board after every change. (The iPad or phone keeping score can be another device
on the same Wi-Fi, opened from the computer's address and paired.)

### 2. Add it to OBS as a Browser Source

In OBS: **Sources › + › Browser**, then:

| Setting | Value |
|---|---|
| URL | `http://localhost:4173/overlay.html?layout=lower` |
| Width × Height | 1920 × 1080 (a 16:9 canvas) |
| Custom CSS | leave OBS's own (it keeps the page see-through) |

For an upright 9:16 stream (YouTube Shorts, Facebook Reels): `?layout=vertical`, 1080 × 1920,
with OBS's canvas set to 1080 × 1920 (**Settings › Video**).

**OBS on another computer** (a streaming PC next to the table): use the scoreboard computer's
address instead of `localhost` — the one the server prints, e.g.
`http://192.168.1.20:4173/overlay.html?layout=lower` — and add `&device=` with the app key: on the
scoreboard's computer, **☰ Menu › More › 📱 Paired devices › Show the address**, and copy what
comes after `?device=`. Keep that key to yourself.

`4173` is the server's usual port; if it was started on another one, use that.

### 3. Go live

Stream to YouTube or Facebook from OBS as usual (**Settings › Stream**, the service and its stream
key). The overlay is just another source in the scene.

### Options (in the address, joined with `&`)

| Option | What it does |
|---|---|
| `layout=lower` | a lower third across the bottom of a 16:9 picture (the default) |
| `layout=vertical` | the scoreboard stacked for a 9:16 picture |
| `pos=top` | at the top instead of the bottom |
| `theme=emerald-rail` | one of the app's 19 themes (`crimson-felt`, `emerald-rail`, `neon-arcade`, `midnight-ivory`, `sunset-chalk`, `obsidian-break`, `sunset-blaze`, `red-and-pink`, `gold-mine`, `rock-and-roll`, `copper-shine`, `daybreak-chalk`, `pearl-lounge`, `sunrise-glow`, `stainless-steel`, `opal-shimmer`, `flowery-forest`, `blackout-contrast`, `paper-contrast`); without it, the scoring device's theme |
| `lang=french` | `english` (default), `french`, `spanish`, `tagalog`, `cantonese` |
| `break=winner` | the last rack's winner breaks (the default); the first rack says "Lag for the break" |
| `break=alternate` | the two players take turns, the left one on rack 1 — add `first=2` when the right one won the lag |
| `break=off` | nobody shown breaking |
| `ratings=off` | no Q-Scores |
| `device=<key>` | the app key, for OBS on another computer |

### What it shows

- Two players (or Team A and Team B): the names, Q-Scores, the score in the boxes, "Race to N"
  between them, and under them the game, the rack and who breaks (a cue ball beside that name).
  A rack game shows racks won; a points game (Straight Pool, One Pocket...) its points, with the
  racks won in a race as dots. A score on the hill is outlined.
- Three players or more: one box each, the race and the game on the line under them.
- Nobody playing: nothing at all. Before the scoreboard has ever been seen: a short note saying
  what's missing ("Waiting for the scoreboard…", "isn't paired", "No scoreboard server here") —
  it only shows while setting up, never once the game is on. If the scoring device goes away, the
  last score stays up.

---

## Français

`overlay.html` est un tableau de score à poser sur un live : les noms des joueurs, leurs
Q-Scores, le score, « Course à N », le jeu, le numéro du rack et qui casse — sur fond
transparent, et il suit l'appareil qui compte les points. Rien n'y est cliquable ; toutes les
options sont dans son adresse.

### 1. Héberger la session sur l'appareil qui compte les points

Ouvrez le tableau de score depuis l'ordinateur où tourne le serveur de Pool Master Counter
(l'appli de bureau, ou `npm start` dans `server/`), puis **☰ Menu › Plus › Multi-tables ›
🎯 Héberger cette session**. Dès lors, il envoie le tableau après chaque changement. (L'iPad ou
le téléphone qui compte peut être un autre appareil sur le même Wi-Fi, ouvert à l'adresse de
l'ordinateur et jumelé.)

### 2. L'ajouter à OBS comme Source navigateur

Dans OBS : **Sources › + › Navigateur**, puis :

| Réglage | Valeur |
|---|---|
| URL | `http://localhost:4173/overlay.html?layout=lower` |
| Largeur × Hauteur | 1920 × 1080 (un canevas 16:9) |
| CSS personnalisé | laissez celui d'OBS (il garde la page transparente) |

Pour un live vertical 9:16 (YouTube Shorts, Facebook Reels) : `?layout=vertical`, 1080 × 1920,
avec le canevas d'OBS en 1080 × 1920 (**Paramètres › Vidéo**).

**OBS sur un autre ordinateur** (un PC de streaming près de la table) : l'adresse de l'ordinateur
du tableau de score au lieu de `localhost` — celle qu'affiche le serveur, par ex.
`http://192.168.1.20:4173/overlay.html?layout=lower` — plus `&device=` et la clé d'application :
sur l'ordinateur du tableau de score, **☰ Menu › Plus › 📱 Appareils associés › Afficher
l'adresse**, puis copiez ce qui suit `?device=`. Gardez cette clé pour vous.

`4173` est le port habituel du serveur ; s'il a été lancé sur un autre, utilisez celui-là.

### 3. Lancer le live

Diffusez sur YouTube ou Facebook depuis OBS comme d'habitude (**Paramètres › Stream**, le service
et sa clé de stream). L'overlay n'est qu'une source de plus dans la scène.

### Options (dans l'adresse, reliées par `&`)

| Option | Effet |
|---|---|
| `layout=lower` | un bandeau en bas d'une image 16:9 (par défaut) |
| `layout=vertical` | le tableau empilé pour une image 9:16 |
| `pos=top` | en haut au lieu d'en bas |
| `theme=emerald-rail` | l'un des 19 thèmes de l'appli (liste dans la section anglaise) ; sinon, le thème de l'appareil qui compte |
| `lang=french` | `english` (par défaut), `french`, `spanish`, `tagalog`, `cantonese` |
| `break=winner` | le gagnant du dernier rack casse (par défaut) ; au premier rack : « Lag pour la casse » |
| `break=alternate` | les deux joueurs cassent à tour de rôle, celui de gauche au rack 1 — ajoutez `first=2` si c'est celui de droite qui a gagné le lag |
| `break=off` | personne n'est indiqué à la casse |
| `ratings=off` | pas de Q-Scores |
| `device=<clé>` | la clé d'application, pour OBS sur un autre ordinateur |

### Ce qu'il affiche

- Deux joueurs (ou l'Équipe A et l'Équipe B) : les noms, les Q-Scores, le score dans les cases,
  « Course à N » entre eux, et dessous le jeu, le rack et qui casse (une bille blanche à côté du
  nom). Un jeu au rack affiche les racks gagnés ; un jeu aux points (14/1, One Pocket…) ses points,
  avec les racks gagnés d'une course en pastilles. Un score à une victoire du but est encadré.
- Trois joueurs ou plus : une case chacun, la course et le jeu sur la ligne du dessous.
- Personne ne joue : rien du tout. Tant que le tableau de score n'a jamais été vu : une courte
  note dit ce qui manque (« En attente du tableau de score… », « pas jumelé », « Pas de serveur ») —
  seulement pendant l'installation, jamais une fois la partie lancée. Si l'appareil qui compte
  s'en va, le dernier score reste affiché.

---

## Español

`overlay.html` es un marcador para poner sobre una transmisión en vivo: los nombres, sus
Q-Score, el marcador, "Carrera a N", el juego, el número de rack y quién rompe — con fondo
transparente, siguiendo al dispositivo que lleva el marcador. No tiene nada que tocar; todas las
opciones van en su dirección.

### 1. Aloja la sesión en el dispositivo que lleva el marcador

Abre el marcador desde la computadora que ejecuta el servidor de Pool Master Counter (la app de
escritorio, o `npm start` en `server/`) y luego **☰ Menú › Más › Varias mesas › 🎯 Alojar esta
sesión**. Desde ese momento envía el marcador tras cada cambio. (El iPad o teléfono que lleva el
marcador puede ser otro dispositivo en el mismo Wi-Fi, abierto desde la dirección de la
computadora y emparejado.)

### 2. Agrégalo a OBS como Fuente de navegador

En OBS: **Fuentes › + › Navegador**, y luego:

| Ajuste | Valor |
|---|---|
| URL | `http://localhost:4173/overlay.html?layout=lower` |
| Ancho × Alto | 1920 × 1080 (un lienzo 16:9) |
| CSS personalizado | deja el de OBS (mantiene la página transparente) |

Para una transmisión vertical 9:16 (YouTube Shorts, Facebook Reels): `?layout=vertical`,
1080 × 1920, con el lienzo de OBS en 1080 × 1920 (**Configuración › Video**).

**OBS en otra computadora** (una PC de streaming junto a la mesa): usa la dirección de la
computadora del marcador en lugar de `localhost` — la que muestra el servidor, p. ej.
`http://192.168.1.20:4173/overlay.html?layout=lower` — y añade `&device=` con la clave de app: en
la computadora del marcador, **☰ Menú › Más › 📱 Dispositivos vinculados › Mostrar la dirección**,
y copia lo que va después de `?device=`. No compartas esa clave.

`4173` es el puerto habitual del servidor; si se inició en otro, usa ese.

### 3. Sal en vivo

Transmite a YouTube o Facebook desde OBS como siempre (**Configuración › Emisión**, el servicio y
su clave de transmisión). El overlay es solo una fuente más en la escena.

### Opciones (en la dirección, unidas con `&`)

| Opción | Qué hace |
|---|---|
| `layout=lower` | una franja en la parte de abajo de una imagen 16:9 (por defecto) |
| `layout=vertical` | el marcador apilado para una imagen 9:16 |
| `pos=top` | arriba en vez de abajo |
| `theme=emerald-rail` | uno de los 19 temas de la app (lista en la sección en inglés); si no, el tema del dispositivo del marcador |
| `lang=spanish` | `english` (por defecto), `french`, `spanish`, `tagalog`, `cantonese` |
| `break=winner` | rompe quien ganó el último rack (por defecto); en el primer rack: "Lag para decidir quién rompe" |
| `break=alternate` | los dos jugadores rompen por turnos, el de la izquierda en el rack 1 — añade `first=2` si el de la derecha ganó el lag |
| `break=off` | no se indica quién rompe |
| `ratings=off` | sin Q-Score |
| `device=<clave>` | la clave de app, para OBS en otra computadora |

### Qué muestra

- Dos jugadores (o el Equipo A y el Equipo B): los nombres, los Q-Score, el marcador en las
  casillas, "Carrera a N" entre ellos, y debajo el juego, el rack y quién rompe (una bola blanca
  junto a ese nombre). Un juego por racks muestra los racks ganados; uno por puntos (Pool
  continuo, One Pocket…) sus puntos, con los racks ganados de una carrera como puntos. Un marcador
  a una victoria de la meta va resaltado.
- Tres jugadores o más: una casilla cada uno, la carrera y el juego en la línea de abajo.
- Nadie jugando: nada. Mientras el marcador nunca se ha visto: una nota breve dice qué falta
  ("Esperando el marcador…", "no está emparejada", "no hay servidor") — solo durante la
  configuración, nunca con el juego en marcha. Si el dispositivo del marcador se va, el último
  marcador sigue a la vista.

---

## Tagalog

Ang `overlay.html` ay scoreboard na ipapatong sa live stream: mga pangalan ng player, ang
kanilang Q-Score, ang score, "Race to N", ang laro, ang numero ng rack at kung sino ang
magbe-break — transparent ang background, at sumusunod sa device na nagbibilang ng score. Walang
pipindutin dito; nasa address nito ang lahat ng option.

### 1. I-host ang session sa device na nagbibilang ng score

Buksan ang scoreboard mula sa computer na nagpapatakbo ng server ng Pool Master Counter (ang
desktop app, o `npm start` sa `server/`), tapos **☰ Menu › Iba pa › Maraming Mesa › 🎯 I-host ang
Session na Ito**. Mula noon, ipinapadala nito ang scoreboard sa bawat pagbabago. (Puwedeng ibang
device sa parehong Wi-Fi ang iPad o teleponong nagbibilang, binuksan mula sa address ng computer
at naka-pair.)

### 2. Idagdag sa OBS bilang Browser Source

Sa OBS: **Sources › + › Browser**, tapos:

| Setting | Value |
|---|---|
| URL | `http://localhost:4173/overlay.html?layout=lower` |
| Width × Height | 1920 × 1080 (16:9 na canvas) |
| Custom CSS | hayaan ang sa OBS (pinapanatili nitong transparent ang page) |

Para sa patayong 9:16 na stream (YouTube Shorts, Facebook Reels): `?layout=vertical`,
1080 × 1920, at gawing 1080 × 1920 ang canvas ng OBS (**Settings › Video**).

**Kung nasa ibang computer ang OBS** (streaming PC sa tabi ng mesa): gamitin ang address ng
computer ng scoreboard sa halip na `localhost` — ang ipinapakita ng server, hal.
`http://192.168.1.20:4173/overlay.html?layout=lower` — at idagdag ang `&device=` at ang app key:
sa computer ng scoreboard, **☰ Menu › Iba pa › 📱 Mga naka-pair na device › Ipakita ang
address**, at kopyahin ang kasunod ng `?device=`. Huwag ibahagi ang key na iyon.

Ang `4173` ang karaniwang port ng server; kung ibang port ang ginamit, iyon ang ilagay.

### 3. Mag-live

Mag-stream sa YouTube o Facebook mula sa OBS gaya ng dati (**Settings › Stream**, ang service at
ang stream key nito). Isa lang na source sa scene ang overlay.

### Mga option (sa address, pinagdugtong ng `&`)

| Option | Ginagawa |
|---|---|
| `layout=lower` | lower third sa ibaba ng 16:9 na larawan (default) |
| `layout=vertical` | nakapatong-patong ang scoreboard para sa 9:16 na larawan |
| `pos=top` | sa itaas sa halip na sa ibaba |
| `theme=emerald-rail` | isa sa 19 na theme ng app (nasa English na seksiyon ang listahan); kung wala, ang theme ng device na nagbibilang |
| `lang=tagalog` | `english` (default), `french`, `spanish`, `tagalog`, `cantonese` |
| `break=winner` | ang nanalo sa huling rack ang magbe-break (default); sa unang rack: "Mag-lag para sa break" |
| `break=alternate` | salitan ang dalawang player, ang nasa kaliwa sa rack 1 — idagdag ang `first=2` kung ang nasa kanan ang nanalo sa lag |
| `break=off` | walang ipinapakitang magbe-break |
| `ratings=off` | walang Q-Score |
| `device=<key>` | ang app key, para sa OBS sa ibang computer |

### Ano ang ipinapakita

- Dalawang player (o Team A at Team B): mga pangalan, Q-Score, ang score sa mga kahon, "Race to
  N" sa pagitan nila, at sa ilalim ang laro, ang rack at kung sino ang magbe-break (may cue ball
  sa tabi ng pangalang iyon). Sa larong by rack, ang mga rack na napanalunan; sa larong by points
  (Straight Pool, One Pocket…) ang points, at ang mga rack na napanalunan sa race bilang mga
  tuldok. May outline ang score na isang panalo na lang.
- Tatlo o higit pang player: tig-isang kahon, ang race at ang laro sa linya sa ilalim.
- Walang naglalaro: walang lalabas. Habang hindi pa nakikita ang scoreboard: maikling paalala kung
  ano ang kulang ("Hinihintay ang scoreboard…", "hindi pa naka-pair", "Walang scoreboard server") —
  habang nagse-set up lang, hindi kailanman habang may laro. Kapag nawala ang device na
  nagbibilang, nananatili ang huling score.

---

## 廣東話

`overlay.html` 係一個鋪喺直播上面嘅記分板：球員個名、佢哋嘅 Q-Score、比數、「搶 N」、玩緊咩、
第幾局同邊個開波——背景係透明嘅，會跟住負責記分嗰部機即時更新。上面冇嘢要撳；所有選項都寫喺
網址度。

### 1. 喺負責記分嗰部機主持場次

由行緊 Pool Master Counter 伺服器嗰部電腦開記分板（桌面版 app，或者喺 `server/` 入面
`npm start`），然後 **☰ 選單 › 更多 › 多張枱 › 🎯 主持呢個場次**。之後每次有改動，佢都會將記分板
送出去。（負責記分嘅 iPad 或者電話可以係同一個 Wi-Fi 入面另一部機，用電腦嘅地址開，並且已經
配對。）

### 2. 喺 OBS 加做瀏覽器來源

喺 OBS：**來源 › + › 瀏覽器**，然後：

| 設定 | 數值 |
|---|---|
| 網址 | `http://localhost:4173/overlay.html?layout=lower` |
| 闊 × 高 | 1920 × 1080（16:9 畫布） |
| 自訂 CSS | 用返 OBS 自己嗰個（佢會保持頁面透明） |

直度 9:16 直播（YouTube Shorts、Facebook Reels）：`?layout=vertical`，1080 × 1920，再將 OBS
畫布設做 1080 × 1920（**設定 › 影像**）。

**OBS 喺第二部電腦**（枱邊另一部直播用電腦）：用記分板嗰部電腦嘅地址代替 `localhost`——即係
伺服器顯示嗰個，例如 `http://192.168.1.20:4173/overlay.html?layout=lower`——再加 `&device=` 同
應用程式鑰匙：喺記分板嗰部電腦，**☰ 選單 › 更多 › 📱 已配對裝置 › 顯示網址**，再複製 `?device=`
後面嗰段。呢條鑰匙唔好俾人。

`4173` 係伺服器平時用嘅埠；如果開咗喺第二個埠，就用嗰個。

### 3. 開直播

照平時咁由 OBS 直播去 YouTube 或者 Facebook（**設定 › 串流**，揀服務同埋入串流金鑰）。疊加畫面
只係場景入面多一個來源。

### 選項（寫喺網址度，用 `&` 連埋一齊）

| 選項 | 作用 |
|---|---|
| `layout=lower` | 16:9 畫面底部嘅一條橫額（預設） |
| `layout=vertical` | 為 9:16 畫面直住排嘅記分板 |
| `pos=top` | 擺喺頂而唔係底 |
| `theme=emerald-rail` | app 嘅 19 個主題之一（清單喺英文嗰段）；唔寫就跟記分嗰部機嘅主題 |
| `lang=cantonese` | `english`（預設）、`french`、`spanish`、`tagalog`、`cantonese` |
| `break=winner` | 上一局贏咗嗰個開波（預設）；第一局顯示「Lag 波決定邊個開波」 |
| `break=alternate` | 兩個球員輪流開波，第 1 局由左邊嗰個開——如果係右邊嗰個贏咗 lag 波，就加 `first=2` |
| `break=off` | 唔顯示邊個開波 |
| `ratings=off` | 唔顯示 Q-Score |
| `device=<鑰匙>` | 應用程式鑰匙，OBS 喺第二部電腦先要 |

### 會顯示乜嘢

- 兩個球員（或者 A隊同 B隊）：名、Q-Score、格仔入面嘅比數、中間嘅「搶 N」，下面係玩緊咩、第幾局
  同邊個開波（嗰個名旁邊有粒白波）。計局數嘅玩法顯示贏咗幾多局；計分嘅玩法（Straight Pool、
  One Pocket…）顯示分數，搶局時贏咗嘅局數用圓點表示。差一局就贏嘅比數會加框。
- 三個或者以上球員：每人一格，搶幾多局同玩緊咩寫喺下面嗰行。
- 冇人上場：乜都唔顯示。記分板未出現過之前：會有一句簡短提示講欠咗乜（「等緊記分板…」、
  「未配對」、「冇記分板伺服器」）——只會喺設定嗰陣出現，開咗波之後永遠唔會出。如果記分嗰部機
  斷咗線，最後嘅比數會繼續留喺度。
