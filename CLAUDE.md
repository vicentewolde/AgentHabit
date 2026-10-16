# AgentHabit — instrucciones de trabajo

MVP de compromisos con dinero en juego. El usuario bloquea entre 20 y 50 USDC en un contrato
y fija una meta semanal de kilómetros corridos. Strava verifica las carreras. Si cumple,
recupera todo; si falla, el dinero queda bloqueado para siempre en el contrato. **Nadie lo
cobra**: ni la plataforma ni otros usuarios. Corre en **dos cadenas, Stellar y Avalanche**,
con el mismo comportamiento.

## Lee esto antes de tocar nada

| | |
|---|---|
| [ROADMAP.md](ROADMAP.md) | **Empieza aquí.** Las fases, en cuál estamos, qué sigue |
| [docs/ESTADO.md](docs/ESTADO.md) | El tablero del día a día: fase actual, tabla de tareas, siguiente paso y pendientes del usuario. Lo lee `/estado` y lo actualiza `/tarea` |
| [docs/DECISIONES.md](docs/DECISIONES.md) | Decisiones del proyecto (prefijo `P-`). No se re-litigan: ver regla 2 |
| [docs/fase-1-mvp-testnet/SPEC.md](docs/fase-1-mvp-testnet/SPEC.md) | **Spec de la fase en curso** (Aprobado): tareas T4–T17, el contrato vigente (4.2) y lo verificado de Strava (4.8) |
| [docs/fase-1-mvp-testnet/DECISIONES.md](docs/fase-1-mvp-testnet/DECISIONES.md) | Decisiones de la Fase 1 (prefijo `A-`) |
| [docs/fase-1-mvp-testnet/BITACORA.md](docs/fase-1-mvp-testnet/BITACORA.md) | **Fase en curso.** Qué se hizo en cada tarea de la Fase 1 |
| [docs/fase-0-fundamentos/claude-code-mensaje-inicial.md](docs/fase-0-fundamentos/claude-code-mensaje-inicial.md) | Histórico: el mensaje inicial (contexto y restricciones). El contrato y Strava vigentes están en el spec de la Fase 1, que corrigió este borrador (`A-4`, `A-9`) |
| [docs/fase-0-fundamentos/BITACORA.md](docs/fase-0-fundamentos/BITACORA.md) | Fase 0 cerrada (`v0.0.1`): qué se hizo en T1–T3 |
| [docs/integraciones/](docs/integraciones/) | Notas verificadas de servicios externos (Strava en T8), escritas por el subagente `integraciones` |
| [README.md](README.md) | Cómo correr el proyecto |

## Restricciones no negociables

1. **Dos cadenas desde el día uno: Stellar y Avalanche.** Mismo comportamiento en ambas, con un
   adaptador por cadena (`ChainAdapter`). Ninguna lógica de negocio se escribe dos veces fuera
   de los contratos.
2. **Fase 1 = solo testnet**: Stellar testnet y Avalanche Fuji. Mainnet llega en la Fase 2,
   después de una revisión del contrato y con permiso explícito del usuario.
3. **El contrato no tiene admin, ni retiro, ni upgrade.** El oráculo, el token y los límites se
   fijan al desplegar y no cambian. Si algo está mal, se despliega un contrato nuevo.
4. **Strava es la única fuente de verdad del ejercicio.** No se aceptan carreras manuales.
5. **Los datos de Strava no se usan en ninguna función de IA** (prompts, embeddings,
   entrenamiento). Lo prohíben los términos de la API de Strava.
6. **Por defecto todo corre en modo ensayo** (`SETTLE_MODE=dry-run`): el oráculo calcula y
   muestra, pero no firma. Pasar a `live` requiere instrucción explícita del usuario en el chat.

## Método de trabajo: fase → spec → tareas → rama, commit y revisión

Cada fase tiene un `SPEC.md` con sus tareas; **no se implementa nada que no esté en un spec
aprobado por el usuario**. Si falta algo, se propone y se actualiza el spec antes. Cada sesión
sigue el mismo ciclo, con las skills de `.claude/skills/`:

1. `/estado` — dónde estamos y cuál es el siguiente paso. No modifica nada.
2. `/tarea T<n>` — una tarea del spec de punta a punta: rama `cc/t<n>-<slug>` desde
   `origin/main`, plan (espera el OK), implementación con tests, `pnpm check`, documentación y
   commit. Para y muestra el resultado.
3. `/revisar` — el subagente `revisor` revisa el diff contra el spec, los criterios
   transversales y el perímetro de fondos.
4. Merge — push, PR y fast-forward a `main`, **solo con el OK explícito del usuario para esa
   rama**.

`/fase-plan <n>` deja aprobado el spec de una fase y `/fase-cerrar <n>` la cierra. Las
decisiones van a los `DECISIONES.md`; no hay ADRs aparte (no se usa `/adr`).

Subagentes en `.claude/agents/`: `revisor` (revisa el diff), `arquitecto` (coherencia entre
spec, decisiones y código; solo lectura) e `integraciones` (verifica servicios externos en su
documentación oficial y escribe `docs/integraciones/<servicio>.md`).

**Codex no participa por ahora** (`P-6`). No hay `AGENTS.md` ni `AGENT_LOG.md` hasta que el
usuario lo pida.

## Reglas de trabajo

1. **Para al cerrar cada tarea y muestra el resultado.** No encadenes tareas sin revisión. La
   numeración es continua entre fases (T1, T2, …).
2. **No cambies unilateralmente una decisión de `DECISIONES.md`.** Si parece equivocada: dilo,
   muestra la evidencia, propón la alternativa y **espera**.
3. **Resume en lenguaje llano.** Primero qué quedó funcionando, en palabras que entienda alguien
   no técnico; después la evidencia técnica. Antes de empezar una tarea, 3-4 líneas de qué vas a
   hacer.
4. **Idioma:** `docs/` en español. Código, comentarios, commits (Conventional Commits que
   expliquen el porqué) y `README.md` en inglés.
5. **No construyas lo que está fuera de alcance.** Anótalo en `docs/ESTADO.md` y sigue. Fuera de
   alcance: pozos, premios, comisiones o rendimiento sobre depósitos; admin, retiro, upgrade o
   pausa en los contratos; metas que no sean km corridos; otras cadenas; pagos en pesos, con
   tarjeta u onramps; app móvil nativa; rankings, muros o cualquier dato de un usuario visible
   para otro; IA con datos de Strava; WalletConnect; mainnet antes de la Fase 2.
6. **`git add` por nombre de archivo,** nunca `-A` ni un directorio.
7. **`push`, PR y merge solo con autorización explícita del usuario para esa rama.** Merge por
   fast-forward. Nunca un commit directo a `main`.
8. **Cualquier despliegue, o cualquier cosa contra una red que mueva fondos (aunque sea
   testnet):** solo con el OK del usuario.
9. **Nunca debilites un test para que pase.**
10. **pnpm 11 sin `minimumReleaseAgeExclude`.** Los `allowBuilds` se aprueban uno por uno, con un
    comentario que diga el motivo.

## Al cerrar cada tarea

1. Actualiza **Estado actual** y la tabla de progreso en el `BITACORA.md` de la fase en curso, y
   agrega el bloque de la tarea en lenguaje llano.
2. Agrega las salidas crudas en `evidencia/T<n>.md` de esa misma fase.
3. Agrega toda decisión nueva al `DECISIONES.md` de la fase en curso (Fase 1 `A-`, Fase 2 `B-`,
   Fase 3 `C-`), con motivo y alternativa descartada. Si afecta a más de una fase o a la
   estructura del proyecto, va a `docs/DECISIONES.md` con prefijo `P-`.
4. Actualiza `docs/ESTADO.md`: estado de la tarea, siguiente paso y notas breves.
5. Si cambió algo visible para el usuario, agrega una línea en `[Sin publicar]` de
   `CHANGELOG.md`.
6. Commit con mensaje que explique el **porqué**, no solo el qué.

## Criterios transversales (no negociables)

- Errores tipados con `code`: `AgentHabitError` + `hasErrorCode` (`@agenthabit/core`). **Nunca**
  un `throw new Error("…")` genérico, nunca devolver `undefined` en un fallo.
- Todo dato que cruza un borde pasa por **zod**: HTTP, Strava, RPC, env, archivos. Nada de
  `any`.
- Montos siempre en `bigint` con los decimales del token. Stellar USDC tiene **7** decimales y
  Avalanche USDC tiene **6**.
- Sin credenciales en el código. Todo va en `.env.local`, y `.env.example` se versiona
  comentado.
- Los scripts escriben las claves en `.env.local`, nunca en argv ni en logs. Un test verifica que
  ningún secreto aparezca en la salida.
- Cada README documenta el **comando exacto**, no una descripción del comando.
- Versiones: no las hardcodees de memoria. Resuélvelas (`cargo add`, `forge install`,
  `pnpm add`) y confirma el protocolo vivo de Stellar con `getVersionInfo` por RPC.
- Fuentes externas (Strava, Circle, Stellar, Avalanche): verifica en la documentación oficial
  vigente y cita URL y fecha en el spec.
- `packages/core` es dominio puro: solo zod e imports relativos (Biome lo hace cumplir).
- El único puente entre TypeScript y los contratos es `deployments/*.json`. Ningún paquete TS
  importa archivos de `contracts/`.

## Comandos

```bash
pnpm install
```

```bash
pnpm check
```

```bash
pnpm format
```

```bash
pnpm run contracts:test:stellar
```

```bash
pnpm run contracts:build:stellar
```

```bash
pnpm run contracts:test:evm
```

`pnpm check` = `biome check . && tsc -b && vitest run`; no toca la red. Los tests de contratos
corren en las tareas que tocan contratos y en CI, como jobs aparte. El wasm de Soroban se compila
solo con `pnpm run contracts:build:stellar` (`stellar contract build`, `P-8`).
`contracts:test:evm` necesita Foundry 1.8.5 en el `PATH`
(`export PATH="$PATH:$HOME/.foundry/bin"`).

`rustup` viene de Homebrew y es keg-only; hace falta
`export PATH="/opt/homebrew/opt/rustup/bin:$PATH"` para que exista `cargo`.
