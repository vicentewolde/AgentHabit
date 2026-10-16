# AgentHabit — Plan maestro

> El mapa de las fases: qué prueba cada una, en cuál estamos y qué sigue. El día a día está en
> [docs/ESTADO.md](docs/ESTADO.md); las decisiones, en [docs/DECISIONES.md](docs/DECISIONES.md).
> El contexto inicial está en el [mensaje inicial](docs/fase-0-fundamentos/claude-code-mensaje-inicial.md); el
> contrato y Strava vigentes, en el [spec de la Fase 1](docs/fase-1-mvp-testnet/SPEC.md).

**Actualizado:** 2026-10-16 · **Fase en curso:** Fase 1 · MVP en testnet

## 1. Qué es

Un MVP de compromisos con dinero en juego. El usuario bloquea entre 20 y 50 USDC en un
contrato y fija una meta semanal de kilómetros corridos. Strava verifica las carreras. Si
cumple, recupera todo; si falla, el dinero queda bloqueado para siempre en el contrato.

Lo que fija el diseño, de la evaluación de negocio del 13 y 14 de octubre:

- **Sin pozo ni premios.** Repartir lo perdido entre cumplidores lo acerca a "apuesta en línea"
  (Boletín 14.838-03 en Chile) y crea un conflicto de interés. Lo perdido no va a nadie.
- **Sin comisión.** El MVP no busca ingresos: prueba que la tecnología funciona de punta a punta
  y cómo se comporta la gente con su propio dinero en juego.
- **Sin custodia.** El contrato no tiene admin ni función de retiro. Ni el equipo puede mover los
  fondos.
- **El error del verificador nunca le cuesta al usuario.** Si el oráculo no liquida a tiempo,
  cualquiera puede devolver el depósito a su dueño.

## 2. Fases

| Fase | Nombre | Qué prueba | Tag | Estado |
|---|---|---|---|---|
| 0 | Fundamentos | El repo existe con el método, las herramientas y el spec de la Fase 1 aprobado | v0.0.1 | ✅ cerrada el 16-oct |
| 1 | MVP en testnet | Un compromiso completo en Stellar testnet y en Fuji: comprometerse, correr, liquidar, fallar y la devolución por plazo vencido | v0.1.0 | 🔨 en curso |
| 2 | Mainnet para el fundador | Revisión del contrato, despliegue en mainnet y 4 semanas de uso real del usuario | v0.2.0 | ⏳ |
| 3 | Piloto con 9 invitados | 4 semanas con dinero real de terceros (9 + el usuario = 10, el máximo de Strava sin revisión) | v0.3.0 | ⏳ |

Cada tag se crea solo con permiso del usuario.

### Fase 0 · Fundamentos (cerrada el 16-oct-2026, `v0.0.1`)

| Tarea | Qué deja |
|---|---|
| T1 · Repo y método | El repo con su estructura vacía pero compilando, el método de AgentPey (skills, agentes, permisos) y los registros |
| T2 · Herramientas y claves | Rust con `wasm32v1-none`, `stellar` CLI y Foundry verificados; versiones vivas como decisiones `P-`; `pnpm run bootstrap` con las claves de testnet en `.env.local` |
| T3 · `/fase-plan 1` | El spec de la Fase 1 aprobado y el tag `v0.0.1` |

### Fase 1 · MVP en testnet (en curso)

Spec **Aprobado** el 16-oct-2026: [`docs/fase-1-mvp-testnet/SPEC.md`](docs/fase-1-mvp-testnet/SPEC.md), con sus
decisiones `A-1` a `A-11` en [`DECISIONES.md`](docs/fase-1-mvp-testnet/DECISIONES.md). Unas 93 h, sin fecha
comprometida; la semana real de 7 días va antes del reinicio de Stellar testnet del 16-dic-2026.

| Tarea | Qué deja |
|---|---|
| T4 · Dominio común y tabla de casos | Semanas, filtros, decisión de liquidación y la tabla que leen los dos contratos |
| T5 · Contrato Soroban | El contrato y sus tests, pasando la tabla de casos |
| T6 · Contrato EVM | El contrato, fuzz y reentrada, pasando la misma tabla |
| T7 · Despliegue en testnet | Producción y ensayo en cada cadena, en `deployments/*.json` |
| T8 · Strava, prueba técnica | `docs/integraciones/strava.md`, probado con la cuenta del usuario |
| T9 · API, base y vínculo | Neon, el vínculo wallet ↔ atleta firmado, OAuth y el espejo de posiciones |
| T10 · Km de la semana | La suma de carreras válidas, con purga a los 7 días |
| T11 · Liquidación | El liquidador idempotente, en `dry-run` por defecto |
| T12 · Pantalla de compromiso | Elegir cadena, conectar, comprometer |
| T13 · Estado de la semana | Km contra meta y el botón "recuperar" |
| T14 · Reglas y privacidad | Las reglas en lenguaje simple |
| T15 · Ensayo de punta a punta | Cumplir, fallar y devolución por plazo, con carreras reales, en las dos cadenas |
| T16 · Publicación en Render | Web, API y el Cron Job diario |
| T17 · `/fase-cerrar 1` | Criterios con evidencia y el tag `v0.1.0` |

### Fase 2 · Mainnet para el fundador

Se planifica con `/fase-plan 2`. Esbozo: revisión completa de ambos contratos por `revisor` y
`arquitecto`; despliegue en Stellar mainnet y Avalanche C-Chain, con permiso; alerta por correo
si el Cron Job falla; la app de Strava subida a 10 atletas; 4 semanas del usuario con USDC real.

### Fase 3 · Piloto con 9 invitados

4 semanas con dinero real de terceros. Se planifica al cerrar la Fase 2.

## 3. Fuera de alcance

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
