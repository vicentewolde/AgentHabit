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
