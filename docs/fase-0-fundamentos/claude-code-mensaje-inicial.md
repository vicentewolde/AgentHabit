# AgentHabit — mensaje inicial para Claude Code

> Pega este archivo completo como primer mensaje en Claude Code, abierto en `~/dev/` (no dentro de otro repo).
> Después de T1 quedará guardado en el repo como `docs/fase-0-fundamentos/claude-code-mensaje-inicial.md`.
> Fecha: 15-oct-2026. Autor: Vinny (el usuario), con Claude.

---

## CONTEXTO DEL PROYECTO

**AgentHabit** es un MVP de compromisos con dinero en juego. El usuario bloquea entre 20 y 50 USDC en un contrato y fija una meta semanal de kilómetros corridos. Strava verifica las carreras. Si cumple, recupera todo; si falla, el dinero queda bloqueado para siempre en el contrato. Nadie lo cobra: ni la plataforma ni otros usuarios.

Viene de una evaluación de negocio hecha el 13 y 14 de octubre. Las conclusiones que fijan el diseño:

- **Sin pozo ni premios.** Repartir lo perdido entre cumplidores lo acerca a "apuesta en línea" (Boletín 14.838-03 en Chile) y crea un conflicto de interés. Por eso lo perdido no va a nadie.
- **Sin comisión.** El MVP no busca ingresos. Prueba dos cosas: que la tecnología funciona de punta a punta y cómo se comporta la gente con su propio dinero en juego.
- **Sin custodia.** El contrato no tiene admin ni función de retiro. Ni el equipo puede mover los fondos. Eso lo deja fuera del perímetro de custodia de la Ley Fintec.
- **El error del verificador nunca le cuesta al usuario.** Si el oráculo no liquida a tiempo, cualquiera puede devolver el depósito a su dueño.

Es un proyecto aparte de AgentPey y AgentSales, pero usa **su misma metodología**. Ambos repos están en tu Mac: AgentPey en `~/dev/AgentPay` y AgentSales donde lo tengas (búscalo con `ls ~/dev`). Si no los encuentras, clónalos de `github.com/vicentewolde/AgentPey` y `github.com/vicentewolde/AgentSales` (son públicos) en una carpeta temporal **solo para leerlos**.

## RESTRICCIONES NO NEGOCIABLES

1. **Dos cadenas desde el día uno: Stellar y Avalanche.** Mismo comportamiento en ambas, con un adaptador por cadena. Ninguna lógica de negocio se escribe dos veces fuera de los contratos.
2. **Fase 1 = solo testnet**: Stellar testnet y Avalanche Fuji. Mainnet llega en la Fase 2, después de una revisión del contrato y con permiso explícito del usuario.
3. **El contrato no tiene admin, ni retiro, ni upgrade.** El oráculo, el token y los límites se fijan al desplegar y no cambian. Si algo está mal, se despliega un contrato nuevo.
4. **Strava es la única fuente de verdad del ejercicio.** No se aceptan carreras manuales.
5. **Los datos de Strava no se usan en ninguna función de IA** (prompts, embeddings, entrenamiento). Lo prohíben los términos de la API de Strava.
6. **Por defecto todo corre en modo ensayo** (`SETTLE_MODE=dry-run`): el oráculo calcula y muestra, pero no firma. Pasar a `live` requiere instrucción explícita del usuario en el chat.

## MÉTODO DE TRABAJO (el de AgentPey, con piezas de AgentSales)

Copia y adapta, no reinventes. Para cada archivo de abajo, lee primero el original.

**Ciclo:** fase → `SPEC.md` aprobado por el usuario → tarea → rama → `/revisar` → merge con el OK del usuario.

**Skills** en `.claude/skills/`, copiadas de AgentPey (`~/dev/AgentPay/.claude/skills/`) y adaptadas a este repo:

- `/estado`: dónde estamos y cuál es el siguiente paso. No modifica nada.
- `/fase-plan <n>`: deja el `SPEC.md` de la fase en estado **Aprobado**.
- `/tarea T<n>`: una tarea de punta a punta, en la rama `cc/t<n>-<slug>` desde `origin/main`. Presenta el plan, **espera el OK**, implementa con tests, corre `pnpm check`, documenta, hace commit, **para y muestra el resultado**.
- `/revisar`: el subagente `revisor` revisa el diff contra el spec. Hallazgos 🔴/🟡/🟢, máximo 15.
- `/fase-cerrar <n>`: verifica cada criterio, entrega el plan de demo y escribe una retro de 3 líneas.
- `/adr` no se usa: las decisiones van a `DECISIONES.md`, como en AgentPey.

**Subagentes** en `.claude/agents/`: `revisor` (de AgentPey), `arquitecto` e `integraciones` (de AgentSales). `integraciones` escribe `docs/integraciones/strava.md` con sus 10 secciones fijas.

**Permisos:** `.claude/settings.json` sale de AgentSales, adaptado.

- Deny: leer `.env*`, `git push --force`, `git reset --hard`, `rm -rf`.
- Ask: `git push`, `git merge`, `git tag`, `gh pr`, cualquier deploy (`pnpm deploy:*`) y cualquier `settle --live`.

**Registros:**

- `ROADMAP.md`: plan maestro, en la raíz.
- `docs/ESTADO.md`: memoria entre sesiones, corta, con la leyenda ⏳ 🔨 👀 ✅ ⛔ ✂️ ⏸.
- `docs/DECISIONES.md`: decisiones del proyecto con prefijo `P-`. Formato exacto de AgentPey: estado `Vigente`/`Superada`, motivo y alternativa descartada; nunca se borran entradas.
- Por fase, `docs/fase-<n>-<slug>/` con `SPEC.md`, `BITACORA.md`, `DECISIONES.md` y `evidencia/T<n>.md`. Prefijos por fase: Fase 1 `A-`, Fase 2 `B-`, Fase 3 `C-`.
- `CHANGELOG.md` (de AgentSales) y un tag por fase: Fase 0 `v0.0.1`, Fase 1 `v0.1.0`, Fase 2 `v0.2.0`. Cada tag solo con permiso.

**Numeración:** tareas continuas entre fases (T1, T2, …), como en AgentPey.

**Codex no participa por ahora** (decisión P-6). No se crea `AGENTS.md` ni `AGENT_LOG.md` hasta que el usuario lo pida.

**Reglas de trabajo** (literales de AgentPey, se copian a `CLAUDE.md`):

1. **Para al cerrar cada tarea y muestra el resultado.** No encadenes tareas sin revisión.
2. **No cambies unilateralmente una decisión de `DECISIONES.md`.** Si parece equivocada: dilo, muestra la evidencia, propón la alternativa y **espera**.
3. **Resume en lenguaje llano.** Primero qué quedó funcionando, en palabras que entienda alguien no técnico; después la evidencia técnica.
4. **Idioma:** `docs/` en español. Código, comentarios, commits (Conventional Commits que expliquen el porqué) y `README.md` en inglés.
5. **No construyas lo que está fuera de alcance.** Anótalo en `docs/ESTADO.md` y sigue.
6. **`git add` por nombre de archivo,** nunca `-A` ni un directorio.
7. **`push`, PR y merge solo con autorización explícita del usuario para esa rama.** Merge por fast-forward. Nunca un commit directo a `main`.
8. **Cualquier despliegue, o cualquier cosa contra una red que mueva fondos (aunque sea testnet):** solo con el OK del usuario.
9. **Nunca debilites un test para que pase.**
10. **pnpm 11 sin `minimumReleaseAgeExclude`.** Los `allowBuilds` se aprueban uno por uno, con un comentario que diga el motivo.

**Criterios transversales** (de AgentPey y AgentSales):

- Errores tipados con `code` (`AgentHabitError` + `hasErrorCode`). Nunca un `throw new Error("…")` genérico.
- Todo dato que cruza un borde pasa por **zod**: HTTP, Strava, RPC, env, archivos. Nada de `any`.
- Montos siempre en `bigint` con los decimales del token. Stellar USDC tiene 7 decimales y Avalanche USDC tiene 6.
- Sin credenciales en el código. Todo va en `.env.local`, y `.env.example` se versiona comentado.
- Los scripts escriben las claves en `.env.local`, nunca en argv ni en logs. Un test verifica que ningún secreto aparezca en la salida.
- Cada README documenta el **comando exacto**.
- Versiones: no las hardcodees de memoria. Resuélvelas (`cargo add`, `forge install`, `pnpm add`) y confirma el protocolo vivo de Stellar con `getVersionInfo` por RPC, como en AgentPey (`I-3`).
- Fuentes externas (Strava, Circle, Stellar, Avalanche): verifica en la documentación oficial vigente y cita URL y fecha en el spec.

## DECISIONES YA TOMADAS (impleméntalas, no las re-litigues)

Escríbelas en `docs/DECISIONES.md` en T1, con el formato de AgentPey.

- **P-1 · Repo propio, público, monorepo, Apache-2.0.** Repo `vicentewolde/AgentHabit`, carpeta local `~/dev/AgentHabit`. Alternativa descartada: vivir dentro de AgentPey; mezcla productos y perímetros de fondos.
- **P-2 · Multi-cadena con núcleo común.**
  - `packages/core` tiene el dominio puro: semanas, límites, filtros de Strava y la decisión de liquidación.
  - `packages/chain-stellar` y `packages/chain-avalanche` implementan la misma interfaz `ChainAdapter`.
  - Un contrato por cadena, con semántica idéntica, probada por la misma tabla de casos.
- **P-3 · Contratos.**
  - Stellar: Soroban en Rust, workspace Cargo propio en `contracts/stellar/` (como AgentPey).
  - Avalanche: Solidity con Foundry en `contracts/evm/`, OpenZeppelin `SafeERC20` y `ReentrancyGuard`, sin `Ownable`.
- **P-4 · El oráculo autoriza `settle` por identidad, sin firmas verificadas dentro del contrato.**
  - En Stellar, `oracle.require_auth()`; en EVM, `msg.sender == oracle`.
  - Una clave distinta por cadena, fija al desplegar y sin rotación.
  - Si la clave se pierde, `release_if_stale` devuelve todo y se despliega un contrato nuevo.
  - Alternativa descartada: oráculo rotable con timelock. Agrega superficie a un contrato sin admin y no protege más a montos de 20–50 USDC.
- **P-5 · Stack de servicios.**
  - pnpm 11.24.0 y TypeScript strict, como AgentPey y AgentSales.
  - Biome para lint y formato, de AgentSales.
  - Vitest para tests.
  - API en Hono y base de datos Postgres en Neon con Drizzle, como AgentSales.
  - Web en React + Vite + Tailwind.
  - Hosting en Render (web y API como servicio web, liquidación como Cron Job), como AgentPey.
  - Node: la misma versión que AgentPey en Render (22.x), salvo que T2 encuentre una razón y la registre.
- **P-6 · Sin Codex** en las fases 0 a 2.
- **P-7 · Wallets.**
  - Stellar: `@creit.tech/stellar-wallets-kit` (Freighter, xBull), empaquetado sin CDN, como el `wallet-kit` de AgentPey.
  - Avalanche: `viem` con proveedor inyectado EIP-1193 (Core o MetaMask). Sin WalletConnect en el MVP.

## EL CONTRATO (misma semántica en Stellar y Avalanche)

**Parámetros del constructor, inmutables:** `token`, `oracle`, `min_amount`, `max_amount`, `min_goal_m`, `max_goal_m`, `week_anchor` (timestamp), `week_len` (segundos), `grace` (segundos), `stale_after` (segundos).

**Producción:**

- Montos: 20–50 USDC.
- Meta: 10.000–300.000 metros.
- `week_len` = 604.800 s.
- `week_anchor` = un lunes a las 00:00 en hora UTC-3, la hora de verano de Santiago.
- `grace` = 48 h.
- `stale_after` = 7 días desde el fin de la semana.

**Ensayo:** el mismo contrato, desplegado como instancia aparte con `week_len` = 1 hora y `grace` y `stale_after` proporcionales.

**Funciones (no hay otras):**

- `commit(user, week_id, amount, goal_m)`
  - Requiere la autorización del usuario.
  - `week_id` debe ser la semana siguiente a la actual (ver pregunta abierta 1).
  - Valida el monto y la meta, y permite una posición por (usuario, semana).
  - Transfiere el monto del usuario al contrato y emite un evento.
- `settle(user, week_id, distance_m)`
  - Solo el oráculo.
  - Ventana: `fin_semana + grace ≤ ahora < fin_semana + stale_after`.
  - Si `distance_m ≥ goal_m`, devuelve el depósito (estado `Returned`). Si no, el dinero queda en el contrato (estado `Forfeited`).
  - Emite un evento.
- `release_if_stale(user, week_id)`
  - La puede llamar cualquiera.
  - Si `ahora ≥ fin_semana + stale_after` y la posición sigue `Active`, devuelve el depósito al usuario (estado `ReleasedStale`).
- Lecturas: `get_position`, `current_week`, `config` y `total_forfeited`.

**Invariantes probados con tests en ambas cadenas:**

- No existe forma de sacar fondos salvo hacia el dueño de la posición.
- `settle` falla fuera de su ventana y falla si no firma el oráculo.
- No se puede liquidar dos veces.
- No se puede hacer doble `commit` en la misma semana.
- `release_if_stale` no funciona antes de tiempo.
- Lo `Forfeited` no se mueve nunca.
- En EVM, además, la reentrada está bloqueada y hay fuzz de montos y tiempos.
- Los nombres de los tests son frases de comportamiento, como en AgentPey.

**Límite conocido:** el ancla fija UTC-3 corre una hora cuando Chile pase a horario de invierno (abril de 2027). Se anota en el spec y no se resuelve en el MVP.

## DATOS DE RED (verifícalos en la fuente oficial antes de usarlos y cita la fecha)

| | Stellar testnet | Avalanche Fuji | Stellar mainnet (Fase 2) | Avalanche C-Chain (Fase 2) |
|---|---|---|---|---|
| RPC | `https://soroban-testnet.stellar.org` | `https://api.avax-test.network/ext/bc/C/rpc` (chainId 43113) | elegir proveedor en Fase 2 | `https://api.avax.network/ext/bc/C/rpc` (chainId 43114) |
| USDC | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (el que usa AgentPey) | `0x5425890298aed601595a70AB815c96711a31Bc65` | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (resolver su SAC) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| Decimales USDC | 7 | 6 | 7 | 6 |
| Gas | Friendbot | faucet de Avalanche (manual) | XLM real | AVAX real |
| USDC de prueba | faucet de Circle (manual) | faucet de Circle (manual) | — | — |

Fuente de las direcciones USDC: https://developers.circle.com/stablecoins/usdc-contract-addresses (consultada el 15-oct-2026).

## STRAVA (verificado el 15-oct-2026; `integraciones` lo confirma en T8)

- Crear una app exige una **suscripción de Strava** (desde el 1-jun-2026). La app nace en **modo un jugador**: solo la cuenta del dueño puede conectarse.
- Desde el panel se sube **sin revisión a 10 atletas**. Con eso, los límites son 200 lecturas cada 15 minutos y 2.000 al día. Más de 10 atletas requiere revisión de Strava.
- Login con OAuth 2.0 y scope `activity:read_all`. El access token dura 6 horas y se renueva con el refresh token. Los tokens se guardan cifrados.
- **Cache máximo de 7 días** para datos de la API. Se guarda solo el total semanal y los ids de las actividades usadas como evidencia; los datos crudos se borran después de liquidar.
- Los datos de un usuario no se muestran a otros: sin rankings ni muros.
- Una carrera es válida si:
  - es de tipo `Run`;
  - tiene `manual = false`;
  - tiene `device_name` o `upload_id`;
  - su ritmo es de al menos 2:30 min/km.
- La semana va de lunes 00:00 a domingo 23:59 en UTC-3.
- Fuentes: https://developers.strava.com/docs/getting-started/ y https://developers.strava.com/docs/rate-limits/.

## ESTRUCTURA DEL REPO (objetivo de T1; vacía pero compilando)

```
AgentHabit/
├── CLAUDE.md  ROADMAP.md  README.md  CHANGELOG.md  LICENSE  .env.example  .gitignore  .editorconfig  .nvmrc
├── biome.json  package.json  pnpm-workspace.yaml  tsconfig.base.json  tsconfig.json  vitest.config.ts
├── .claude/{settings.json, skills/{estado,tarea,revisar,fase-plan,fase-cerrar}/SKILL.md, agents/{revisor,arquitecto,integraciones}.md}
├── .github/workflows/ci.yml          # pnpm check + cargo test + forge test; actions pinned by SHA (AgentSales)
├── apps/{web, api, settler}          # settler = the oracle's weekly job
├── packages/{core, config, db, strava, chain-stellar, chain-avalanche}
├── contracts/stellar/{Cargo.toml, rust-toolchain.toml, commitment/}   # no package.json
├── contracts/evm/{foundry.toml, src/Commitment.sol, test/, script/}   # no package.json
├── deployments/{stellar-testnet,avalanche-fuji}.json   # only TS↔contracts bridge
├── scripts/{bootstrap.ts, deploy-stellar.ts, deploy-avalanche.ts, lib/}
└── docs/{ESTADO.md, DECISIONES.md, integraciones/, fase-0-fundamentos/, fase-1-mvp-testnet/}
```

`pnpm check` = `biome check . && tsc -b && vitest run`. `cargo test` y `forge test` corren en CI y en las tareas que tocan contratos.

## FASES

| Fase | Nombre | Qué prueba | Tag |
|---|---|---|---|
| 0 | Fundamentos | El repo existe con el método, las herramientas y el spec de la Fase 1 aprobado | v0.0.1 |
| 1 | MVP en testnet | Un compromiso completo en Stellar testnet y en Fuji: comprometerse, correr, liquidar, fallar y la devolución por plazo vencido | v0.1.0 |
| 2 | Mainnet para el fundador | Revisión del contrato, despliegue en mainnet y 4 semanas de uso real del usuario | v0.2.0 |
| 3 | Piloto con 9 invitados | 4 semanas con dinero real de terceros (9 + el usuario = 10, el máximo de Strava sin revisión) | v0.3.0 |

### Fase 0 · Fundamentos (ahora)

**T1 · Repo y método** (6 h)

- Crea `~/dev/AgentHabit`, `git init` y la rama `cc/t1-repo-y-metodo`.
- Crea la estructura de arriba con paquetes vacíos que compilan.
- Escribe:
  - `CLAUDE.md`, adaptado de AgentPey, con estas reglas y criterios;
  - skills, agentes y `settings.json`;
  - `ROADMAP.md`, `docs/ESTADO.md` y `docs/DECISIONES.md` (P-1 a P-7);
  - `CHANGELOG.md` y `LICENSE`;
  - `.env.example` comentado;
  - este archivo, copiado a `docs/fase-0-fundamentos/`.
- **Hecho cuando:**
  - `pnpm install --frozen-lockfile && pnpm check` está en verde;
  - `/estado` responde con el formato de AgentPey;
  - el usuario aprobó crear el repo en GitHub (`gh repo create vicentewolde/AgentHabit --public`) y el primer PR.

**T2 · Herramientas y claves** (5 h)

- Instala o verifica: Rust stable con target `wasm32v1-none`, `stellar` CLI y Foundry.
- Resuelve las versiones vivas y regístralas como decisiones `P-`.
- Escribe `pnpm run bootstrap`:
  - genera en `.env.local` las claves de testnet: deployer y oráculo por cadena, y un usuario de prueba por cadena;
  - fondea con Friendbot en Stellar;
  - crea la trustline de USDC;
  - imprime las direcciones para los faucets manuales de Fuji y de Circle.
  - Se puede correr de nuevo sin reemplazar claves que ya existen.
- **Hecho cuando:**
  - `pnpm run bootstrap` funciona dos veces seguidas sin pisar nada;
  - `cargo test` y `forge test` corren, aunque sea sobre un contrato vacío;
  - un test verifica que ningún secreto sale por consola.

**T3 · `/fase-plan 1`** (3 h)

- Convierte la lista de tareas de la Fase 1 (abajo) en `docs/fase-1-mvp-testnet/SPEC.md`, con las secciones del spec de la Fase 9 de AgentPey.
- Hace al usuario como máximo 4 preguntas, con opciones y tu recomendación. Las abiertas están al final de este archivo.
- **Hecho cuando:** el spec está en estado **Aprobado** y hay un tag `v0.0.1` (con permiso).

### Fase 1 · MVP en testnet (borrador para T3; no implementes nada antes de que esté aprobado)

**Bloque A · Núcleo y contratos (imprescindible)**

- **T4 · Dominio común** (6 h). `packages/core`:
  - aritmética de semanas (ancla, `week_id`, ventanas);
  - límites y filtros de carreras;
  - decisión de liquidación como función pura;
  - la **tabla de casos compartida** que usan los tests de ambos contratos.
- **T5 · Contrato Soroban y sus tests** (14 h, más de medio día: el contrato y sus tests no se parten).
  - Lleva `__constructor`, extiende el TTL en cada escritura y emite eventos con `#[contractevent]`.
  - Commitea los snapshots de testutils.
- **T6 · Contrato EVM y sus tests** (12 h). Lleva Foundry, fuzz de montos y tiempos, un test de reentrada y la misma tabla de casos que T5.
- **T7 · Despliegue en testnet** (5 h, con el OK del usuario).
  - Scripts que se pueden correr de nuevo, con guardia de desvío (como `deploy-registry.ts` de AgentPey).
  - Escriben `deployments/*.json`.
  - Dos instancias por cadena: producción, con semanas de 7 días, y ensayo, con semanas de 1 hora.

**Bloque B · Strava y oráculo (imprescindible)**

- **T8 · Integración Strava · prueba técnica, parar y mostrar** (3 h).
  - `integraciones` escribe `docs/integraciones/strava.md`.
  - Verifica con la cuenta del usuario: OAuth, scopes, límites, cache de 7 días y el formato real de `device_name`/`upload_id` en carreras de Garmin.
- **T9 · API y base de datos** (10 h).
  - Hono sobre Neon con Drizzle.
  - Tablas:
    - wallet × cadena;
    - conexión Strava con tokens cifrados;
    - espejo de posiciones, leído de la cadena;
    - registro de liquidaciones.
  - Flujo OAuth y renovación de tokens.
- **T10 · Km de la semana** (6 h). Trae las actividades de la ventana, aplica los filtros y suma. Los tests usan fixtures sintéticos; los datos reales del usuario no entran a git.
- **T11 · Liquidación** (8 h).
  - `apps/settler` recorre las posiciones vencidas de ambas cadenas, calcula, llama a `settle` por adaptador y deja registro.
  - Es idempotente y corre en `dry-run` por defecto.
  - Comandos `pnpm settle --chain stellar|avalanche --week <id> [--live]` y `pnpm release-stale`.

**Bloque C · Web (imprescindible salvo lo marcado)**

- **T12 · Pantalla de compromiso** (10 h).
  - Elegir cadena, conectar la wallet y Strava.
  - Monto y meta, con la meta sugerida como promedio de las últimas 4 semanas.
  - Una confirmación que dice en una frase qué pasa si fallas.
- **T13 · Estado de la semana** (5 h; el historial se corta primero). Muestra km contra meta, días restantes, resultado de semanas anteriores y el enlace al explorador.
- **T14 · Reglas y privacidad en lenguaje simple** (2 h).

**Bloque D · Ensayo y cierre**

- **T15 · Ensayo de punta a punta en las dos cadenas** (6 h, con el OK del usuario).
  - En las instancias de 1 hora: cumplir, fallar y `release_if_stale`.
  - Las transacciones se registran en `evidencia/T15.md` con enlaces a stellar.expert y a Snowtrace o Avascan de Fuji.
- **T16 · Publicación en Render** (4 h). Web y API como servicio web, liquidación como Cron Job (miércoles 03:00 UTC). Secretos con `sync: false`.
- **T17 · `/fase-cerrar 1`** (2 h).

**Criterios de aceptación de la Fase 1:**

- [ ] Las dos cadenas pasan la misma tabla de casos.
- [ ] El ensayo T15 queda completo en ambas cadenas.
- [ ] Una semana real de 7 días queda liquidada en testnet por el Cron Job en `dry-run`, y una en `live` con el OK del usuario.
- [ ] Ningún secreto está en git, ni en logs, ni en la salida de los scripts.

**Orden de corte**, si al final de la fase falta tiempo:

1. Historial de T13.
2. Meta sugerida de T12; el usuario escribe la suya.
3. Avalanche en la web; queda solo por script.

T5, T6, T7, T11, T15 y `release_if_stale` no se cortan.

### Fase 2 · Mainnet para el fundador (se planifica con `/fase-plan 2`)

Esbozo, no lo construyas ahora:

- Revisión completa de ambos contratos por `revisor` y `arquitecto`, más la lista de invariantes.
- Despliegue en Stellar mainnet y en Avalanche C-Chain, con permiso.
- Alerta por correo si el Cron Job falla.
- Subir la app de Strava a 10 atletas.
- 4 semanas del usuario con USDC real.

## FUERA DE ALCANCE (no lo construyas)

- Pozos, premios, comisiones o rendimiento sobre depósitos.
- Admin, retiro, upgrade o pausa en los contratos.
- Otras metas que no sean km corridos: gimnasio, pasos, cursos.
- Otras cadenas.
- Pagos en pesos o con tarjeta, onramps.
- App móvil nativa.
- Rankings, muros o cualquier dato de un usuario visible para otro.
- IA con datos de Strava.
- WalletConnect.
- Mainnet antes de la Fase 2.

## PREGUNTAS ABIERTAS (para T3; máximo 4, con tu recomendación)

1. **¿Se puede comprometer para la semana en curso o solo para la siguiente?**
   - Recomendación: solo la siguiente. Así nadie se compromete el jueves con la meta ya corrida.
   - Costo: un usuario nuevo espera hasta el lunes.
2. **Lo perdido: ¿queda en el contrato o se quema?**
   - Recomendación: queda en el contrato, visible en `total_forfeited`.
   - En mainnet se puede evaluar quemarlo (decisión de la Fase 2).
3. **¿Exponential como tablero espejo, como en AgentPey?**
   - Recomendación: no en la Fase 1. Se decide al cerrar la comparación que está en curso en AgentPey.
4. **Dominio para la web y para el callback de Strava.**
   - Recomendación: `localhost` en la Fase 1. El dominio real se elige en T16.

## TAREA INMEDIATA

Empieza por T1. Antes de escribir código, dime en 5 líneas:

1. cómo vas a relacionar el workspace de pnpm con los dos workspaces de contratos (Cargo y Foundry), que no deben tener `package.json`;
2. qué archivos vas a copiar de AgentPey y AgentSales y cuáles vas a escribir desde cero.

Después espera mi OK. Al terminar T1, para y muéstrame el resultado.
