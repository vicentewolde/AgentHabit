# Decisiones — Fase 1 (MVP en testnet)

> Prefijo `A-`. Cada decisión lleva su motivo y la alternativa descartada. Las que cruzan fases van a
> [`docs/DECISIONES.md`](../DECISIONES.md) con prefijo `P-`. **No se borran entradas:** si una decisión se revierte,
> se marca como `Superada` y se agrega la nueva.
>
> Spec de la fase: [SPEC.md](SPEC.md)

Estados: `Vigente` · `Superada` · `Pendiente`

- **`A-1` a `A-7`:** las propuso Claude Code en T3, a partir de la verificación de la red, del informe de
  `integraciones` sobre Strava y de la revisión del `arquitecto`. El usuario las aprobó con el spec el 16-oct.
- **`A-8` a `A-11`:** las decidió el usuario el 16-oct, en las preguntas de T3.
- **`A-12` a `A-14`:** las tomó Claude Code en T4, donde el spec dejaba la cifra o el detalle a esa tarea. Se
  revisan con `/revisar` antes del merge.
- **`A-15` a `A-21`:** las tomó Claude Code en T5 (`A-19` a `A-21` tras `/revisar`), con lo verificado por `integraciones` en
  `docs/integraciones/strava.md` y `firmas.md`. El usuario pidió seguir sin pedirle aprobación; se revisan con
  `/revisar` antes del merge.
- Las referencias a tareas usan la numeración agrupada del 16-oct (T4 a T9; ver el registro de cambios del spec).

---

### A-1 · Liquidación con un Cron Job diario, no semanal · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T6 y T8)

El liquidador corre todos los días a las 03:30 UTC y, de forma idempotente, hace tres cosas:
- liquida lo que está en su ventana;
- llama a `release_if_stale` para lo vencido;
- purga los datos de Strava vencidos.

**Motivo.** La ventana de `settle` abre el miércoles a las 03:00 UTC y cierra 5 días después. Un cron semanal que
fallara una sola vez recién volvería a intentar con la ventana cerrada. Entonces la posición se devolvería aunque
el usuario no hubiera cumplido. Un cron diario da cinco reintentos dentro de la ventana.

**Alternativa descartada:** el cron del mensaje inicial, el miércoles a las 03:00 UTC. Además de no tener
reintentos, corre justo en el borde de la ventana, y cualquier adelanto del reloj lo deja afuera.

---

### A-2 · El oráculo encuentra las posiciones en un espejo verificado, no en los eventos · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T5, T6 y T7)

Así funciona el espejo:
1. Tras un `commit`, la web informa la posición a la API.
2. La API la lee con `get_position` en la cadena, verifica el hash y la guarda.
3. Congela el `athlete_id` vinculado en ese momento.

La clave es `(cadena, dirección del contrato, usuario, week_id)`. El liquidador vuelve a leer la posición en la
cadena antes de actuar.

**Motivo.**
- El 16-oct, la RPC pública de Stellar testnet guardaba ~19 h de eventos (`getHealth`), aunque anuncia 7 días.
- Un `commit` puede tener más de una semana cuando se liquida.
- La RPC pública de Fuji limita el rango de `eth_getLogs`.

Una posición que la web no informó no se pierde: vence y vuelve por `release_if_stale`, que el usuario puede llamar
desde el botón "recuperar".

**Alternativa descartada:** descubrir las posiciones leyendo los eventos `Committed`. Depende de la retención de un
proveedor de RPC, y en Stellar ya hoy no alcanza.

---

### A-3 · La tabla de casos vive en `packages/core` y se exporta a `contracts/fixtures/cases.json` · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T4)

- **Dónde vive.** La tabla se escribe como datos en `packages/core`. `scripts/gen-cases.ts` la exporta a un JSON
  plano, que se commitea.
- **Desvío.** Un test de `pnpm check` falla si el JSON quedó desactualizado.
- **Lectura.** Rust la lee con `serde_json` y Foundry con `vm.parseJson`.
- **Errores.** Se comparan por nombre. Los fallos ajenos al contrato se agrupan en `Unauthorized` y `TokenFailure`.
- **Orden.** El orden de las validaciones es el mismo en las dos cadenas.

**Motivo.** `P-2` exige que las dos cadenas pasen la misma tabla. `packages/core` no puede usar `node:fs` (Biome),
los jobs de contratos de CI no corren pnpm, y Solidity no numera sus errores personalizados. Así la fuente es una
sola y ningún paquete TS importa de `contracts/`.

**Alternativa descartada:** dos tablas escritas a mano, una en Rust y otra en Solidity. Es justo la divergencia que
`P-2` quiere evitar.

---

### A-4 · `settle` recibe `met` (cumplió o no), no la distancia · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T4 y T6)

La firma es `settle(user, week_id, met)`. La comparación `distancia ≥ meta` vive una sola vez en `packages/core` y
la hace el oráculo. La distancia no se publica en la cadena.

**Motivo.** La política de la API de Strava (vigente desde el 1-jun-2026) prohíbe:
- guardar sus datos más de 7 días (POL 6.2);
- mostrarlos a terceros (POL 2.3).

Una distancia semanal escrita en la cadena sería pública y permanente. El resultado de la liquidación no agrega
nada que no se vea igual en la cadena por la transferencia o su ausencia. El oráculo ya es de confianza (`P-4`),
así que la comparación en el contrato no protegía más.

**Alternativa descartada:** `settle(user, week_id, distance_m)`, como en el mensaje inicial. Publica para siempre un
dato derivado de Strava.

---

### A-5 · Lo perdido queda en el contrato · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T4)

Lo `Forfeited` queda bloqueado para siempre en el contrato, visible en `total_forfeited`. Era la recomendación del
mensaje inicial (pregunta abierta 2).

**Motivo.**
- Quemarlo rompería el invariante "ningún fondo sale salvo hacia el dueño de la posición".
- No se puede hacer igual en las dos cadenas: FiatToken rechaza transferir a `address(0)`, y en Stellar quemar es
  enviar al emisor.
- Para mainnet se puede volver a evaluar en la Fase 2.

**Alternativa descartada:** quemarlo. Suma una salida de fondos y rompe la simetría entre cadenas.

---

### A-6 · Sin Exponential en la Fase 1, y `localhost` hasta T8 · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3

No hay tablero espejo en Exponential. La web y el callback de Strava usan `localhost` hasta que T8 elija el dominio
real. Era la recomendación del mensaje inicial (preguntas abiertas 3 y 4).

**Motivo.** La comparación de Exponential sigue en curso en AgentPey. En la Fase 1 solo se conecta la cuenta del
usuario, y `localhost` alcanza hasta publicar.

**Alternativa descartada:** sumar Exponential desde ya, o elegir el dominio antes de publicar.

---

### A-7 · Firmar en `live` exige `SETTLE_MODE=live` y además `--live` · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T6 y T8)

- El liquidador firma `settle` y `release_if_stale` solo con los dos interruptores.
- En `dry-run` no carga la clave del oráculo: el adaptador recibe un firmante solo en `live`.
- El Cron Job lleva los dos explícitos en `render.yaml`.

**Motivo.**
- `.claude/settings.json` pide confirmación solo si el comando lleva `--live`. Si bastara `SETTLE_MODE=live`, un
  `pnpm settle` firmaría sin preguntar.
- `release-stale` también mueve fondos y no estaba sujeto a ningún modo.

`pnpm release-stale*` está en la lista `ask` de `.claude/settings.json`, agregado con el OK del usuario el 16-oct.

**Alternativa descartada:** un solo interruptor, la variable o la bandera.

---

### A-8 · Solo se compromete la semana siguiente · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T4) · Decidido por el usuario

`commit` exige `week_id == current_week + 1`, con igualdad estricta.

**Motivo.** Nadie puede comprometerse el jueves con la meta ya corrida.

**Alternativa descartada:** permitir también la semana en curso. Se empieza antes, pero se puede comprometer sobre
km ya corridos.

---

### A-9 · Cuentan `Run` y `TrailRun` · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T5) · Decidido por el usuario

Una actividad cuenta si cumple todo esto:
- su `sport_type` es `Run` o `TrailRun`;
- `trainer` no es `true`;
- `manual` es `false`;
- tiene `device_name` o `upload_id`;
- su distancia y su `moving_time` son mayores que 0;
- su ritmo, calculado con `moving_time`, es de 2:30 min/km o más lento.

**Motivo.** Las dos son al aire libre, con GPS y reloj, igual de difíciles de falsear, y el trail es común en Chile.

**Alternativas descartadas:**
- Solo `Run`, como el mensaje inicial: deja fuera trails corridos con reloj.
- Sumar `VirtualRun` y cinta: más difíciles de verificar, y chocan con el filtro de ritmo.

---

### A-10 · Revocar el acceso a Strava cuenta como 0 km · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T5, T6 y T7) · Decidido por el usuario

Si el usuario revocó el acceso, la semana se liquida como no cumplida (`Forfeited`). Hay revocación cuando:
- el usuario desconecta Strava desde la web;
- Strava rechaza el refresh token como inválido o revocado.

Un error pasajero de Strava o de la red solo salta la posición, y si no se resuelve dentro de la ventana termina
en `release_if_stale`. Las reglas y la confirmación lo dicen en una frase.

**Motivo.** Sin esta regla, quien no cumplió podría revocar el acceso el lunes y recuperar el depósito.

**Riesgo aceptado.** Un refresh token que perdiéramos nosotros se vería igual que una revocación. Se mitiga
guardando la rotación de forma atómica, con test (T5), y registrando el motivo de cada liquidación.

**Alternativa descartada:** devolver el depósito ante cualquier falta de datos. Es fail-safe puro, pero abusable.

---

### A-11 · El ensayo de 1 hora usa carreras reales de Strava, con meta mínima de 500 m · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T3 (aplica en T6 y T8) · Decidido por el usuario

Las instancias de ensayo tienen `min_goal_m = 500`. En T8 el usuario corre dentro de la hora comprometida, y el
liquidador saca el resultado de Strava, igual que en producción. No existe ningún camino para un resultado manual.

**Motivo.** Es la opción más fiel a la restricción 4 de `CLAUDE.md`: Strava es la única fuente de verdad del
ejercicio, también en el ensayo.

**Alternativa descartada:** que el operador declare el resultado solo en las instancias de ensayo. Era la
recomendada, porque no exige salir a correr a una hora fija, pero abría un camino manual en el liquidador.

---

### A-12 · Los errores del contrato se numeran desde 101 · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T4

Los 11 errores propios llevan los números 101 a 111 en el `#[contracterror]` de Soroban y en
`contracts/fixtures/cases.json`. Solidity los identifica por nombre (selector), sin número.

Los fallos ajenos se clasifican así:
- un número de error que no es nuestro es `TokenFailure`: solo puede venir del SAC;
- un aborto del host sin número es `Unauthorized`: así termina un `require_auth` sin firma.

**Motivo.** Un error del Stellar Asset Contract (códigos 1 a 13) viaja a través de `commit`, `settle` y
`release_if_stale` con su propio número. Con nuestros errores en 1 a 11, el `BalanceDeauthorizedError` (11) del SAC
llegó al cliente como nuestro `BalanceMismatch` (11). Pasó en la primera corrida de la tabla (`evidencia/T4.md`), y
el adaptador de T6 habría confundido lo mismo en la red.

**Alternativa descartada:** atrapar los errores del token en el contrato y devolver uno propio. Agrega lógica en
el camino de los fondos y cambia la categoría `TokenFailure` del spec (4.3) por un error del contrato.

---

### A-13 · TTL de Soroban: umbral de 30 días y extensión a 31 · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T4

Cada escritura (`commit`, `settle` y `release_if_stale`) extiende la posición y la instancia con
`extend_ttl(518.400, 535.680)`. En ledgers de 5 segundos, eso equivale a un umbral de 30 días y una extensión a 31. El
constructor extiende la instancia igual.

**Motivo.** En producción una posición vive como máximo unos 21 días: se compromete hasta una semana antes, la
semana dura 7 días y la ventana de `settle` 7 más. Con 31 días queda margen, y el spec pide al menos 30 (4.2). Las
cifras están dentro de los límites que la red publicó el 16-oct:
- `max_entry_ttl` es 3.110.400 ledgers;
- `min_persistent_ttl` es 120.960;
- el cierre objetivo de un ledger es 5.000 ms.

Si una posición bloqueada por el token pasa más de 31 días sin escrituras, se archiva. La red la restaura al tocarla
(protocolo 23 y siguientes), y el test con 40 días lo verifica en testutils. En la red se comprueba en T6.

**Alternativa descartada:** extender al máximo de la red (unos 180 días). Cuesta más renta por cada posición y no
cambia nada: la restauración automática ya cubre a quien vuelva tarde.

---

### A-14 · El orden exacto de las validaciones, por función · `Vigente`
**Fecha:** 2026-10-16 · **Tarea:** T4

El spec (4.2) fija el orden general y deja a T4 el detalle por función. Queda así, en
`VALIDATION_ORDER` de `packages/core` y en la tabla:

| Función | Orden |
|---|---|
| `commit` | `BeforeAnchor` → `Unauthorized` → `AlreadyCommitted` → `WrongWeek` → `AmountOutOfRange` → `GoalOutOfRange` → `TokenFailure` → `BalanceMismatch` |
| `settle` | `Unauthorized` → `PositionNotFound` → `PositionNotActive` → `OutsideSettleWindow` → `TokenFailure` |
| `release_if_stale` | `PositionNotFound` → `PositionNotActive` → `NotStaleYet` → `TokenFailure` |
| `current_week` | `BeforeAnchor` |

- `settle` y `release_if_stale` no revisan el ancla: una posición existente se comprometió después de ella.
- `AlreadyCommitted` se aplica a una posición en cualquier estado, también los finales.

La tabla tiene un caso por cada par vecino de cada función, salvo uno: `TokenFailure → BalanceMismatch` en `commit`.
Ese par necesita un token que cobre comisión, y el SAC nunca la cobra, así que solo lo prueba la suite de EVM
(`test_CommitRefusesATokenThatChargesAFee`).

**Motivo.** Con el orden fijo, dos fallas simultáneas dan el mismo error en las dos cadenas, y la tabla lo prueba.

**Alternativa descartada:** comprobar el ancla también en `settle` y `release_if_stale`. Es una validación que
nunca puede fallar sin que antes falle `PositionNotFound`.

---

### A-15 · Los tests de la base corren sobre PGlite · `Vigente`
**Fecha:** 2026-10-17 · **Tarea:** T5

Los tests de `packages/db` y `apps/api` usan PGlite, un Postgres en memoria (`@agenthabit/db/testing`), con todas las
migraciones de `packages/db/drizzle` aplicadas. En producción la base es Neon, por `pg` (`P-5`).

**Motivo.** `pnpm check` no toca la red, y los tests tienen que correr el mismo SQL que Neon, incluidas las
migraciones. AgentSales usa la misma combinación.

**Alternativa descartada:** una rama de Neon para los tests. Exige red y credenciales en CI, y deja a `pnpm check`
dependiendo de un servicio externo.

---

### A-16 · El vínculo se firma con el estándar de mensajes de cada cadena · `Vigente`
**Fecha:** 2026-10-17 · **Tarea:** T5

**El mensaje.**
- En Avalanche, el formato EIP-4361 (SIWE). En Stellar, que no tiene un estándar equivalente, la misma plantilla
  adaptada (`buildLinkMessage`, `firmas.md` 5.4).
- La API escribe el texto, lo guarda con el nonce y verifica la firma contra el texto guardado, nunca contra uno que
  reenvíe la web.

**La verificación.**
- Stellar: SEP-53 con `Keypair#verifyMessage`. `verify` daría siempre falso.
- Avalanche: EIP-191 con `verifyMessage` de viem, solo para cuentas EOA. Las wallets de contrato (ERC-1271) no
  entran en el MVP.

**El nonce y la sesión.**
- El nonce vale 5 minutos y se quema antes de verificar, en una sola sentencia. Así un desafío se prueba una sola
  vez, aunque la firma falle.
- La sesión dura 24 horas. Viaja como `Bearer`, y en la base solo queda su SHA-256.

**Motivo.** Las wallets de `P-7` firman así sin pasos extra. SIWE además hace que la wallet compare el dominio con el
origen de la página, lo que frena el phishing. Guardar el texto evita un parser y sus ambigüedades.

**Alternativa descartada:** SEP-10 en Stellar. Exige `stellar.toml`, una clave de servidor y firmar una transacción
que no es una transacción, justo lo que SEP-53 quiere evitar.

---

### A-17 · Reglas del cliente de Strava · `Vigente`
**Fecha:** 2026-10-17 · **Tarea:** T5

Lo verificado está en `docs/integraciones/strava.md`.

**Conexión y desconexión.**
- La conexión exige `activity:read_all` en el redirect y en la respuesta del token. Si el token no trae `scope`, se
  rechaza.
- La desconexión usa `POST /oauth/revoke` con HTTP Basic, el único endpoint soportado desde el 1-jun-2027. Cuenta
  como revocación (`A-10`) aunque Strava no responda.

**Cuándo hay revocación.** Una renovación rechazada es revocación (`A-10`) solo cuando el cuerpo de Strava nombra
al refresh token como inválido (`field = refresh_token`, `code = invalid` o `revoked`). Todo lo demás es un error
pasajero que solo salta la posición: un 429, un 5xx, la red o cualquier otro cuerpo. El cuerpo exacto se mide en la
prueba 8.5 de `strava.md`.

**La lectura de la semana.**
- Pide `after = week_start − 1` y `before = week_end + 1`, y aplica la ventana exacta en el núcleo.
- Pagina hasta una página vacía, con un tope de 20 páginas.
- Se detiene si las cabeceras `X-ReadRateLimit-*` dicen que el límite se agotó.

**Si falta un dato** (D3). Si una carrera de la semana no trae un dato que el filtro necesita (`manual`, la distancia
o el tiempo), la lectura queda incompleta y no sirve para liquidar. Si nunca se completa, la posición vuelve a su
dueño por `release_if_stale`. Que no haya `device_name` ni `upload_id` sí es una respuesta: esa carrera no cuenta.

**Una renovación que pierde una carrera no revoca.** Si otro proceso ya rotó el refresh token, Strava rechaza el
viejo como inválido. Por eso la revocación se marca solo si el refresh token guardado sigue siendo el que se usó. Si
no, se relee la fila y se usa el token del ganador (hallazgo de `/revisar`). Una conexión que no existe o que no
tiene tokens es un error de base, no una revocación.

**Los tokens** solo viajan en la cabecera `Authorization` o en el cuerpo, nunca en la URL ni en un error.

**Motivo.** El error del verificador nunca le cuesta al usuario (spec 4.6). Una regla de revocación amplia
convertiría un fallo de Strava en un `Forfeited`.

**Alternativa descartada:** excluir en silencio la actividad a la que le falta un dato. Una carrera real podría
quedar fuera sin que nadie lo note, y el usuario perdería su depósito.

---

### A-18 · El callback de OAuth lo recibe la API, con el `state` en la base · `Superada` por `A-19`
**Fecha:** 2026-10-17 · **Tarea:** T5

Strava redirige a `STRAVA_REDIRECT_URI`, en la API (`/auth/strava/callback`), sin sesión.
- El `state` lo genera `/strava/connect`, ligado a la wallet de la sesión, y se guarda en `oauth_states`. Se usa una
  vez y vale 10 minutos.
- La API canjea el código, guarda los tokens cifrados y vincula la wallet al atleta.
- Después devuelve el navegador a la web con una sola palabra (`connected`, `scope`, `denied`, `expired` o `error`),
  sin código ni token en la URL.

**Motivo.** Una redirección del navegador no lleva la cabecera de la sesión. El `state` en la base liga el callback
a quien empezó la conexión y además protege contra CSRF.

**Alternativa descartada:** que la web reciba el código y lo reenvíe a la API. Pone el código en una página más y
suma un paso sin ganar nada.

---

### A-19 · El callback de OAuth llega a la web, que lo reenvía con su sesión · `Vigente`
**Fecha:** 2026-10-17 · **Tarea:** T5 (`/revisar`) · Reemplaza a `A-18`

Strava redirige a una página de la web (`STRAVA_REDIRECT_URI`, por ejemplo `http://localhost:5173/strava/callback`).
- La web reenvía `code`, `scope` y `state` a `POST /strava/callback`, con su sesión `Bearer`.
- La API exige que el `state` haya sido emitido para la wallet de esa misma sesión. Si no, responde `LinkRejected`.

**Desconectar es por wallet.** `POST /strava/disconnect` borra solo el vínculo de esa wallet. Revoca al atleta en
Strava y en la base (`A-10`) solo cuando ninguna otra wallet lo sigue usando.

**Motivo.** Con `A-18` el `state` ligaba el callback a la wallet que lo pidió, pero no al navegador que volvía de
Strava (RFC 6749 §10.12). El ataque era así:
1. Un tercero inicia una conexión con su propia wallet.
2. Le manda el enlace de Strava a la víctima. Con `approval_prompt=auto`, la víctima puede autorizar sin ver
   ninguna pantalla.
3. La wallet del tercero queda ligada al atleta de la víctima.
4. El tercero desconecta, y eso revoca a la víctima: sus semanas activas quedarían en `Forfeited`.

Ahora el callback solo se completa dentro de la sesión que lo empezó, y una wallet no puede revocar un atleta que
otra todavía usa. Lo encontró el `revisor` en `/revisar`, y hay test.

**Alternativa descartada:** atar el `state` al navegador con una cookie `HttpOnly`. La web y la API corren en
orígenes distintos (5173 y 3000), y una cookie entre orígenes complica más de lo que protege, cuando la web ya
tiene una sesión.

---

### A-20 · Qué se guarda del atleta, y por cuánto tiempo · `Vigente`
**Fecha:** 2026-10-17 · **Tarea:** T5 (`/revisar`)

El id de atleta se trata como Strava Data: es una decisión conservadora. Por eso:
- **Al revocar** se borran los tokens y todos los vínculos de wallet a ese atleta. La fila de la conexión queda, con
  `revokedAt`, para que la liquidación aplique `A-10`.
- **La purga diaria** (`purgeExpiredData`, que corre el Cron de T6) además:
  - anula el `athlete_id` de cada posición liquidada en `live`;
  - borra las conexiones revocadas hace 30 días o más (POL 7.4);
  - borra los desafíos, estados de OAuth y sesiones vencidos.
- **El registro de liquidaciones** lleva `mode` en la clave. Un `dry-run` y después la liquidación `live` de la
  misma posición son dos registros. La purga solo cuenta las `live`.

**Motivo.**
- POL 6.4 limita la retención al propósito, y POL 7.4 pide borrar en 30 días tras una revocación.
- Sin `mode` en la clave, un `live` posterior a un `dry-run` chocaba con la clave primaria después de haber enviado
  la transacción.

**Alternativa descartada:** borrar la conexión apenas se revoca. La liquidación de las semanas activas necesita
saber que hubo revocación (`A-10`). Sin la fila, la vería como un error pasajero y devolvería el depósito.

---

### A-21 · Cómo se prueba con la cuenta real y cómo se refleja un borrado · `Vigente`
**Fecha:** 2026-10-17 · **Tarea:** T5 · Son D4 y D5 de `docs/integraciones/strava.md`

- **Pruebas con la cuenta real** (D4). El usuario las corre en su máquina. Al chat trae solo conclusiones sobre la API
  (formatos, códigos, si algo existe), nunca distancias, fechas, conteos ni ids. POL 5.3 cubre también los datos
  derivados o agregados.
- **Actividades borradas** (D5, POL 6.3). Sin webhooks, un borrado se refleja releyendo:
  - la liquidación siempre relee la semana completa;
  - la web nunca muestra actividades guardadas sin releerlas (T7).

**Motivo.** Es la forma de cumplir POL 5.3 y 6.3 sin un callback público, que no existe en la Fase 1.

**Alternativa descartada:** webhooks de Strava. Exigen un callback público, y la Fase 1 corre en `localhost`
(`A-6`).
