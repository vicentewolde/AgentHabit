# Bitácora — Fase 1 (MVP en testnet)

> Qué se hizo, qué falta, y qué significa cada cosa en lenguaje llano.
>
> - Spec: [SPEC.md](SPEC.md)
> - Decisiones: las `A-` de [DECISIONES.md](DECISIONES.md)
> - Salidas crudas de cada tarea: `evidencia/T<n>.md`
>
> La numeración es continua entre fases: la Fase 1 usa T4 a T9. El tablero del día a día es
> [`docs/ESTADO.md`](../ESTADO.md); aquí queda la narrativa de cada tarea cerrada.

---

## Estado actual

**Fecha:** 2026-10-17 · **Fase en curso** desde el cierre de la Fase 0 (`v0.0.1`). Spec **Aprobado** en T3.
T4 y T5 terminadas ([PR #11](https://github.com/vicentewolde/AgentHabit/pull/11) y [PR #12](https://github.com/vicentewolde/AgentHabit/pull/12)). T5 se cerró sin las
pruebas con la cuenta real de Strava, por decisión del usuario: sigue pendiente su suscripción. Siguiente: T6.

## Progreso

Tareas agrupadas el 16-oct para ganar velocidad (equivalencias en el registro de cambios del spec).

| Tarea | Estado |
|---|---|
| T4 Núcleo y contratos | ✅ terminada |
| T5 Strava, API y km de la semana | ✅ terminada, con un pendiente |
| T6 Despliegue en testnet y liquidación | ⏳ pendiente |
| T7 Web | ⏳ pendiente |
| T8 Ensayo de punta a punta y publicación en Render | ⏳ pendiente |
| T9 `/fase-cerrar 1` | ⏳ pendiente |

---

## T4 · Núcleo y contratos

**Qué quedó funcionando.** Ya existen los dos contratos que guardan el dinero, uno para Avalanche y otro para Stellar,
y se comportan igual. Los dos hacen exactamente tres cosas con fondos:
- **comprometer:** el usuario bloquea entre 20 y 50 USDC para la semana siguiente;
- **liquidar:** el oráculo dice "cumplió" (se devuelve todo) o "no cumplió" (el dinero queda en el contrato para
  siempre);
- **devolver por plazo vencido:** si el oráculo no liquidó a tiempo, cualquiera puede devolverle el depósito a su
  dueño, sin fecha límite.

No hay ninguna otra forma de sacar dinero, y nadie (ni el equipo) puede cambiar las reglas.

Para que las dos cadenas no se separen, hay una sola lista de situaciones escrita una vez en el núcleo común: **45
casos con 127 pasos**. Cubren los bordes de las semanas, cada error, el orden en que se revisan los errores, el
token que rechaza una devolución y varias semanas seguidas. Los dos contratos leen esa misma lista y la pasan entera.
Si alguien cambia un contrato y rompe una regla, la lista lo detecta. Se probó metiendo un error a propósito: las dos
cadenas fallaron en el mismo caso.

Todo corre en tests locales: no se desplegó nada ni se tocó la red con fondos.

**Lo que cambió respecto del plan.**
- **Los errores del contrato de Stellar se numeran desde 101** (`A-12`). La primera corrida de la lista mostró que un
  error del token de USDC llegaba con el mismo número que uno nuestro y se confundían. En la red habría pasado igual.
- **El TTL de Soroban quedó en 30 y 31 días** (`A-13`), con los límites leídos de la red el 16-oct. Además, un test
  deja pasar 40 días sin escrituras: la posición se archiva, se restaura al tocarla y la devolución funciona.
- **El orden de validación quedó fijado por función** (`A-14`), con un caso por cada par vecino.
- **Hay un modelo de referencia en TypeScript.** Corre la lista con las funciones del núcleo antes de llegar a los
  contratos, así un caso mal escrito falla primero ahí. No estaba en el spec y no agrega alcance: es un test.
- **El ancla de cada instancia se elige al desplegar** (T6). El núcleo trae los parámetros de producción y de ensayo
  sin ancla, y `instanceParams` la recibe y valida todo con las reglas del constructor.

**Decisiones nuevas.** `A-12`, `A-13` y `A-14`.

**Revisión (`/revisar`).** El subagente `revisor` y la revisión propia de los dos contratos no encontraron
bloqueantes: ningún camino saca fondos hacia alguien que no sea el dueño. Hubo 3 importantes, corregidos en un commit
`fix` sobre la misma rama:
- **La lista no revisaba lo guardado.** Un contrato que guardara mal el monto o la meta podía pasarla. Ahora, después
  de cada compromiso, los tres ejecutores comparan lo guardado con lo pedido. Se probó metiendo esos errores a
  propósito: los dos se detectan.
- **Los ejecutores agrupaban fallos distintos en una misma categoría.**
  - EVM contaba cualquier revert desconocido como "el token rechazó".
  - Soroban contaba cualquier aborto como "falta firma", y en el constructor cualquier panic como "configuración
    inválida".

  Ahora un fallo inesperado hace fallar el caso. Una salvedad: en Soroban, una firma faltante y un panic llegan con el
  mismo error del host. Por eso cuenta como "falta firma" solo si el paso de verdad omitió al firmante.
- **`goalMet` sumaba distancias con decimales.** El spec (4.5) trunca cada carrera a metros enteros antes de sumar.
  Ahora recibe el total en metros enteros (`bigint`).

También entraron sugerencias baratas: un caso de compromiso en el primer segundo de la semana 0, rangos `u64` e
`i128` en `validateParams`, y la excepción de `BalanceMismatch` escrita en `A-14`. Tres sugerencias son de T6 y
quedaron como deuda en `docs/ESTADO.md`.

**Cierre.** [PR #11](https://github.com/vicentewolde/AgentHabit/pull/11), con los tres jobs de CI en verde sobre `8407442`. El job de Soroban compiló el mismo wasm que la Mac
(`d044c26e…`): local y CI construyen lo mismo. Merge por fast-forward a `main` el 17-oct.

**Evidencia.** [`evidencia/T4.md`](evidencia/T4.md).

---

## T5 · Strava, API y km de la semana

**Qué quedó funcionando.** La parte que conecta a una persona con su cuenta de Strava y cuenta sus kilómetros:

- **Vincular la wallet con Strava.** La persona firma con su wallet un mensaje que escribe la API, sin mover fondos.
  Funciona con las wallets de Stellar y de Avalanche. Así nadie puede asociar la wallet de otro a una cuenta de Strava
  vacía. La firma abre una sesión.
- **Conectar Strava.** La API pide el permiso que deja ver todas las carreras, incluidas las privadas, y rechaza la
  conexión si no se lo dan. Guarda los tokens cifrados, y al renovarlos guarda siempre el nuevo, para no perder el
  acceso.
- **Contar los km de la semana.** Lee las actividades de Strava página por página, sin pasarse de los límites de
  lectura, y deja solo las carreras válidas: al aire libre, grabadas con un dispositivo, no manuales y a un ritmo
  humano. Suma en metros enteros. Si falta un dato o la lectura se corta, no inventa un total: esa semana no se
  liquida, y si nunca se completa, el dinero vuelve a su dueño.
- **Registrar las posiciones.** La API guarda una posición solo después de leerla en la cadena, y congela la cuenta
  de Strava vinculada en ese momento.
- **Borrar lo de Strava.** Los datos de Strava se borran a los 7 días o al liquidar, como piden sus términos.

Todo se probó con un Strava simulado y datos inventados: ningún dato real pasó por git ni por un prompt.

**Lo que falta, del lado del usuario.** Crear la app de Strava y la base en Neon, aplicar las migraciones y correr las
pruebas con la cuenta real (`docs/integraciones/strava.md`, sección 8). Son las que confirman lo que la documentación
de Strava no dice:
- el máximo de actividades por página;
- si cada página cuenta como una lectura;
- cómo vienen las carreras de Garmin;
- el cuerpo exacto del error de un token revocado.

**Lo que cambió respecto del plan.**
- **Dos notas verificadas nuevas:** `docs/integraciones/strava.md` y `docs/integraciones/firmas.md`. La segunda no
  estaba en el spec, pero la firma del vínculo la necesitaba. Corrigieron dos cosas de la 4.8:
  - la desconexión usa `/oauth/revoke`;
  - "token solo en cabecera desde 2027" no aparece en el changelog oficial. El cliente igual nunca manda el token
    por URL.
- **Una carrera con datos faltantes deja la lectura incompleta** (`A-17`, D3), en vez de excluirse en silencio.
- **Una tabla más, `oauth_states`** (`A-18`), porque el callback de Strava llega sin sesión.
- **Una duda de términos para antes de T6.** POL 5.16(c) sobre reusar tokens entre la API y el liquidador es ambigua.
  No bloquea la Fase 1; quedó para leer y preguntar a Strava.

**Decisiones nuevas.** `A-15` (PGlite en los tests), `A-16` (firma del vínculo), `A-17` (reglas del cliente de
Strava) y `A-18` (callback de OAuth, superada por `A-19`). Después de `/revisar`: `A-19`, `A-20` y `A-21`.

**Revisión (`/revisar`).** El `revisor` encontró dos bloqueantes, los dos caminos por los que una semana terminaría
`Forfeited` sin que el dueño hubiera fallado. Se corrigieron en un commit `fix` sobre la misma rama.
- **Un tercero podía apropiarse del vínculo con Strava y después revocarlo.**
  1. El tercero iniciaba la conexión con su wallet y le mandaba el enlace de Strava a la víctima.
  2. La víctima autorizaba, y la wallet del tercero quedaba ligada a sus carreras.
  3. El tercero desconectaba, y eso dejaba sin km las semanas de la víctima.

  Ahora la vuelta de Strava pasa por la web y se completa solo en la sesión que la empezó. Además, desconectar una
  wallet ya no revoca un atleta que otra wallet sigue usando (`A-19`).
- **Dos renovaciones de token al mismo tiempo podían parecer una revocación.** La que perdía la carrera recibía
  "token inválido" y borraba el token bueno. Ahora solo revoca si el token guardado sigue siendo el que usó; si no,
  usa el del ganador.

También se corrigieron cuatro importantes:
- una conexión inexistente ya no cuenta como revocación;
- el registro de liquidaciones lleva el modo en la clave, para que un ensayo y la liquidación real convivan;
- el id del atleta se borra cuando ya no hace falta (`A-20`);
- D4 y D5 de `strava.md` quedaron como decisión (`A-21`).

Y sugerencias:
- un límite al tamaño de los pedidos;
- la dirección del contrato normalizada por cadena;
- más secretos revisados en los logs;
- la purga de desafíos y sesiones vencidos.

El importante que queda abierto es la prueba con la cuenta real, del lado del usuario.

**Cierre.** [PR #12](https://github.com/vicentewolde/AgentHabit/pull/12), con los tres jobs de CI en verde sobre `54674ed`, y merge por fast-forward a `main` el 17-oct.

**Cerrada con un pendiente explícito.** El usuario decidió cerrar T5 sin las pruebas con su cuenta real de Strava:
su cuenta es gratuita, y el panel de la API muestra "The Strava API is available to subscribers" con el botón
de crear deshabilitado. Lo que se perdió de verificar, y por qué importa:
- **El cuerpo del error de un token revocado.** La regla de `A-17` se escribió sobre la forma documentada, no sobre
  una respuesta medida. Si Strava responde distinto, una revocación real no se detectaría y la lectura solo se
  saltaría. Falla del lado seguro: nunca castiga al usuario.
- **El máximo de `per_page` y si cada página cuenta como una lectura.** Hoy se piden páginas de 30 y se lee hasta
  una página vacía, que funciona con cualquier máximo.
- **`device_name` y `upload_id` en carreras con Garmin.** Si vinieran vacíos, esas carreras no contarían y el
  usuario perdería su depósito sin haber fallado: es el riesgo que más importa y hay que medirlo antes del ensayo
  de T8, no más tarde.
- **El formato del `scope` en el redirect y los bordes de `after` y `before`.** El cliente acepta coma o espacio y
  aplica la ventana exacta por su cuenta, así que los dos están cubiertos.

Neon sí quedó listo: el proyecto `agenthabit` existe en AWS São Paulo y el usuario dice que puso sus valores en `.env.local`
(no se pudo comprobar).
Falta aplicar las migraciones con `pnpm run db:migrate`, ya con el código en `main`.

**Evidencia.** [`evidencia/T5.md`](evidencia/T5.md).

---

## T6a · Contratos vivos en Stellar (en curso)

Primera parte de T6 bajo el plan acelerado (`A-22`): lo que el socio del usuario necesita para comprometer antes del
domingo 25.

**Qué quedó funcionando.** El código está listo y probado con una red simulada. Falta desplegarlo, y eso necesita el
OK del usuario.
- **El despliegue de la instancia de producción de Stellar.** Un comando que primero muestra el plan y solo envía si
  se le dice. Si se repite no hace nada, y si algo no coincide se detiene en lugar de adivinar. Deja el contrato
  registrado en `deployments/stellar-testnet.json`.
- **La conexión con el contrato.** Ya se pueden leer la configuración, la semana actual y las posiciones, y armar
  las dos transacciones que firma la wallet: comprometer y recuperar.
- **La API de la web.** Entrega:
  - la configuración;
  - quién es el usuario;
  - la semana actual y la siguiente, con los kilómetros leídos de Strava, con una caché de 10 minutos para no gastar
    el límite;
  - la preparación y el envío de las transacciones.

  No deja comprometer sin Strava conectado, y solo reenvía las dos llamadas permitidas (`A-23`).
- **El contrato entre la web y la API**, escrito una vez con esquemas compartidos.

**Lo que falta de T6a.** Desplegar (con OK, y con el código ya en `main` para que el comando lea tu `.env.local`),
comprometer una vez desde el usuario de prueba para ver el contrato funcionando en la red y guardar las salidas.

**Decisiones nuevas.** `A-22` (el plan), `A-23` (la API arma y reenvía) y `A-24` (cómo despliega el comando).

**Evidencia.** [`evidencia/T6a.md`](evidencia/T6a.md).
