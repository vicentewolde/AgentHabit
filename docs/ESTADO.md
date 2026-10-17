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
**Última tarea terminada:** T4 Núcleo y contratos ([PR #11](https://github.com/vicentewolde/AgentHabit/pull/11), mergeado el 17-oct por fast-forward).
**Siguiente paso:** `/revisar` de T5 (rama `cc/t5-strava-api-km`). Después, `/tarea T6` — despliegue en testnet y liquidación.

## Progreso de la Fase 1

Tareas agrupadas el 16-oct para ganar velocidad: 14 pasan a 6 (equivalencias en el registro de cambios del spec).
**T4 y T5 son independientes y pueden correr en paralelo,** en dos sesiones.

| Tarea | Estado | Rama / PR |
|---|---|---|
| T4 Núcleo y contratos (dominio, tabla de casos, Soroban, EVM) | ✅ terminada | [PR #11](https://github.com/vicentewolde/AgentHabit/pull/11) |
| T5 Strava, API y km de la semana | 👀 en revisión | `cc/t5-strava-api-km` |
| T6 Despliegue en testnet y liquidación | ⏳ pendiente | |
| T7 Web (compromiso, estado de la semana, reglas) | ⏳ pendiente | |
| T8 Ensayo de punta a punta y publicación en Render | ⏳ pendiente | |
| T9 `/fase-cerrar 1` | ⏳ pendiente | |

## Pendientes del usuario

- Agregar Foundry al `PATH`, por ejemplo con
  `echo 'export PATH="$PATH:$HOME/.foundry/bin"' >> ~/.zshrc`, porque el instalador no lo hizo.
- **Fijar el `stellar` CLI local en 28.1.0** (`P-8`): `brew pin stellar-cli`, o reinstalarlo con el comando del
  README. Si no, un `brew upgrade` lo cambiaría antes de T6, y el wasm local dejaría de coincidir con el de CI.
- **Para T6:** pedir a mano AVAX de prueba para las tres direcciones de Fuji, y USDC de prueba para el usuario de
  prueba en las dos cadenas. Las direcciones están al final de la salida de `pnpm run bootstrap`.
- **Para cerrar la prueba técnica de T5:**
  - Crear la app de Strava (requiere tu suscripción) y una base en Neon, y poner sus valores en `.env.local`.
  - Correr `pnpm run db:migrate`.
  - Hacer las pruebas 8.1 a 8.8 de `docs/integraciones/strava.md`, con tu cuenta. Traer al chat solo conclusiones
    sobre la API, sin distancias, fechas ni conteos (POL 5.3).
  - Hacer las pruebas con wallet de la sección 8 de `docs/integraciones/firmas.md`, sin mover fondos:
    - Freighter, con tildes y saltos de línea;
    - xBull;
    - MetaMask;
    - Core, que podría no soportar `personal_sign`.
- **Antes de T6:** leer el texto de POL 5.16(c) sobre reusar tokens entre servidores (`strava.md`, sección 9). Es
  ambiguo para la API y el liquidador, y conviene incluir la pregunta en el correo a developers@strava.com.

## Notas

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
  - **T5 no se marca ✅** hasta que corras las pruebas con tu cuenta real (8.1 a 8.8 de `strava.md`), o hasta que
    decidas cerrarla sin ellas.
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
