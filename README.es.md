# Pool Master Counter

[🇬🇧 English](README.md) · [🇫🇷 Français](README.fr.md) · **🇪🇸 Español** · [🇭🇰 廣東話](README.zh-yue.md)

Una aplicación de conteo de puntos de billar pensada para pantallas táctiles, en teléfono, tableta u ordenador. Funciona por completo en el navegador — sin servidor, sin cuenta, sin paso de compilación — y recuerda todo en el dispositivo donde se usa: tu lista de jugadores, estadísticas de carrera, clasificaciones de jugadores, listas de jugadores guardadas, rotaciones de orden de partida, cuadros de torneo, y notas diarias.

![Marcador en vivo](docs/screenshots/live-scoreboard.jpg)

## Índice

- [Inicio rápido: el Asistente de configuración](#inicio-rápido-el-asistente-de-configuración)
- [Configuración manual](#configuración-manual)
- [Temas](#temas)
- [Jugadores y listas de jugadores guardadas](#jugadores-y-listas-de-jugadores-guardadas)
- [Juego en vivo y marcador](#juego-en-vivo-y-marcador)
- [Orden de partidas (rotaciones)](#orden-de-partidas-rotaciones)
- [Torneos (eliminación simple, doble y round robin)](#torneos-eliminación-simple-doble-y-round-robin)
- [Todos los jugadores y estadísticas de carrera](#todos-los-jugadores-y-estadísticas-de-carrera)
- [Página individual del jugador](#página-individual-del-jugador)
- [Clasificaciones de jugadores](#clasificaciones-de-jugadores)
- [Sonido](#sonido)
- [Notas de hoy e informe del día](#notas-de-hoy-e-informe-del-día)
- [Ayuda y guía](#ayuda-y-guía)
- [Modo Enfoque](#modo-enfoque)
- [Copia de seguridad, importar/exportar y seguridad de datos](#copia-de-seguridad-importarexportar-y-seguridad-de-datos)
- [Los nombres no distinguen mayúsculas de minúsculas](#los-nombres-no-distinguen-mayúsculas-de-minúsculas)
- [Datos y privacidad](#datos-y-privacidad)
- [Cómo ejecutarlo](#cómo-ejecutarlo)
- [Pruebas](#pruebas)
- [Estructura del proyecto](#estructura-del-proyecto)

## Inicio rápido: el Asistente de configuración

La forma más rápida de empezar una partida es el botón **🧙 Iniciar asistente** en la parte superior de la página. Te guía por todo lo necesario para empezar a jugar en cinco pasos breves, explicando cada uno en lenguaje sencillo.

![Asistente de configuración, paso 1: elegir un tipo y formato de partida](docs/screenshots/wizard-step1.jpg)

1. **Tipo de partida y formato** — elige el juego (8-Ball, 9-Ball, Straight Pool, Un Solo Agujero, etc.) y cómo quieres jugar:
   - **Individual** — juego informal, sin meta fija.
   - **Carrera a** — el primero en alcanzar un número meta de victorias; el asistente te pide ese número. Esto también es un Torneo — ver [Torneos](#torneos-eliminación-simple-doble-y-round-robin).
   - **Torneo de eliminación** — salta directamente a la configuración del cuadro descrita más abajo en lugar de una sesión normal.
2. **Jugadores** — carga una lista de jugadores ya guardada, añade jugadores nuevos, o ambas cosas.
3. **Jugando vs Standby** — activa «Jugando» para todos los que participen en esta partida; quien quede en «Standby» no juega pero permanece en la lista para más tarde. Se necesitan al menos dos jugadores marcados como Jugando para continuar.
4. **Rotación** — una pregunta de sí/no en lenguaje sencillo: «¿Quieres alternar automáticamente entre tipos de partida?». Elegir sí muestra el mismo creador de rotaciones descrito en [Orden de partidas](#orden-de-partidas-rotaciones); elegir no salta directo al resumen.
5. **Revisar e iniciar** — un resumen de cada elección hecha. Pulsar **Iniciar partida** aplica todo, cambia al [Modo Enfoque](#modo-enfoque), y cierra el asistente. Elegir Torneo de eliminación en el paso 1 convierte esto en **Ir a la configuración del torneo**, que te lleva a la página del torneo en su lugar.

Cancelar el asistente en cualquier momento es seguro — cualquier jugador añadido o cambio de rotación hecho ya está guardado (igual que si hubieras usado los paneles directamente), así que nada se pierde ni se revierte.

## Configuración manual

¿Prefieres configurar las cosas tú mismo en lugar del asistente? La página principal tiene los mismos controles dispuestos como paneles, de arriba a abajo: **Copia de seguridad y transferencia** (contraído por defecto — toca la flecha para expandir), **Orden de partidas**, **Partida actual**, y **Jugadores**.

![Paneles de Orden de partidas y Partida actual](docs/screenshots/setup-panels.jpg)

- **Partida actual** — elige el tipo de partida, el número meta, y su unidad (rack/bolas/puntos — ajustable independientemente del valor habitual del tipo de partida, así que p. ej. Un Solo Agujero puede tener como meta «1 rack» en lugar de sus habituales «8 bolas»), el modo Individual vs Equipos, y la meta de victorias para toda la sesión.
- **Orden de partidas** — ver [más abajo](#orden-de-partidas-rotaciones).
- **Jugadores** — ver [más abajo](#jugadores-y-listas-de-jugadores-guardadas).

## Temas

![El selector de tema, fijado en la esquina superior derecha](docs/screenshots/themes.jpg)

Un menú desplegable **🎨 Tema**, fijado en la esquina superior derecha real de la ventana en cada página, cambia los colores y la fuente de toda la aplicación con un toque y recuerda la elección entre recargas (se aplica de forma síncrona antes de que la página se pinte, así que no hay parpadeo del tema incorrecto). Diez paletas, agrupadas en el desplegable:

- **Oscuro** — Fieltro carmesí (el aspecto original, y el predeterminado), Banda esmeralda, Arcade neón (fuente monoespaciada), Marfil de medianoche (fuente serif), Tiza del atardecer, Rotura de obsidiana.
- **Claro** — Tiza del amanecer y Salón perla, paletas genuinas en modo claro en lugar de solo un tema oscuro aclarado.
- **Alto contraste** — Contraste apagón (negro/amarillo/blanco) y Contraste papel (blanco/negro/azul), para máxima legibilidad.

Cada color que necesita leerse con claridad sobre un fondo de color de acento (botones, interruptores, insignias) se calcula por tema para mantenerse legible según WCAG en lugar de asumirse — así un botón nunca termina con texto apenas legible solo porque el color de acento de un tema resulte ser oscuro. El fondo propio de los gráficos (ver [Todos los jugadores](#todos-los-jugadores-y-estadísticas-de-carrera)) recibe el mismo tratamiento por tema: un tenue lavado teñido del color de acento propio de ese tema, nunca un gris neutro plano.

## Jugadores y listas de jugadores guardadas

![Panel de Jugadores: lista, listas guardadas, y exportar/importar](docs/screenshots/players-panel.jpg)

- **Añade un jugador** escribiendo un nombre y tocando **Añadir**. Los nombres se ponen en mayúscula automáticamente («bob garcía» → «Bob García») y se verifican en vivo por duplicados — el botón Añadir permanece deshabilitado y una nota roja explica el conflicto si el apodo ya está en la lista; añade un apellido o inicial para distinguir a dos jugadores.
- **Standby / Jugando** — toca la insignia de un jugador para moverlo dentro o fuera de la partida actual sin quitarlo de la lista.
- **Quitar a un jugador** (✕) lo saca solo de la lista activa de hoy — sus estadísticas de carrera e historial de partidas permanecen en el dispositivo y siguen apareciendo en la [página Todos los jugadores](#todos-los-jugadores-y-estadísticas-de-carrera).
- **Listas de jugadores guardadas** — elige una lista previamente guardada en el desplegable y toca **Cargar lista de jugadores** para añadir a cualquiera de esa lista que aún no esté en la lista actual (los jugadores existentes y cualquier partida en curso nunca se tocan ni se reinician).
- **Guardado automático** — cada vez que la lista realmente cambia (se añade o quita un jugador, o se carga una lista guardada) o se contabiliza una nueva partida, la aplicación verifica si ese conjunto exacto de jugadores ya está guardado. Si no lo está, se guarda como nueva entrada en el desplegable *y* se descarga automáticamente un nuevo archivo de copia de seguridad JSON — así que cada grupo distinto con el que hayas jugado alguna vez está a un clic de distancia, sin necesidad de guardar manualmente.
- **Exportar / Importar listas de jugadores** — un formato JSON dedicado y editable a mano (separado de la copia de seguridad completa de datos) para escribir o ajustar listas de jugadores fuera de la aplicación. Importar acepta ese formato, la lista de jugadores de una copia de seguridad completa, o incluso un simple array de nombres, y nunca crea duplicados en importaciones repetidas.
- **Saltar a la página de estadísticas de un jugador** — dondequiera que aparezca el nombre de un jugador (el marcador, la Clasificación, una tarjeta de partido de torneo, Todos los jugadores), un pequeño botón de icono justo al lado abre la [página de estadísticas](#página-individual-del-jugador) de ese jugador con un toque.

## Juego en vivo y marcador

![Marcador durante una sesión](docs/screenshots/live-scoreboard.jpg)

- Toca **+** / **−** en la tarjeta de un jugador para llevar la cuenta de bolas, puntos, o racks hacia la meta de la partida actual; cada toque positivo/negativo distinto reproduce su propio tono sintetizado (sin archivos de audio — ver [Sonido](#sonido)).
- Alcanzar la meta de la partida registra una victoria para ese jugador (o equipo) e inicia automáticamente la siguiente partida.
- **Victoria de torneo** — el progreso propio de cada tarjeta hacia la meta de victorias de la sesión (un número grande y en negrita que se lee de un vistazo desde el otro lado de la mesa). Completarlo es una victoria de Torneo — ver [Torneos](#torneos-eliminación-simple-doble-y-round-robin).
- La **Clasificación** muestra el progreso en vivo hacia la meta de victorias, tanto por equipo como individualmente.
- Los **avisos de Meta, En la cima, y Partida cambiada** celebran una victoria de carrera, avisan cuando alguien está a una victoria de conseguirla, y anuncian cuando la rotación cambia de tipo de partida. Ganar toda la meta de carrera hasta N reproduce la misma fanfarria Oda a la Alegría que recibe un campeón de Torneo de cuadro — ver [Sonido](#sonido).
- **«No registrar estadísticas de partidas ni datos de jugadores»** — márcalo para jugar una sesión puramente en memoria: nada se guarda (ni estado, ni estadísticas de carrera, ni clasificaciones) hasta que se desmarque. Las victorias siguen contando en vivo en pantalla durante el resto de esta pestaña del navegador, pero nada sobrevive a una recarga — útil para una sesión de práctica desechable que no debe contar.
- **Deshacer última victoria**, **Restablecer partida actual**, **Compartir clasificación** (correo prellenado), y **Exportar sesión** (JSON) están todos a un toque de distancia.
- **Nueva partida** inicia una sesión nueva; si hay partidas sin guardar, ofrece guardarlas primero en las estadísticas de carrera, omitir el guardado, o cancelar.
- **Partidas recientes** lista todo lo jugado en esta sesión.

## Orden de partidas (rotaciones)

Activa **Alternar tipos de partida automáticamente** para que la aplicación recorra por sí sola una secuencia de *reglas* de juego — por ejemplo, un rack de 8-Ball, luego tres racks de 8-Ball, luego 9-Ball.

- Cada paso del orden es su propia regla — tipo de partida, número meta y unidad — no solo un tipo de partida, así que el mismo tipo de partida puede aparecer más de una vez con reglas distintas («8-Ball — 1 rack» y «8-Ball — 3 racks» como dos pasos distintos). Construye el orden con el desplegable de tipo de partida más un campo de meta y unidad, y **+ Añadir al orden**; reordena o elimina entradas con los controles ↑ / ↓ / ✕, o edita la meta/unidad de un paso directamente en la lista. La lista siempre muestra la regla completa de cada paso, no solo su tipo de partida.
- **Cambiar cada N partidas** controla cada cuánto avanza, y la línea de estado siempre muestra la regla actual, la siguiente, y cuántas partidas quedan hasta el cambio.
- Las **rotaciones guardadas** funcionan exactamente como las listas de jugadores guardadas: elige una en el desplegable **Cargar rotación** para reemplazar por completo el orden actual (una secuencia no es algo que se combine), y cualquier secuencia genuinamente nueva que crees se guarda automáticamente como nueva entrada cargable en cuanto se configura o se juega una partida con ella.

## Torneos (eliminación simple, doble y round robin)

![Round Robin: clasificación en vivo más todos los partidos a la vez](docs/screenshots/tournament-roundrobin.jpg)

Toca **🏆 Torneo** (o elige Torneo de eliminación en el asistente) para ejecutar un cuadro de eliminación directa — o un round robin — en lugar de una sesión normal.

**Formato** — tres opciones, cada una explicada en línea antes de elegirla:

- **Doble eliminación** — pierde una vez y bajas a un cuadro de perdedores para una segunda oportunidad; pierde dos veces y quedas eliminado. La opción predeterminada: más justa, pero más larga.
- **Eliminación simple** — pierde una vez y quedas eliminado. Más rápida, sin cuadro de perdedores ni gran final.
- **Round Robin** — sin eliminación alguna. Cada jugador se enfrenta a todos los demás exactamente una vez (el orden de los partidos es aleatorio — no hay siembra propiamente dicha), y una vez que todos los partidos tienen resultado, quien tenga más victorias en partido es el campeón; un empate en primer lugar convierte a todos los empatados en campeones juntos. Lo mejor para un grupo informal donde todos deban jugar la misma cantidad de partidas, especialmente con un grupo pequeño.

La configuración es, por lo demás, la misma sin importar el formato: elige el tipo de partida, la meta por partido, la carrera hasta para cada partido, y marca quién compite.

- Los **formatos de cuadro** muestran el cuadro de Ganadores (y, en doble eliminación, el cuadro de Perdedores y la Gran final) como un árbol horizontal con líneas de conexión, para que toda la forma del cuadro sea visible de un vistazo. Los jugadores eliminados aparecen tachados.
- El **Round Robin** muestra en su lugar una lista de **Clasificación** en vivo — ordenada por victorias en partido, actualizándose después de cada partido — encima de una cuadrícula de **Partidos** que muestra todos los emparejamientos a la vez (no solo lo que actualmente se puede jugar), para tener siempre una vista completa de lo hecho y lo que falta.
- Cada partido se juega en el mismo marcador +/− familiar usado en el resto de la aplicación; el partido actualmente activo aparece resaltado y no puede activarse de nuevo por accidente.
- El campeón eventual (o los co-campeones, en un empate de Round Robin) recibe una 👑, y la fanfarria final suena aproximadamente un segundo después — ver [Sonido](#sonido).
- Cada rack jugado en un torneo sigue contando para las estadísticas de carrera de cada jugador, su clasificación, y los gráficos de Todos los jugadores — no es un conjunto de datos separado y desconectado.

### Las sesiones de carrera hasta N también cuentan como Torneos

La meta de victorias de una sesión normal (el contador **Victoria de torneo** en el marcador) es un Torneo en cada estadística que los rastrea, además de los Torneos de cuadro — alcanzarla acredita una victoria de Torneo al ganador (o equipo ganador) y una derrota de Torneo a todos los demás que estaban jugando, exactamente igual que un campeón de cuadro y los jugadores a los que venció. Esto se deriva automáticamente del historial de partidas existente, así que también se aplica retroactivamente — cada sesión de carrera hasta N completada alguna vez en un dispositivo aparece en cuanto esta función está presente, no solo las nuevas de aquí en adelante.

## Todos los jugadores y estadísticas de carrera

![Todos los jugadores, vista de barras](docs/screenshots/all-players-bars.jpg)

Toca **📊 Todos los jugadores** para ver a todos los que han jugado alguna vez en este dispositivo — incluidos los jugadores que ya no están en la lista activa y cualquiera que solo aparezca en el historial aún no guardado de esta sesión.

- **Ordena** por porcentaje de victorias, total de victorias, o nombre, y filtra el **período** mostrado (Hoy, 1 semana, 1 mes, 6 meses, 1 año, Todo el tiempo).
- La **vista de barras** muestra Partidas jugadas / ganadas / perdidas como barras a escala, Torneos jugados / ganados / perdidos justo debajo (solo se muestra para un jugador que realmente haya participado en uno), y una cronología de cuándo jugó cada jugador.
- **📈 Ver como gráfico** cambia en su lugar a una línea acumulativa por jugador (ver más abajo).
- **👥 Solo jugadores actuales** oculta a todos los que no están actualmente en la lista activa, sin borrar nada — desactívalo para volver a verlos a todos.

![Todos los jugadores, vista de gráfico, con interruptores de leyenda](docs/screenshots/all-players-graph.jpg)

En la vista de gráfico, los jugadores actualmente en la lista muestran su gráfico de inmediato; todos los demás se reducen a solo su nombre y un botón **Mostrar gráfico**, para que la página siga siendo fácil de recorrer mientras cada jugador queda a un toque de distancia. Cada gráfico traza recuentos acumulados a lo largo del tiempo: **partidas individuales** jugadas/ganadas/perdidas (con una línea separada por combinación de compañeros de equipo en modo Equipos) junto a **Torneos** jugados/ganados/perdidos — una paleta fija azul/turquesa/violeta que se mantiene visualmente distinta de las líneas de partidas individuales (y entre sí) sin importar el tema activo. Las curvas están suavizadas y sin sobrepaso, con un punto en cada dato real y una leyenda donde cada línea puede mostrarse u ocultarse individualmente — las líneas de Perdidas empiezan ocultas por defecto para reducir el desorden.

**Toca cualquier punto** para abrir una pequeña ventana justo al lado: para un punto de partidas individuales o de Torneos, cada rival detrás de ese punto y el registro de victorias/derrotas contra cada uno («vs Bob — 3 victorias, 1 derrota»); para un punto de **Clasificación** (el gráfico independiente debajo, que sigue la clasificación de ese jugador en el mismo período), la clasificación exacta en ese punto, el cambio propio de este jugador en esa partida, y el cambio de clasificación de cada rival en la misma partida, para que quede claro quién ganó y quién perdió. Toca en cualquier otro lugar para cerrarla.

El eje horizontal siempre llega hasta «ahora», con graduaciones que coinciden con el período seleccionado (horas para Hoy, días para una semana/mes, fechas para un año). El nombre de cada jugador muestra su [clasificación](#clasificaciones-de-jugadores) actual como una pequeña insignia, y cada tarjeta muestra cuánto ha cambiado esa clasificación en el período seleccionado (p. ej. «▲ +18»).

## Página individual del jugador

![Página de estadísticas de un jugador, con gráfico](docs/screenshots/player-stats-page.jpg)

Toca el nombre de un jugador (o su pequeño botón de icono) en cualquier parte de la aplicación para abrir su propia página. Un desplegable justo en el encabezado permite saltar directamente a cualquier otro jugador conocido sin volver a Todos los jugadores.

- **Resumen de estadísticas** — clasificación actual y cuánto ha cambiado en este período, victorias/derrotas/% de victorias en partidas individuales, y Torneos jugados/ganados/perdidos, para Hoy, Esta semana, Este mes, Este año, o Todo el tiempo.
- **Cara a cara** — registro de victorias/derrotas contra cada rival que ha enfrentado.
- **Gráfico** — el mismo gráfico acumulativo (y las burbujas de información al tocar un punto) usado en la página Todos los jugadores, limitado solo a este jugador, más su gráfico de Clasificación.
- **Esta sesión (en vivo)** — lo que ha hecho en la partida actualmente en curso.
- **Historial de sesiones** — cada sesión pasada guardada, expandible para ver las partidas individuales jugadas.
- **Exportar estadísticas** guarda la sesión en vivo actual en su historial permanente; **Restablecer estadísticas** borra solo el historial guardado de este jugador (su nombre permanece en la lista Todos los jugadores si sigue en la lista activa o tiene partidas sin guardar; su clasificación no se ve afectada — vive en su propio almacén).

## Clasificaciones de jugadores

Cada jugador tiene una clasificación automática de estilo Elo inspirada en la escala que publica [FargoRate](https://fargorate.com/) — el sistema de clasificación detrás de la USA Pool League y la mayoría de las ligas competitivas de EE. UU. Es una escala de aproximadamente 0–900 donde una diferencia de 100 puntos entre dos clasificaciones equivale a una proporción de victoria esperada de aproximadamente 2:1, que se duplica cada 100 puntos (así que 200 puntos de diferencia da aproximadamente 4:1, 300 aproximadamente 8:1). Los jugadores nuevos empiezan en **400**.

- La clasificación se muestra como una pequeña insignia junto al nombre de un jugador dondequiera que aparezca un nombre — la lista, el marcador, las tarjetas de partido de torneo, Todos los jugadores, y la página de estadísticas del jugador.
- Se actualiza automáticamente después de cada partida contabilizada (marcador principal o rack de torneo), incluidas las partidas por equipos (la clasificación promedio de cada lado se usa para el cálculo de probabilidad de victoria, y el cambio resultante se aplica por igual a cada miembro de ese lado). Los jugadores nuevos o poco clasificados cambian más rápido durante sus primeras 20 partidas, luego más lento una vez establecidos.
- Haz clic en un punto del gráfico de Clasificación (Todos los jugadores o la página de estadísticas del jugador) para ver exactamente qué pasó en ese punto — ver [Todos los jugadores](#todos-los-jugadores-y-estadísticas-de-carrera).
- **No hay forma de editar una clasificación a mano.** Solo cambia como resultado de partidas registradas.
- Las clasificaciones viven en su propio almacén indexado por nombre, separado de las estadísticas de carrera, así que sobreviven a que un jugador sea quitado de la lista y no se ven afectadas por Restablecer todas las estadísticas. Están incluidas en la copia de seguridad/importación completa de datos.

Esta es una implementación hecha desde cero para ajustarse a las probabilidades y la escala *publicadas* de FargoRate — no un clon de ingeniería inversa del algoritmo propio de Fargo, que recalcula la clasificación de cada jugador en conjunto en una optimización global diaria propietaria y no es algo que pueda ejecutarse del lado del cliente en una aplicación estática.

## Sonido

Cada sonido se sintetiza al vuelo con la API Web Audio — sin archivos de audio, nada que descargar. Una victoria o derrota reproduce un tono corto; alcanzar una meta de carrera hasta N (una sesión normal o un Torneo de cuadro) reproduce una fanfarria más grande: el tema principal completo de 30 notas de la 9ª Sinfonía de Beethoven («Oda a la Alegría»), afinado grave y envuelto en una cola de reverberación sintética para una sensación profunda y triunfante, que empieza aproximadamente un segundo después de anunciarse la victoria para no pisar el propio anuncio.

## Notas de hoy e informe del día

![Panel de Notas de hoy, con una nota guardada e insignias de clasificación visibles en el marcador](docs/screenshots/day-notes.jpg)

Un cuadro de texto libre en la página principal para anotar cualquier cosa sobre el juego en vivo de hoy — quién está en racha, momentos graciosos, cualquier cosa que valga la pena recordar. Se guarda automáticamente mientras escribes, indexado por fecha del calendario.

**Copiar informe**, **Enviar informe por correo**, y **Enviar informe por SMS** construyen todos el mismo resumen del día en texto plano — cada jugador que jugó hoy con su registro de victorias/derrotas y cambio de clasificación, el total de partidas jugadas y qué tipos de partida, y tus notas — y luego lo copian al portapapeles, lo abren en un correo prellenado, o lo abren en un mensaje de texto prellenado, listo para enviar tal cual. El informe se construye a partir de una combinación de sesiones en vivo y guardadas para la fecha de hoy, así que se mantiene preciso incluso si se usó «Nueva partida» antes ese mismo día.

## Ayuda y guía

![La superposición de Ayuda y guía, abierta en la sección Página principal](docs/screenshots/help-guide.jpg)

Toca **❓ Ayuda** — está en cada página (la página principal, el Asistente de configuración, Todos los jugadores, Torneo, y la página de estadísticas del jugador) — para abrir una única guía que cubre cada función de cada página. Es contextual: abrirla te lleva directo a la sección de la página en la que estés actualmente, con una navegación rápida para recorrer el resto. El título, la introducción, y la navegación permanecen fijos arriba mientras te desplazas por una sección.

## Modo Enfoque

Toca **Modo Enfoque** (o termina el Asistente de configuración) para ocultar todos los paneles de configuración/estadísticas y mostrar solo el marcador en vivo — ideal una vez que todos están listos para jugar y solo quieres los contadores de bolas en pantalla. Toca **Mostrar todo** para recuperar el resto de la página.

## Copia de seguridad, importar/exportar y seguridad de datos

![Panel de Copia de seguridad y transferencia, expandido](docs/screenshots/backup-panel.jpg)

Todo vive en el almacenamiento local del navegador en ese dispositivo — no hay sincronización en la nube — así que el panel Copia de seguridad y transferencia (arriba de la página, toca la flecha para expandir) es cómo mueves o proteges tus datos:

- **Exportar todos los datos** descarga un único archivo JSON que contiene el panorama completo: la sesión en vivo, cada lista de jugadores guardada, cada rotación guardada, las estadísticas de carrera de cada jugador, y la clasificación de cada jugador (número actual más historial completo).
- **Importar datos** vuelve a leer ese archivo. Si el dispositivo es totalmente nuevo (aún sin jugadores), adopta la copia de seguridad tal cual; de lo contrario *combina*: las estadísticas de carrera, listas guardadas, y clasificaciones se combinan sin contar dos veces partidas ya conocidas en ambos lados (el historial de una clasificación se une y su valor actual se recalcula a partir del historial combinado y ordenado cronológicamente), los jugadores nuevos (incluido cualquiera que solo aparezca dentro de una lista guardada importada) se añaden a la lista, y la partida actualmente en curso se deja sin tocar.
- **Restablecer todas las estadísticas** borra el historial de carrera guardado de todos (no la sesión en vivo). Siempre descarga primero una copia de seguridad completa y pide confirmación, ya que de lo contrario no se puede deshacer.
- **Restablecer listas de jugadores** borra todas las listas de jugadores guardadas del desplegable «Cargar lista de jugadores», de la misma manera: hace copia de seguridad primero, pide confirmación, y la copia de seguridad puede restaurarse más tarde con **Importar listas de jugadores**.

## Los nombres no distinguen mayúsculas de minúsculas

«Bob» y «bob» siempre se tratan como la misma persona. Escribir un nombre que coincide con alguien ya conocido (en la lista, en las estadísticas de carrera, o en el historial de partidas sin guardar) reutiliza su capitalización existente en lugar de crear un segundo jugador fragmentado; un nombre completamente nuevo tiene su primera letra (y la primera letra de cada palabra) puesta en mayúscula automáticamente. Si ya existían dos entradas con capitalización distinta antes de que este comportamiento se implementara, la aplicación fusiona discretamente su historial la próxima vez que carga.

## Datos y privacidad

Todos los datos — jugadores, estadísticas, rotaciones, torneos, todo — permanecen en el almacenamiento local del navegador en el dispositivo que estás usando. Nada se envía a un servidor. Borrar los datos del sitio de tu navegador para esta página, o cambiar de dispositivo/navegador, empieza de cero a menos que hayas exportado e importado una copia de seguridad primero.

## Cómo ejecutarlo

Este es un sitio estático — sin paso de compilación ni dependencias.

- **Localmente:** abre `index.html` en un navegador, o sirve la carpeta (p. ej. `python3 -m http.server`) y visítala.
- **En línea:** activa GitHub Pages para este repositorio (Settings → Pages → deploy desde la rama `main`) y estará en vivo en `https://<usuario>.github.io/Pool-master-counter/`.

Existen otras tres ramas junto a `main`:

- **`stable`** — una instantánea de `main` en puntos conocidos como buenos, avanzada (fast-forward) solo cuando se solicita explícitamente. Mismo código fuente sin minificar que `main`.
- **`release`** — una compilación minificada (vía `rjsmin`/`rcssmin`) del último `main`, reconstruida desde cero cada vez en lugar de comparada por diff, ya que es puramente resultado derivado.
- **`tests`** — la suite de pruebas de navegador descrita abajo. Nunca toca la huella propia sin dependencias de la aplicación en `main`.

## Pruebas

Una suite completa de pruebas de navegador Selenium/pytest vive en la rama [`tests`](../../tree/tests) — controla la aplicación real en Chrome sin interfaz gráfica contra su propio servidor de archivos estáticos (sin paso de compilación, igual que la aplicación se distribuye realmente), con un `localStorage` limpio por prueba. Se mantiene fuera de `main` para que la aplicación distribuida siga siendo exactamente tan libre de dependencias como se describe arriba; solo la propia suite de pruebas necesita paquetes de Python.

La cobertura incluye arranque en frío, el marcado de puntos/detección de victoria/deshacer/la superposición de meta del marcador, los 10 temas (incluida la corrección del color de fondo del gráfico), las vistas de barras/gráfico de Todos los jugadores (incluida una prueba de regresión para la corrección del desbordamiento del gráfico), el resumen/selector/burbujas de información de Estadísticas del jugador, un Torneo de cuadro completo jugado hasta el final, y la garantía de persistencia del modo sin estadísticas. Consulta `tests/README.md` en esa rama para las instrucciones de instalación y ejecución.

## Estructura del proyecto

- `index.html` — marcado para cada vista: el marcador principal, el Asistente de configuración, la página de Torneo, la página Todos los jugadores, y la página individual del jugador
- `css/style.css` — estilo receptivo y táctil, colores de tema, y diseño para cada panel y superposición
- `js/app.js` — todo el estado de la aplicación, la persistencia en localStorage, la síntesis de sonido, y la lógica de interfaz (una única IIFE, sin framework)
- `docs/screenshots/` — las capturas de pantalla usadas en este README
- `players/`, `settings/`, `stats/` — archivos de datos heredados de una versión anterior de la aplicación que almacenaba datos como JSON versionado en el repositorio; se conservan solo para que el primer inicio de un dispositivo pueda migrar ese historial al almacenamiento local. La aplicación ya nunca escribe en estas carpetas.
