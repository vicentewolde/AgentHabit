# Estado del proyecto

> La memoria de trabajo entre sesiones. `/estado` lo lee al empezar y `/tarea` lo actualiza al
> terminar. Se mantiene corto: la narrativa vive en la `BITACORA.md` de la fase.
>
> Leyenda: ⏳ pendiente · 🔨 en curso · 👀 en revisión · ✅ terminada · ⛔ bloqueada ·
> ✂️ cortada · ⏸ en pausa

**Actualizado:** 2026-10-17
**Fase en curso:** Fase 1 · MVP en testnet. Su spec es [fase-1-mvp-testnet/SPEC.md](fase-1-mvp-testnet/SPEC.md)
(**Aprobado** el 16-oct), con las decisiones `A-1` a `A-14` (`A-12` a `A-14` de T4).

**Fase anterior:** Fase 0 · Fundamentos, **cerrada** el 16-oct con el tag `v0.0.1`
([bitácora](fase-0-fundamentos/BITACORA.md), con la verificación de criterios y la retro).
**Última tarea terminada:** T5 Strava, API y km de la semana ([PR #12](https://github.com/vicentewolde/AgentHabit/pull/12), mergeado el 17-oct por fast-forward), **con un pendiente explícito**: las pruebas con la cuenta real de Strava (ver "Pendientes del usuario").
**Siguiente paso:** el plan acelerado de `A-22` (spec 8.1): el socio del usuario empieza el **lunes 26-oct** en testnet con Stellar. T6a y T7a terminadas; en curso: T8a (publicar en Render).

## Progreso de la Fase 1

Tareas agrupadas el 16-oct para ganar velocidad: 14 pasan a 6 (equivalencias en el registro de cambios del spec).
**T4 y T5 son independientes y pueden correr en paralelo,** en dos sesiones.

**Plan acelerado (`A-22`, 17-oct).** El socio del usuario empieza su reto el lunes 26-oct, en testnet y con Stellar.
Tiene que comprometer antes del domingo 25 a las 23:59 (UTC-3). T6, T7 y T8 se parten en `a` (hasta ese domingo) y `b`
(después). La primera liquidación es el miércoles 4-nov a las 03:00 UTC: para entonces tiene que estar vivo el
liquidador, en `dry-run` primero.

| Tarea | Estado | Rama / PR |
|---|---|---|
| T4 Núcleo y contratos (dominio, tabla de casos, Soroban, EVM) | ✅ terminada | [PR #11](https://github.com/vicentewolde/AgentHabit/pull/11) |
| T5 Strava, API y km de la semana | ✅ terminada, con un pendiente: pruebas con la cuenta real de Strava | [PR #12](https://github.com/vicentewolde/AgentHabit/pull/12) |
| **T6a** Contratos vivos en Stellar (adaptador y despliegue de producción) | ✅ terminada: contrato de producción desplegado el 17-oct | [PR #13](https://github.com/vicentewolde/AgentHabit/pull/13) y su PR de cierre |
| **T7a** Web mínima, solo Stellar | ✅ terminada el 17-oct (Freighter real sin probar: ensayo del vie 23) | `cc/t7a-web-stellar` |
| **T8a** Publicación en Render | 🔨 `render.yaml` y la guía listos; falta publicar, hasta el jue 22 | `cc/t8a-render` |
| T6b Liquidación, Cron, Avalanche e instancia de ensayo | ⏳ **mié 4-nov, 03:00 UTC** | |
| T7b Web: historial, meta sugerida, Avalanche | ⏳ después | |
| T8b Ensayo de punta a punta | ⏳ después | |
| T9 `/fase-cerrar 1` | ⏳ pendiente | |

## Pendientes del usuario

- **Para publicar en Render (T8a):** seguir [`PUBLICAR-EN-RENDER.md`](fase-1-mvp-testnet/PUBLICAR-EN-RENDER.md).
  Necesita que el contrato esté desplegado y T6a y T7a en `main`. Los valores secretos los pegas tú en Render.

- Agregar Foundry al `PATH`, por ejemplo con
  `echo 'export PATH="$PATH:$HOME/.foundry/bin"' >> ~/.zshrc`, porque el instalador no lo hizo.
- **Fijar el `stellar` CLI local en 28.1.0** (`P-8`): `brew pin stellar-cli`, o reinstalarlo con el comando del
  README. Si no, un `brew upgrade` lo cambiaría antes de T6, y el wasm local dejaría de coincidir con el de CI.
- **Para T6:** pedir a mano AVAX de prueba para las tres direcciones de Fuji, y USDC de prueba para el usuario de
  prueba en las dos cadenas. Las direcciones están al final de la salida de `pnpm run bootstrap`.
- **Pendiente de T5, cerrada sin esto por decisión del usuario el 17-oct:**
  - **Suscripción de Strava y la app.** La cuenta del usuario es gratuita y la API solo está disponible para
    suscriptores: el botón "Create" del panel de la API está deshabilitado. Con la suscripción, crear la app
    (`AgentHabit`, callback `localhost`) y poner `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` y
    `STRAVA_REDIRECT_URI=http://localhost:5173/strava/callback` en `.env.local`.
  - **Las pruebas 8.1 a 8.8** de `docs/integraciones/strava.md`, con la cuenta real. **Hay que hacerlas antes del
    ensayo de T8,** que usa carreras reales. Traer al chat solo conclusiones
    sobre la API, sin distancias, fechas ni conteos (POL 5.3). Confirman lo que la documentación no dice:
    el máximo de `per_page`, si cada página cuenta como una lectura, `device_name` y `upload_id` en carreras con
    Garmin, y el cuerpo exacto del error de un token revocado (de eso depende la regla de revocación de `A-17`, que
    hoy falla del lado seguro).
  - **Las pruebas con wallet** de la sección 8 de `docs/integraciones/firmas.md`, sin mover fondos:
    - Freighter, con tildes y saltos de línea;
    - xBull;
    - MetaMask;
    - Core, que podría no soportar `personal_sign`.
  - **Neon: hecho.** El proyecto `agenthabit` existe (AWS São Paulo, creado el 17-oct) y según el usuario,
    puso `DATABASE_URL` y `TOKEN_ENCRYPTION_KEY` en `.env.local` (no se pudo verificar: los permisos del proyecto
    impiden leer ese archivo). Falta aplicar las migraciones, con el código ya en
    `main`: `pnpm run db:migrate` desde la carpeta principal.
- **Antes de T6:** leer el texto de POL 5.16(c) sobre reusar tokens entre servidores (`strava.md`, sección 9). Es
  ambiguo para la API y el liquidador, y conviene incluir la pregunta en el correo a developers@strava.com.

## Notas

- **Deuda de T6a, de la revisión:**
  - Un contrato vencido por inactividad pide restaurar su estado (`restorePreamble`). El cliente hoy lo trata como un
    error de lectura. Vale con un `commit` por semana, pero hay que documentarlo o manejarlo.
  - Falta un límite de pedidos por IP antes de publicar.
- **T5:**
  - La API no acepta posiciones todavía en el servidor real: `knownContracts` está vacío y la lectura en la cadena
    llega con T6. En los tests se usa un adaptador simulado.
  - **Deuda para T6:**
    - el `CommitReader` real sobre los adaptadores;
    - `knownContracts` desde `deployments/*.json`;
    - el liquidador usando `freshAccessToken` y `readWeek`, y la purga diaria;
    - un solo proceso renueva tokens (POL 5.16).
  - **Para T7:** la página `/strava/callback` de la web reenvía `code`, `scope` y `state` a `POST /strava/callback`
    con la sesión (`A-19`), y la API necesita CORS para el origen de la web.
  - **Para T8:** un límite de pedidos por IP en `/link/challenge` antes de publicar.
  - **T5 se cerró sin las pruebas con la cuenta real de Strava,** por decisión del usuario el 17-oct, porque su
    cuenta no tiene suscripción. Todo se probó con un Strava simulado. Los riesgos de cerrar así están en
    "Pendientes del usuario".
- **T4:** la tabla de casos se regenera con `pnpm run cases:gen`; `pnpm check` falla si `contracts/fixtures/cases.json`
  quedó desactualizado. Los errores del contrato se numeran desde 101 (`A-12`).
- **Deuda para T6, de la revisión de T4:**
  - **Firmante genérico.** Que `ChainAdapter` sea genérico en su firmante (`ChainAdapter<S extends ChainSigner>`),
    para que los adaptadores no necesiten `as`.
  - **Dirección cero.** El script de despliegue de Avalanche debe rechazar `token` u `oracle` en cero. El
    constructor EVM no lo hace, por simetría con Soroban.
  - **Ancla.** El script de despliegue debe verificar que el `week_anchor` de producción sea un lunes a las 00:00 en
    UTC-3 (`anchor % 604800 == 356400`).
- **Hackatón Vinny (Avalanche):** se entrega este mismo repo, con el README para jueces del PR #9. Plazo y
  requisitos son supuestos (el usuario solo dio el nombre): ficha y faltantes en
  [HACKATON-VINNY.md](HACKATON-VINNY.md). Lo que falta es el contrato en Fuji (T4 + despliegue de T6) y el video.
- **Calendario de la Fase 1:** Stellar testnet se reinicia el 16-dic-2026. La semana real de 7 días tiene que
  liquidarse antes, o hay que redesplegar (spec, sección 8).
- **Antes de la Fase 3:** consultar a developers@strava.com si el producto calza con los términos de la API (spec,
  4.8).
- El contrato de Soroban se compila con `pnpm run contracts:build:stellar` (`stellar contract build`, `P-8`), no
  con `cargo build`. El usuario lo aceptó el 15-oct.
- Si un bootstrap quedó colgado, el lock `.env.local.lock` se retoma solo si su proceso murió.
- Node local es 26.9; el proyecto fija 22 (`.nvmrc`, `P-5`). `pnpm check` pasa en 26.
