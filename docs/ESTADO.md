# Estado del proyecto

> La memoria de trabajo entre sesiones. `/estado` lo lee al empezar y `/tarea` lo actualiza al
> terminar. Se mantiene corto: la narrativa vive en la `BITACORA.md` de la fase.
>
> Leyenda: ⏳ pendiente · 🔨 en curso · 👀 en revisión · ✅ terminada · ⛔ bloqueada ·
> ✂️ cortada · ⏸ en pausa

**Actualizado:** 2026-10-16
**Fase en curso:** Fase 1 · MVP en testnet. Su spec es [fase-1-mvp-testnet/SPEC.md](fase-1-mvp-testnet/SPEC.md)
(**Aprobado** el 16-oct), con las decisiones `A-1` a `A-14` (`A-12` a `A-14` de T4).

**Fase anterior:** Fase 0 · Fundamentos, **cerrada** el 16-oct con el tag `v0.0.1`
([bitácora](fase-0-fundamentos/BITACORA.md), con la verificación de criterios y la retro).
**Última tarea terminada:** T3 `/fase-plan 1` ([PR #5](https://github.com/vicentewolde/AgentHabit/pull/5), mergeado el 16-oct por fast-forward).
**Siguiente paso:** `/revisar` de T4 (rama `cc/t4-nucleo-y-contratos`). En paralelo, en otra sesión, `/tarea T5` — Strava, API y km de la semana.

## Progreso de la Fase 1

Tareas agrupadas el 16-oct para ganar velocidad: 14 pasan a 6 (equivalencias en el registro de cambios del spec).
**T4 y T5 son independientes y pueden correr en paralelo,** en dos sesiones.

| Tarea | Estado | Rama / PR |
|---|---|---|
| T4 Núcleo y contratos (dominio, tabla de casos, Soroban, EVM) | 👀 en revisión | `cc/t4-nucleo-y-contratos` |
| T5 Strava, API y km de la semana | ⏳ pendiente | |
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
- **Para T5 (bloquea su arranque):** crear la app de Strava, que requiere tu suscripción y nace en modo un
  jugador, y una base de datos en Neon.

## Notas

- **T4:** la tabla de casos se regenera con `pnpm run cases:gen`; `pnpm check` falla si `contracts/fixtures/cases.json`
  quedó desactualizado. Los errores del contrato se numeran desde 101 (`A-12`).
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
