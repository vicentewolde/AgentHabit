# Decisiones del proyecto

> Registro de decisiones que afectan a **más de una fase** o a la estructura del
> proyecto completo. Una entrada por decisión, con su motivo y la alternativa
> que se descartó. **No se borran entradas**: si una decisión se revierte, se
> marca como `Superada` y se agrega la nueva.
>
> **Prefijo `P-`** (proyecto), para que nunca se confundan con las decisiones de
> una fase concreta: Fase 1 `A-`, Fase 2 `B-`, Fase 3 `C-`, cada una en el
> `DECISIONES.md` de su carpeta.
>
> Plan maestro: [../ROADMAP.md](../ROADMAP.md)

Estados: `Vigente` · `Superada` · `Pendiente`

P-1 a P-7 se tomaron en la evaluación de negocio del 13 y 14 de octubre y se fijaron en el
[mensaje inicial](fase-0-fundamentos/claude-code-mensaje-inicial.md). T1 las registra aquí sin
re-litigarlas.

---

### P-1 · Repo propio, público, monorepo, Apache-2.0 · `Vigente`
**Fecha:** 2026-10-15

AgentHabit vive en su propio repositorio público, `vicentewolde/AgentHabit`, con carpeta local
`~/dev/AgentHabit`, bajo licencia Apache-2.0. Es un monorepo: apps, paquetes, los dos
workspaces de contratos, los despliegues y los scripts conviven en el mismo árbol.

**Motivo.** AgentHabit es un producto distinto de AgentPey y AgentSales, con su propio
perímetro de fondos (depósitos de usuarios bloqueados en un contrato). Mantenerlo aparte deja
claro qué código toca qué dinero. El monorepo mantiene en un solo lugar el contrato de las dos
cadenas, el dominio común que los prueba y los servicios que los usan.

**Alternativa descartada:** vivir dentro de AgentPey. Mezcla productos y perímetros de fondos:
una revisión del contrato de AgentHabit tendría que razonar también sobre los contratos de
AgentPey, y al revés.

---

### P-2 · Multi-cadena con núcleo común · `Vigente`
**Fecha:** 2026-10-15

- `packages/core` tiene el dominio puro: semanas, límites, filtros de Strava y la decisión de
  liquidación.
- `packages/chain-stellar` y `packages/chain-avalanche` implementan la misma interfaz
  `ChainAdapter`.
- Un contrato por cadena, con semántica idéntica, probada por la misma tabla de casos.

**Cómo se relacionan los workspaces (fijado en T1).** El workspace de pnpm cubre solo `apps/*` y
`packages/*`. `contracts/stellar` (Cargo) y `contracts/evm` (Foundry) son workspaces aparte, sin
`package.json`: pnpm no los ve. Desde la raíz los llaman los scripts `contracts:test:stellar` y
`contracts:test:evm`, que no forman parte de `pnpm check`. En CI corren como jobs aparte: el de
Soroban desde T1 y el de Foundry desde T2, cuando se instala la herramienta. El
único puente entre TypeScript y los contratos es `deployments/*.json` (direcciones, parámetros
del constructor y la interfaz exportada por el despliegue), leído con zod por los adaptadores.
Ningún paquete TS importa archivos de `contracts/`. Biome hace cumplir que `packages/core` solo
importe zod y archivos relativos.

**Motivo.** Restricción no negociable 1: el mismo comportamiento en las dos cadenas, sin lógica
de negocio escrita dos veces fuera de los contratos. Con el dominio en un solo paquete y una
tabla de casos compartida, una diferencia entre cadenas aparece como un test que falla.

**Alternativa descartada:** una base de código por cadena, o empezar solo con Stellar y portar
después. Duplica la lógica de semanas y liquidación, y deja que las dos versiones diverjan sin
que nada lo detecte.

---

### P-3 · Contratos: Soroban en Rust y Solidity con Foundry · `Vigente`
**Fecha:** 2026-10-15

- **Stellar:** Soroban en Rust, workspace Cargo propio en `contracts/stellar/` (como AgentPey).
- **Avalanche:** Solidity con Foundry en `contracts/evm/`, OpenZeppelin `SafeERC20` y
  `ReentrancyGuard`, sin `Ownable`.

**Motivo.** Soroban es la plataforma de contratos de Stellar, y el método de AgentPey ya está
probado con ella. En la C-Chain de Avalanche, Solidity es lo estándar; Foundry permite tests y
fuzz en el mismo lenguaje del contrato. `SafeERC20` y `ReentrancyGuard` cubren los dos riesgos
clásicos de mover un ERC-20. `Ownable` no se usa porque el contrato no tiene admin (restricción
no negociable 3).

**Alternativa descartada:** Hardhat para la parte EVM (tests en TypeScript, sin fuzz nativo), o
contratos con `Ownable` para "poder corregir". Un dueño con poderes contradice la ausencia de
custodia que deja al MVP fuera del perímetro de la Ley Fintec.

---

### P-4 · El oráculo autoriza `settle` por identidad, sin firmas verificadas dentro del contrato · `Vigente`
**Fecha:** 2026-10-15

- En Stellar, `oracle.require_auth()`; en EVM, `msg.sender == oracle`.
- Una clave distinta por cadena, fija al desplegar y sin rotación.
- Si la clave se pierde, `release_if_stale` devuelve todo y se despliega un contrato nuevo.

**Motivo.** Es el mecanismo más simple que cada cadena ofrece de forma nativa, y no agrega
superficie al contrato. El caso de una clave perdida ya está cubierto: nadie pierde su depósito,
porque cualquiera puede devolverlo tras `stale_after`.

**Alternativa descartada:** oráculo rotable con timelock. Agrega superficie a un contrato sin
admin y no protege más a montos de 20–50 USDC.

---

### P-5 · Stack de servicios · `Vigente`
**Fecha:** 2026-10-15

- pnpm 11.24.0 y TypeScript strict, como AgentPey y AgentSales.
- Biome para lint y formato, de AgentSales.
- Vitest para tests.
- API en Hono y base de datos Postgres en Neon con Drizzle, como AgentSales.
- Web en React + Vite + Tailwind.
- Hosting en Render (web y API como servicio web, liquidación como Cron Job), como AgentPey.
- Node: la misma versión que AgentPey en Render (22.x), salvo que T2 encuentre una razón y la
  registre.

**Versiones resueltas en T1** (con `pnpm add`, no de memoria): TypeScript 7.0.2, Biome 2.5.15,
Vitest 5.0.4 y `@types/node` 22.20.5. Se fijan exactas en `package.json`, como AgentSales. `.nvmrc`
dice `22`.

**Motivo.** Reutilizar lo que ya funciona en los dos proyectos hermanos: cada pieza tiene un
original del que copiar configuración, CI y convenciones, y el usuario ya opera Render y Neon.

**Alternativa descartada:** ESLint (lo que usa AgentPey), porque Biome hace lint y formato con
una sola herramienta y sin plugins. Node 26 (lo que usa AgentSales), porque Render corre
AgentPey en 22.x y mantener una sola versión en producción simplifica la Fase 1.

---

### P-6 · Sin Codex en las fases 0 a 2 · `Vigente`
**Fecha:** 2026-10-15

Codex no participa. No se crea `AGENTS.md` ni `AGENT_LOG.md` hasta que el usuario lo pida.

**Motivo.** En las fases 0 a 2 casi todo el trabajo está dentro del perímetro de fondos
(contratos, claves, oráculo, despliegues), que en AgentPey nunca se delega a Codex (`P-10` de
AgentPey). Un segundo agente agregaría coordinación (worktrees, bitácora compartida) sin tareas
mecánicas suficientes que delegar.

**Alternativa descartada:** el protocolo de AgentPey con Codex en su propio worktree desde el
día uno.

---

### P-7 · Wallets · `Vigente`
**Fecha:** 2026-10-15

- **Stellar:** `@creit.tech/stellar-wallets-kit` (Freighter, xBull), empaquetado sin CDN, como el
  `wallet-kit` de AgentPey.
- **Avalanche:** `viem` con proveedor inyectado EIP-1193 (Core o MetaMask). Sin WalletConnect en
  el MVP.

**Motivo.** Las dos opciones firman en la extensión del usuario, sin custodia. En Stellar se
reutiliza lo ya probado en AgentPey; empaquetar el kit evita cargar código de un CDN en la
página que firma. En Avalanche, un proveedor inyectado cubre Core y MetaMask sin servicios
externos.

**Alternativa descartada:** WalletConnect. Suma un relay de terceros, una cuenta de proyecto y
dependencias con scripts de instalación, para usuarios que en el MVP usan una extensión de
escritorio.

---

### P-8 · Herramientas y versiones de la Fase 0, resueltas en vivo · `Vigente`
**Fecha:** 2026-10-15 (T2)

Todo se resolvió el 15-oct-2026 contra la fuente, no de memoria:

| Pieza | Versión | Cómo se resolvió |
|---|---|---|
| Protocolo de Stellar testnet | 29 (stellar-core 29.0.0) | `getVersionInfo` y `getNetwork` por RPC |
| `soroban-sdk` | 29.0.1 | `cargo info`: la última estable, que calza con el protocolo 29 |
| Rust | 1.98.0 + `wasm32v1-none` | fijado en `rust-toolchain.toml` (no `stable`, tras `/revisar`) |
| `stellar` CLI | 28.1.0 | última release de `stellar/stellar-cli`; `brew upgrade` |
| Foundry | 1.8.5 | `foundryup` (binarios verificados por atestación) |
| solc | 0.8.37, `evm_version = "cancun"` | última release estable de `ethereum/solidity` |
| forge-std | v1.17.0 (`f3dae6e`) | `forge install` (ver `P-9`) |
| OpenZeppelin Contracts | v5.7.0 (`cab1993`) | `forge install` (ver `P-9`) |
| `@stellar/stellar-sdk` · `viem` · `zod` · `tsx` | 17.2.1 · 2.57.7 · 4.6.7 · 4.23.15 | `pnpm add`, fijadas exactas como en `P-5` |
| Node | se queda en 22 (`P-5`) | T2 no encontró razón para cambiarlo |

**Dos consecuencias que cambian lo que decía el plan:**

- **El contrato de Soroban se compila con `stellar contract build`, no con
  `cargo build --release --target wasm32v1-none`.** `soroban-sdk` 29 rechaza el `cargo build`
  directo ("soroban-sdk requires stellar-cli v25.2.0+ to build a contract"), porque el CLI aplica
  al wasm un paso que cargo no hace. El "Hecho cuando" heredado de la revisión de T1 se cumple con
  el comando nuevo: `pnpm run contracts:build:stellar` en local y un paso del job de CI, con la
  action oficial `stellar/stellar-cli` fijada por SHA.
- **`evm_version` se fija a mano en `cancun`.** La C-Chain de Avalanche corre Cancun y todavía no
  Pectra (ACP-131; guía "Deploy a Smart Contract" de docs.avax.network, consultada el 15-oct), y
  solc 0.8.30 o posterior compila para Pectra por defecto.

**Fijada de verdad.** rustup elige el toolchain según la carpeta desde la que se corre `cargo`, no
según el `--manifest-path`. Por eso `contracts:test:stellar` y `contracts:build:stellar` entran
con `cd` a `contracts/stellar`; desde la raíz usarían el `stable` que haya en la máquina.

**Motivo.** Restricción de `CLAUDE.md`: las versiones no se escriben de memoria y el protocolo
vivo de Stellar se confirma por RPC. Fijar la versión exacta en un solo lugar
(`rust-toolchain.toml`, `Cargo.toml`, `foundry.toml`, `package.json` y `ci.yml`) hace que local y
CI compilen el mismo wasm, que es el que T7 va a desplegar.

**Alternativa descartada:** `soroban-sdk` 28 para conservar el `cargo build` directo (queda un
protocolo atrás de la red, sin ganar nada). Para `cancun`: dejar el `evm_version` por defecto de
solc, que generaría bytecode con opcodes que la C-Chain no ejecuta.

---

### P-9 · Dependencias de Foundry como git submodules fijados a un tag · `Vigente`
**Fecha:** 2026-10-15 (T2)

forge-std y OpenZeppelin viven en `contracts/evm/lib/` como git submodules, cada uno en el commit
de su tag de release. `.gitmodules` está en la raíz y `contracts/evm/foundry.lock` registra el tag
y el commit de cada uno. El job de CI hace checkout con `submodules: true`, sin recursión: los
submodules anidados de OpenZeppelin solo sirven para sus propios tests.

**Motivo.** Es lo estándar de Foundry: el SHA exacto queda en el repo y se puede revisar en un
diff, y no suma un registro de paquetes a la cadena de suministro del contrato que custodia
fondos.

**Alternativa descartada:** Soldeer, el gestor de paquetes de Foundry. Deja menos ruido en git,
pero agrega un registro de terceros y es menos conocido por los revisores. También se descartó
traer OpenZeppelin por npm: pnpm no ve `contracts/` (`P-2`).

---

### P-10 · `pnpm run bootstrap`: claves solo en `.env.local` y la red como única verdad · `Vigente`
**Fecha:** 2026-10-15 (T2)

- **Claves.** Se generan en el proceso con `@stellar/stellar-sdk` y `viem`: deployer, oráculo y
  usuario de prueba, por cadena. Se escriben en `.env.local` con permisos `0600`, mediante un
  archivo temporal y un rename; si la escritura falla, la copia temporal se borra. El script no
  recibe argumentos.
- **Una clave que ya existe nunca se reemplaza.** El bootstrap se detiene con `ConfigError` sin
  tocar el archivo en tres casos:
  - una variable definida dos veces, porque con "gana la última" un `KEY=` pegado debajo de la
    clave real la hacía ver vacía;
  - una clave mal formada;
  - una clave con la forma correcta pero inválida: el checksum de StrKey en Stellar, el rango
    1 ≤ n < orden de secp256k1 en EVM.

  Todas las direcciones se derivan antes de escribir.
- **Una corrida a la vez.** Un lock `.env.local.lock` con el pid evita que dos bootstraps en
  paralelo generen claves distintas para las mismas variables. Si el lock lo dejó una corrida que
  murió, se retoma.
- **Salida.** Solo direcciones públicas. Cada línea pasa por un guardián que detiene la corrida
  con `SecretLeak` si contiene un secreto, también sin el `0x` o en otra capitalización. Ante un
  error, `runBootstrapCli` imprime solo el `code` y el mensaje propio, nunca la causa de una
  dependencia. Esa línea también pasa por el guardián, armado con las claves del archivo, y si
  contiene una se omite. El error de viem para una clave fuera de rango cita la clave en decimal,
  así que nunca se encadena como `cause`.
- **Red.** Antes de mover nada verifica con `getNetwork` que la RPC sirve testnet. Fondea con
  Friendbot solo las cuentas que no existen y crea la trustline de USDC solo para el usuario de
  prueba, y solo si no existe. En Fuji no toca la red: imprime las direcciones para los faucets
  manuales.
- **Friendbot no se cree en su respuesta.** Tras pedir los fondos, el bootstrap espera a ver la
  cuenta en el ledger. El 15-oct Friendbot creó las cuentas y luego dejó la conexión abierta unos
  cinco minutos sin responder, y `fundAddress` del SDK consulta la transacción una sola vez, antes
  de que la RPC la vea, así que daba por fallida una cuenta ya creada.
- **Ejecución.** `tsx --conditions=@agenthabit/source`, como AgentSales, con `esbuild: false` en
  `allowBuilds`.

**Motivo.** Criterios de `CLAUDE.md`: las claves nunca pasan por argv ni por logs, y un test lo
verifica. Comprobar el estado antes de actuar hace que el script se pueda repetir. Fiarse del
ledger y no de un servicio auxiliar hace que una segunda corrida arregle lo que la primera dejó a
medias.

**Alternativa descartada:** `stellar keys generate` y `stellar keys fund` del CLI. Guardan las
claves en la configuración del CLI, fuera de `.env.local`, y moverlas obliga a pasar el secreto
por un comando. También se descartó `rpc.Server.fundAddress` del SDK, por la carrera descrita
arriba.
