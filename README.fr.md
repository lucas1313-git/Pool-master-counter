# Pool Master Counter

**[🇬🇧 English](README.md)** · **🇫🇷 Français** · [🇪🇸 Español](README.es.md) · [🇭🇰 廣東話](README.zh-yue.md)

Une application de comptage de points pour le billard, pensée pour le tactile, sur téléphone, tablette ou ordinateur. Elle fonctionne entièrement dans le navigateur — pas de serveur, pas de compte, pas d'étape de build — et se souvient de tout sur l'appareil utilisé : votre liste de joueurs, les statistiques de carrière, les classements des joueurs, les listes de joueurs enregistrées, les rotations d'ordre de partie, les tableaux de tournois, et les notes quotidiennes.

![Tableau de score en direct](docs/screenshots/live-scoreboard.jpg)

## Table des matières

- [Démarrage rapide : l'Assistant de configuration](#démarrage-rapide--lassistant-de-configuration)
- [Configuration manuelle](#configuration-manuelle)
- [Thèmes](#thèmes)
- [Joueurs et listes de joueurs enregistrées](#joueurs-et-listes-de-joueurs-enregistrées)
- [Jeu en direct et tableau de score](#jeu-en-direct-et-tableau-de-score)
- [Ordre des parties (rotations)](#ordre-des-parties-rotations)
- [Tournois (élimination simple, double et round robin)](#tournois-élimination-simple-double-et-round-robin)
- [Tous les joueurs et statistiques de carrière](#tous-les-joueurs-et-statistiques-de-carrière)
- [Page individuelle du joueur](#page-individuelle-du-joueur)
- [Classements des joueurs](#classements-des-joueurs)
- [Son](#son)
- [Notes du jour et rapport quotidien](#notes-du-jour-et-rapport-quotidien)
- [Aide et guide](#aide-et-guide)
- [Mode Focus](#mode-focus)
- [Sauvegarde, import/export et sécurité des données](#sauvegarde-importexport-et-sécurité-des-données)
- [Les noms ne sont pas sensibles à la casse](#les-noms-ne-sont-pas-sensibles-à-la-casse)
- [Données et confidentialité](#données-et-confidentialité)
- [Lancer l'application](#lancer-lapplication)
- [Tests](#tests)
- [Structure du projet](#structure-du-projet)

## Démarrage rapide : l'Assistant de configuration

La façon la plus rapide de démarrer une partie est le bouton **🧙 Démarrer l'assistant** en haut de la page. Il vous guide à travers tout ce qu'il faut pour commencer à jouer en cinq étapes courtes, chacune expliquée en langage simple.

![Assistant de configuration, étape 1 : choix du type et du format de partie](docs/screenshots/wizard-step1.jpg)

1. **Type de partie et format** — choisissez le jeu (8-Ball, 9-Ball, Straight Pool, Un Trou, etc.) et comment vous voulez jouer :
   - **Individuel** — jeu décontracté, pas d'objectif fixe.
   - **Course à** — le premier à atteindre un nombre cible de victoires ; l'assistant vous demande ce nombre. C'est aussi un Tournoi — voir [Tournois](#tournois-élimination-simple-double-et-round-robin).
   - **Tournoi à élimination** — passe directement à la configuration du tableau décrite plus bas au lieu d'une session classique.
2. **Joueurs** — chargez une liste de joueurs déjà enregistrée, ajoutez de nouveaux joueurs, ou les deux.
3. **En jeu vs Standby** — activez « En jeu » pour tous les participants à cette partie ; ceux laissés en « Standby » ne jouent pas mais restent dans la liste pour plus tard. Au moins deux joueurs doivent être marqués En jeu pour continuer.
4. **Rotation** — une question oui/non en langage simple : « Voulez-vous alterner automatiquement entre les types de partie ? » Répondre oui affiche le même outil de création de rotation décrit dans [Ordre des parties](#ordre-des-parties-rotations) ; répondre non passe directement au résumé.
5. **Vérifier et démarrer** — un résumé de chaque choix effectué. Appuyer sur **Démarrer la partie** applique tout, bascule en [Mode Focus](#mode-focus), et ferme l'assistant. Choisir Tournoi à élimination à l'étape 1 transforme ce bouton en **Aller à la configuration du tournoi**, qui vous redirige vers la page du tournoi à la place.

Annuler l'assistant à tout moment est sans risque — tout joueur ajouté ou changement de rotation effectué est déjà enregistré (de la même façon que si vous aviez utilisé les panneaux directement), donc rien n'est perdu ni annulé.

## Configuration manuelle

Vous préférez tout configurer vous-même plutôt que d'utiliser l'assistant ? La page principale propose les mêmes contrôles disposés en panneaux, de haut en bas : **Sauvegarde et transfert** (replié par défaut — appuyez sur le chevron pour déplier), **Ordre des parties**, **Partie en cours**, et **Joueurs**.

![Panneaux Ordre des parties et Partie en cours](docs/screenshots/setup-panels.jpg)

- **Partie en cours** — choisissez le type de partie, le nombre objectif, et son unité (rack/billes/points — modifiable indépendamment du réglage habituel du type de partie, donc par ex. Un Trou peut viser « 1 rack » au lieu de son habituel « 8 billes »), le mode Individuel vs Équipes, et l'objectif de victoires pour toute la session.
- **Ordre des parties** — voir [plus bas](#ordre-des-parties-rotations).
- **Joueurs** — voir [plus bas](#joueurs-et-listes-de-joueurs-enregistrées).

## Thèmes

![Le sélecteur de thème, épinglé en haut à droite](docs/screenshots/themes.jpg)

Un menu déroulant **🎨 Thème**, épinglé dans le coin supérieur droit réel de la fenêtre sur chaque page, change les couleurs et la police de toute l'application en un geste et se souvient du choix d'un rechargement à l'autre (appliqué de façon synchrone avant l'affichage de la page, donc pas de flash du mauvais thème). Dix palettes, regroupées dans le menu :

- **Sombre** — Feutrine cramoisie (l'apparence d'origine, et le réglage par défaut), Bande émeraude, Arcade néon (police à chasse fixe), Ivoire minuit (police à empattements), Craie du couchant, Casse obsidienne.
- **Clair** — Craie de l'aube et Salon nacré, de véritables palettes en mode clair plutôt qu'un simple thème sombre éclairci.
- **Contraste élevé** — Contraste noir (noir/jaune/blanc) et Contraste papier (blanc/noir/bleu), pour une lisibilité maximale.

Chaque couleur qui doit se lire clairement sur un fond de couleur d'accent (boutons, interrupteurs, badges) est calculée par thème pour rester lisible selon les critères WCAG plutôt que supposée — donc un bouton ne se retrouve jamais avec un texte à peine lisible juste parce que la couleur d'accent d'un thème est sombre. Le fond des graphiques (voir [Tous les joueurs](#tous-les-joueurs-et-statistiques-de-carrière)) reçoit le même traitement par thème : un léger lavis teinté de la couleur d'accent du thème, jamais un gris neutre uni.

## Joueurs et listes de joueurs enregistrées

![Panneau Joueurs : liste, listes enregistrées, et export/import](docs/screenshots/players-panel.jpg)

- **Ajouter un joueur** en tapant un nom et en appuyant sur **Ajouter**. Les noms sont automatiquement mis en majuscule (« bob dupont » → « Bob Dupont ») et vérifiés en direct pour les doublons — le bouton Ajouter reste désactivé et une note rouge explique le conflit si le surnom est déjà dans la liste ; ajoutez un nom de famille ou une initiale pour distinguer deux joueurs.
- **Standby / En jeu** — appuyez sur le badge d'un joueur pour l'ajouter ou le retirer de la partie en cours sans le retirer de la liste.
- **Retirer un joueur** (✕) le retire seulement de la liste active d'aujourd'hui — ses statistiques de carrière et son historique de parties restent sur l'appareil et continuent d'apparaître sur la [page Tous les joueurs](#tous-les-joueurs-et-statistiques-de-carrière).
- **Listes de joueurs enregistrées** — choisissez une liste précédemment enregistrée dans le menu déroulant et appuyez sur **Charger une liste de joueurs** pour ajouter tous ceux de cette liste qui ne sont pas déjà dans la liste actuelle (les joueurs existants et toute partie en cours ne sont jamais modifiés ni réinitialisés).
- **Sauvegarde automatique** — chaque fois que la liste change réellement (un joueur ajouté, retiré, ou une liste enregistrée chargée) ou qu'une nouvelle partie est comptabilisée, l'application vérifie si cet ensemble exact de joueurs est déjà enregistré. Si ce n'est pas le cas, il est enregistré comme nouvelle entrée dans le menu déroulant *et* un nouveau fichier de sauvegarde JSON est automatiquement téléchargé — donc chaque groupe distinct avec lequel vous avez déjà joué est à portée d'un clic, sans sauvegarde manuelle nécessaire.
- **Exporter / Importer des listes de joueurs** — un format JSON dédié, modifiable à la main (séparé de la sauvegarde complète des données) pour écrire ou modifier des listes de joueurs en dehors de l'application. L'import accepte ce format, la liste de joueurs d'une sauvegarde complète, ou même un simple tableau de noms, et ne crée jamais de doublons lors d'imports répétés.
- **Accéder à la page de statistiques d'un joueur** — partout où le nom d'un joueur apparaît (le tableau de score, le Classement, une carte de match de tournoi, Tous les joueurs), un petit bouton icône juste à côté ouvre en un geste la [page de statistiques](#page-individuelle-du-joueur) de ce joueur.

## Jeu en direct et tableau de score

![Tableau de score en cours de session](docs/screenshots/live-scoreboard.jpg)

- Appuyez sur **+** / **−** sur la carte d'un joueur pour suivre les billes, points, ou racks vers l'objectif de la partie en cours ; chaque appui positif/négatif distinct joue sa propre tonalité synthétisée (pas de fichiers audio — voir [Son](#son)).
- Atteindre l'objectif de la partie enregistre une victoire pour ce joueur (ou cette équipe) et démarre automatiquement la partie suivante.
- **Victoire de tournoi** — la progression de chaque carte vers l'objectif de victoires de la session (un grand nombre en gras qui se lit d'un coup d'œil depuis l'autre bout de la table). L'atteindre est une victoire de Tournoi — voir [Tournois](#tournois-élimination-simple-double-et-round-robin).
- Le **Classement** montre la progression en direct vers l'objectif de victoires, par équipe et individuellement.
- Les **pop-up Objectif, Sur la colline, et Partie changée** célèbrent une victoire de course, avertissent quand quelqu'un est à une victoire de l'objectif, et annoncent quand la rotation change de type de partie. Gagner tout l'objectif de course jusqu'à N joue la même fanfare Ode à la Joie qu'un champion de Tournoi à élimination — voir [Son](#son).
- **« Ne pas enregistrer les statistiques de parties et de joueurs »** — cochez pour jouer une session purement en mémoire : rien n'est enregistré (ni état, ni statistiques de carrière, ni classements) tant que ce n'est pas décoché. Les victoires comptent quand même en direct à l'écran pour le reste de cet onglet du navigateur, mais rien ne survit à un rechargement — utile pour une session d'entraînement jetable qui ne doit pas compter.
- **Annuler la dernière victoire**, **Réinitialiser la partie en cours**, **Partager le classement** (e-mail pré-rempli), et **Exporter la session** (JSON) sont tous à un geste de distance.
- **Nouvelle partie** démarre une session neuve ; s'il y a des parties non sauvegardées, l'application propose de les enregistrer d'abord dans les statistiques de carrière, de passer la sauvegarde, ou d'annuler.
- **Parties récentes** liste tout ce qui a été joué cette session.

## Ordre des parties (rotations)

Activez **Alterner automatiquement les types de partie** pour que l'application enchaîne toute seule une séquence de *règles* de jeu — par exemple, un rack de 8-Ball, puis trois racks de 8-Ball, puis 9-Ball.

- Chaque étape de l'ordre est sa propre règle — type de partie, nombre objectif et unité — pas juste un type de partie, donc le même type de partie peut apparaître plus d'une fois avec des règles différentes (« 8-Ball — 1 rack » et « 8-Ball — 3 racks » comme deux étapes distinctes). Construisez l'ordre avec le menu déroulant du type de partie plus un champ objectif et unité, et **+ Ajouter à l'ordre** ; réorganisez ou supprimez des entrées avec les contrôles ↑ / ↓ / ✕, ou modifiez l'objectif/l'unité d'une étape directement dans la liste. La liste montre toujours la règle complète de chaque étape, pas juste son type de partie.
- **Changer tous les N parties** contrôle la fréquence de progression, et la ligne de statut montre toujours la règle actuelle, la suivante, et combien de parties restent avant le changement.
- Les **rotations enregistrées** fonctionnent exactement comme les listes de joueurs enregistrées : choisissez-en une dans le menu **Charger une rotation** pour remplacer entièrement l'ordre actuel (une séquence n'est pas quelque chose à fusionner), et toute séquence vraiment nouvelle que vous créez est automatiquement enregistrée comme nouvelle entrée chargeable dès qu'elle est configurée ou qu'une partie est jouée avec elle.

## Tournois (élimination simple, double et round robin)

![Round Robin : classement en direct plus tous les matchs à la fois](docs/screenshots/tournament-roundrobin.jpg)

Appuyez sur **🏆 Tournoi** (ou choisissez Tournoi à élimination dans l'assistant) pour lancer un tableau à élimination directe — ou un round robin — au lieu d'une session classique.

**Format** — trois choix, chacun expliqué directement avant de le sélectionner :

- **Double élimination** — perdez une fois, descendez dans un tableau des perdants pour une seconde chance ; perdez deux fois et c'est fini. Le réglage par défaut : plus équitable, mais plus long.
- **Élimination simple** — perdez une fois et c'est fini. Plus rapide, sans tableau des perdants ni grande finale.
- **Round Robin** — aucune élimination du tout. Chaque joueur affronte chaque autre joueur exactement une fois (l'ordre des matchs est un tirage aléatoire — il n'y a pas vraiment de têtes de série), et une fois que chaque match a un résultat, celui qui a le plus de victoires en match est champion ; une égalité en tête fait de tous les joueurs à égalité des champions ensemble. Idéal pour un groupe décontracté où tout le monde doit jouer autant de parties, surtout avec un petit groupe.

La configuration est par ailleurs la même quel que soit le format : choisissez le type de partie, l'objectif par match, la course jusqu'à pour chaque match, et cochez qui participe.

- Les **formats à élimination directe** affichent le tableau des vainqueurs (et, en double élimination, le tableau des perdants et la grande finale) sous forme d'arbre horizontal avec des lignes de connexion, pour que la forme complète du tableau soit visible d'un coup d'œil. Les joueurs éliminés sont barrés.
- Le **Round Robin** affiche à la place une liste de **Classement** en direct — classée par victoires en match, mise à jour après chaque match — au-dessus d'une grille de **Matchs** montrant tous les affrontements à la fois (pas seulement ce qui est actuellement jouable), pour toujours avoir une vue complète de ce qui est fait et de ce qui reste.
- Chaque match se joue sur le même tableau de score +/− familier utilisé partout ailleurs ; le match actuellement actif est mis en surbrillance et ne peut pas être déclenché accidentellement une seconde fois.
- Le champion final (ou les co-champions, en cas d'égalité en Round Robin) reçoit une 👑, et la fanfare de fin joue environ une seconde plus tard — voir [Son](#son).
- Chaque rack joué en tournoi compte toujours dans les statistiques de carrière de chaque joueur, son classement, et les graphiques de Tous les joueurs — ce n'est pas un ensemble de données séparé et déconnecté.

### Les sessions course jusqu'à N comptent aussi comme des Tournois

L'objectif de victoires d'une session classique (le compteur **Victoire de tournoi** sur le tableau de score) est un Tournoi dans chaque statistique qui les suit, en plus des Tournois à élimination directe — l'atteindre crédite une victoire de Tournoi au vainqueur (ou à l'équipe gagnante) et une défaite de Tournoi à tous les autres qui jouaient, exactement comme un champion de tableau et les joueurs qu'il a battus. Ceci est dérivé automatiquement de l'historique de partie existant, donc cela s'applique aussi rétroactivement — chaque session course jusqu'à N jamais terminée sur un appareil apparaît dès que cette fonctionnalité est présente, pas seulement les nouvelles à venir.

## Tous les joueurs et statistiques de carrière

![Tous les joueurs, vue en barres](docs/screenshots/all-players-bars.jpg)

Appuyez sur **📊 Tous les joueurs** pour voir tous ceux qui ont déjà joué sur cet appareil — y compris les joueurs qui ne sont plus dans la liste active et ceux qui apparaissent seulement dans l'historique non encore enregistré de cette session.

- **Triez** par pourcentage de victoires, total des victoires, ou nom, et filtrez la **période** affichée (Aujourd'hui, 1 semaine, 1 mois, 6 mois, 1 an, Depuis toujours).
- La **vue en barres** montre Parties jouées / gagnées / perdues sous forme de barres proportionnelles, Tournois joués / gagnés / perdus juste en dessous (affiché seulement pour un joueur ayant réellement participé à un tournoi), et une chronologie de quand chaque joueur a joué.
- **📈 Voir en graphique** bascule à la place vers une courbe cumulative par joueur (voir plus bas).
- **👥 Joueurs actuels uniquement** masque tous ceux qui ne sont pas actuellement dans la liste active, sans rien supprimer — désactivez pour revoir tout le monde.

![Tous les joueurs, vue en graphique, avec bascules de légende](docs/screenshots/all-players-graph.jpg)

En vue graphique, les joueurs actuellement dans la liste affichent immédiatement leur graphique ; tous les autres se replient en un simple nom et un bouton **Afficher le graphique**, pour que la page reste facile à parcourir tout en gardant chaque joueur à un geste de distance. Chaque graphique trace des cumuls dans le temps : **parties simples** jouées/gagnées/perdues (avec une ligne séparée par combinaison de coéquipiers en mode Équipes) à côté des **Tournois** joués/gagnés/perdus — une palette fixe bleu/turquoise/violet qui reste visuellement distincte des lignes de parties simples (et les unes des autres) quel que soit le thème actif. Les courbes sont lissées et sans dépassement, avec un point à chaque donnée réelle et une légende où chaque ligne peut être affichée ou masquée individuellement — les lignes Perdues démarrent masquées par défaut pour réduire l'encombrement.

**Appuyez sur n'importe quel point** pour ouvrir une petite fenêtre juste à côté : pour un point de parties simples ou de Tournois, tous les adversaires derrière ce point et le bilan victoires/défaites contre chacun (« vs Bob — 3 victoires, 1 défaite ») ; pour un point de **Classement** (le graphique séparé en dessous, qui suit le classement de ce joueur sur la même période), le classement exact à ce point, l'évolution propre de ce joueur pour cette partie, et l'évolution du classement de chaque adversaire pour la même partie, pour qu'il soit clair qui a gagné et qui a perdu. Appuyez ailleurs pour fermer.

L'axe horizontal va toujours jusqu'à « maintenant », avec des graduations correspondant à la période sélectionnée (heures pour Aujourd'hui, jours pour une semaine/mois, dates pour une année). Le nom de chaque joueur affiche son [classement](#classements-des-joueurs) actuel sous forme de petit badge, et chaque carte montre à quel point ce classement a évolué pendant la période sélectionnée (par ex. « ▲ +18 »).

## Page individuelle du joueur

![Page de statistiques d'un joueur, avec graphique](docs/screenshots/player-stats-page.jpg)

Appuyez sur le nom d'un joueur (ou son petit bouton icône) n'importe où dans l'application pour ouvrir sa propre page. Un menu déroulant directement dans l'en-tête permet de passer directement à n'importe quel autre joueur connu sans repasser par Tous les joueurs.

- **Résumé des statistiques** — classement actuel et son évolution cette période, victoires/défaites/% de victoires en parties simples, et Tournois joués/gagnés/perdus, pour Aujourd'hui, Cette semaine, Ce mois, Cette année, ou Depuis toujours.
- **Face-à-face** — bilan victoires/défaites contre chaque adversaire affronté.
- **Graphique** — le même graphique cumulatif (et les infobulles au clic) que sur la page Tous les joueurs, limité à ce joueur seul, plus son graphique de Classement.
- **Cette session (en direct)** — ce qu'il a fait dans la partie actuellement en cours.
- **Historique des sessions** — chaque session passée enregistrée, extensible pour voir les parties individuelles jouées.
- **Exporter les statistiques** enregistre la session en direct actuelle dans son historique permanent ; **Réinitialiser les statistiques** efface uniquement l'historique enregistré de ce joueur (son nom reste dans la liste Tous les joueurs s'il est toujours dans la liste active ou a des parties non sauvegardées ; son classement n'est pas affecté — il vit dans son propre espace).

## Classements des joueurs

Chaque joueur a un classement automatique de style Elo inspiré de l'échelle publiée par [FargoRate](https://fargorate.com/) — le système de classement derrière la USA Pool League et la plupart des ligues américaines compétitives. C'est une échelle d'environ 0–900 où un écart de 100 points entre deux classements correspond à un ratio de victoire attendu d'environ 2:1, doublant tous les 100 points (donc 200 points d'écart donne environ 4:1, 300 environ 8:1). Les nouveaux joueurs démarrent à **400**.

- Le classement s'affiche comme un petit badge à côté du nom d'un joueur partout où un nom apparaît — la liste, le tableau de score, les cartes de match de tournoi, Tous les joueurs, et la page de statistiques du joueur.
- Il se met à jour automatiquement après chaque partie comptabilisée (tableau principal ou rack de tournoi), y compris les parties en équipe (le classement moyen de chaque côté est utilisé pour le calcul de probabilité de victoire, et l'évolution résultante s'applique également à chaque membre de ce côté). Les joueurs nouveaux ou peu classés évoluent plus vite pour leurs 20 premières parties, puis plus lentement une fois établis.
- Cliquez sur un point du graphique de Classement (Tous les joueurs ou la page de statistiques du joueur) pour voir exactement ce qui s'est passé à ce point — voir [Tous les joueurs](#tous-les-joueurs-et-statistiques-de-carrière).
- **Il n'y a aucun moyen de modifier un classement à la main.** Il n'évolue jamais autrement que par des parties enregistrées.
- Les classements vivent dans leur propre espace de stockage indexé par nom, séparé des statistiques de carrière, donc ils survivent au retrait d'un joueur de la liste et ne sont pas affectés par Réinitialiser toutes les statistiques. Ils sont inclus dans la sauvegarde/l'import complet des données.

C'est une implémentation entièrement recréée pour correspondre aux cotes et à l'échelle *publiées* de FargoRate — pas un clone rétro-conçu de l'algorithme propre de Fargo, qui recalcule le classement de chaque joueur ensemble dans une optimisation globale quotidienne propriétaire et n'est pas quelque chose qui peut tourner côté client dans une application statique.

## Son

Chaque son est synthétisé à la volée avec l'API Web Audio — pas de fichiers audio, rien à télécharger. Une victoire ou une défaite joue une courte tonalité ; atteindre un objectif de course jusqu'à N (une session classique ou un Tournoi à élimination) joue une fanfare plus importante : le thème principal complet à 30 notes de la 9e Symphonie de Beethoven (« Ode à la Joie »), joué grave et enveloppé d'une traîne de réverbération synthétique pour une sensation profonde et triomphante, démarrant environ une seconde après l'annonce de la victoire pour ne pas empiéter sur l'annonce elle-même.

## Notes du jour et rapport quotidien

![Panneau Notes du jour, avec une note enregistrée et des badges de classement visibles sur le tableau de score](docs/screenshots/day-notes.jpg)

Une zone de texte libre sur la page principale pour noter tout ce qui concerne la partie du jour — qui est en feu, les moments drôles, tout ce qui vaut la peine d'être retenu. Elle s'enregistre automatiquement au fil de la frappe, indexée par date du calendrier.

**Copier le rapport**, **Envoyer le rapport par e-mail**, et **Envoyer le rapport par SMS** construisent tous le même résumé du jour en texte brut — chaque joueur ayant joué aujourd'hui avec son bilan victoires/défaites et l'évolution de son classement, le total de parties jouées et quels types de partie, et vos notes — puis le copient dans le presse-papiers, l'ouvrent dans un e-mail pré-rempli, ou l'ouvrent dans un message texte pré-rempli, prêt à envoyer tel quel. Le rapport est construit à partir d'une fusion des sessions en direct et enregistrées pour la date du jour, donc il reste précis même si « Nouvelle partie » a été utilisé plus tôt le même jour.

## Aide et guide

![La superposition Aide et guide, ouverte sur la section Page principale](docs/screenshots/help-guide.jpg)

Appuyez sur **❓ Aide** — présent sur chaque page (la page principale, l'Assistant de configuration, Tous les joueurs, Tournoi, et la page de statistiques du joueur) — pour ouvrir un guide unique couvrant chaque fonctionnalité de chaque page. Il est contextuel : l'ouvrir vous amène directement à la section de la page où vous êtes actuellement, avec une navigation rapide pour parcourir le reste. Le titre, l'introduction, et la navigation restent épinglés en haut pendant que vous faites défiler une section.

## Mode Focus

Appuyez sur **Mode Focus** (ou terminez l'Assistant de configuration) pour masquer tous les panneaux de configuration/statistiques et n'afficher que le tableau de score en direct — idéal une fois que tout le monde est prêt à jouer et que vous voulez juste les compteurs de billes à l'écran. Appuyez sur **Tout afficher** pour retrouver le reste de la page.

## Sauvegarde, import/export et sécurité des données

![Panneau Sauvegarde et transfert, déplié](docs/screenshots/backup-panel.jpg)

Tout vit dans le stockage local du navigateur sur cet appareil précis — il n'y a pas de synchronisation cloud — donc le panneau Sauvegarde et transfert (en haut de la page, appuyez sur le chevron pour déplier) est la façon de déplacer ou de protéger vos données :

- **Exporter toutes les données** télécharge un seul fichier JSON contenant l'image complète : la session en direct, chaque liste de joueurs enregistrée, chaque rotation enregistrée, les statistiques de carrière de chaque joueur, et le classement de chaque joueur (nombre actuel plus historique complet).
- **Importer des données** relit ce fichier. Si l'appareil est tout neuf (pas encore de joueurs), il adopte la sauvegarde telle quelle ; sinon il *fusionne* : statistiques de carrière, listes enregistrées, et classements sont combinés sans compter deux fois les parties déjà connues des deux côtés (l'historique d'un classement est fusionné par union et sa valeur actuelle recalculée à partir de l'historique combiné et trié chronologiquement), les nouveaux joueurs (y compris ceux qui apparaissent seulement dans une liste enregistrée importée) sont ajoutés à la liste, et la partie actuellement en cours n'est pas modifiée.
- **Réinitialiser toutes les statistiques** efface l'historique de carrière enregistré de tout le monde (pas la session en direct). Cela télécharge toujours une sauvegarde complète d'abord et demande confirmation, car sinon c'est irréversible.
- **Réinitialiser les listes de joueurs** efface chaque liste de joueurs enregistrée du menu déroulant « Charger une liste de joueurs », de la même façon : sauvegarde d'abord, demande confirmation, et la sauvegarde peut être restaurée plus tard avec **Importer des listes de joueurs**.

## Les noms ne sont pas sensibles à la casse

« Bob » et « bob » sont toujours traités comme la même personne. Taper un nom qui correspond à quelqu'un déjà connu (dans la liste, dans les statistiques de carrière, ou dans l'historique de partie non enregistré) réutilise sa capitalisation existante au lieu de créer un second joueur fragmenté ; un nom tout neuf a sa première lettre (et la première lettre de chaque mot) mise en majuscule automatiquement. Si deux entrées existaient déjà avec une casse différente avant l'arrivée de ce comportement, l'application fusionne discrètement leur historique au prochain chargement.

## Données et confidentialité

Toutes les données — joueurs, statistiques, rotations, tournois, tout — restent dans le stockage local du navigateur sur l'appareil utilisé. Rien n'est envoyé à un serveur. Effacer les données de site de votre navigateur pour cette page, ou changer d'appareil/de navigateur, repart de zéro à moins d'avoir exporté et importé une sauvegarde au préalable.

## Lancer l'application

C'est un site statique — pas d'étape de build ni de dépendances.

- **En local :** ouvrez `index.html` dans un navigateur, ou servez le dossier (par ex. `python3 -m http.server`) et visitez-le.
- **En ligne :** activez GitHub Pages pour ce dépôt (Paramètres → Pages → déployer depuis la branche `main`) et c'est en ligne à `https://<nomutilisateur>.github.io/Pool-master-counter/`.

Trois autres branches existent à côté de `main` :

- **`stable`** — un instantané de `main` à des points stables connus, avancé (fast-forward) uniquement sur demande explicite. Même code source non minifié que `main`.
- **`release`** — une version minifiée (via `rjsmin`/`rcssmin`) du dernier `main`, reconstruite à chaque fois plutôt que comparée par diff, puisqu'il s'agit purement d'un résultat dérivé.
- **`tests`** — la suite de tests navigateur décrite ci-dessous. Elle ne touche jamais à l'empreinte sans dépendance propre de l'application sur `main`.

## Tests

Une suite complète de tests navigateur Selenium/pytest vit sur la branche [`tests`](../../tree/tests) — elle pilote l'application réelle dans Chrome sans interface graphique contre son propre serveur de fichiers statiques (pas d'étape de build, correspondant à la façon dont l'application est réellement livrée), avec un `localStorage` propre pour chaque test. Elle est tenue à l'écart de `main` pour que l'application livrée reste exactement aussi dépourvue de dépendances que décrit ci-dessus ; seule la suite de tests elle-même a besoin de paquets Python.

La couverture inclut le démarrage à froid, le calcul de score/la détection de victoire/l'annulation/la superposition d'objectif du tableau de score, les 10 thèmes (y compris la correction de la couleur de fond du graphique), les vues en barres/graphique de Tous les joueurs (y compris un test de non-régression pour la correction du débordement de graphique), le résumé/sélecteur/infobulles de points de Statistiques du joueur, un Tournoi à tableau complet joué jusqu'au bout, et la garantie de persistance du mode sans statistiques. Voir `tests/README.md` sur cette branche pour les instructions d'installation et d'exécution.

## Structure du projet

- `index.html` — balisage pour chaque vue : le tableau de score principal, l'Assistant de configuration, la page Tournoi, la page Tous les joueurs, et la page individuelle du joueur
- `css/style.css` — style réactif et tactile, couleurs de thème, et mise en page pour chaque panneau et superposition
- `js/app.js` — tout l'état de l'application, la persistance localStorage, la synthèse sonore, et la logique d'interface (une seule IIFE, sans framework)
- `docs/screenshots/` — les captures d'écran utilisées dans ce README
- `players/`, `settings/`, `stats/` — fichiers de données hérités d'une version antérieure de l'application qui stockait les données en JSON versionné dans le dépôt ; conservés uniquement pour que le premier lancement d'un appareil puisse migrer cet historique vers le stockage local. L'application n'écrit plus jamais dans ces dossiers.
