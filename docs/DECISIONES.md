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
`contracts:test:evm`, que no forman parte de `pnpm check`; en CI corren como jobs aparte. El
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
