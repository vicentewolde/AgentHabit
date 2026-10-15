# AgentHabit — Plan maestro

> El mapa de las fases: qué prueba cada una, en cuál estamos y qué sigue. El día a día está en
> [docs/ESTADO.md](docs/ESTADO.md); las decisiones, en [docs/DECISIONES.md](docs/DECISIONES.md).
> El contexto completo, con el contrato, los datos de red y Strava, está en el
> [mensaje inicial](docs/fase-0-fundamentos/claude-code-mensaje-inicial.md).

**Actualizado:** 2026-10-15 · **Fase en curso:** Fase 0 · Fundamentos

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
| 0 | Fundamentos | El repo existe con el método, las herramientas y el spec de la Fase 1 aprobado | v0.0.1 | 🔨 en curso |
| 1 | MVP en testnet | Un compromiso completo en Stellar testnet y en Fuji: comprometerse, correr, liquidar, fallar y la devolución por plazo vencido | v0.1.0 | ⏳ |
| 2 | Mainnet para el fundador | Revisión del contrato, despliegue en mainnet y 4 semanas de uso real del usuario | v0.2.0 | ⏳ |
| 3 | Piloto con 9 invitados | 4 semanas con dinero real de terceros (9 + el usuario = 10, el máximo de Strava sin revisión) | v0.3.0 | ⏳ |

Cada tag se crea solo con permiso del usuario.

### Fase 0 · Fundamentos (en curso)

| Tarea | Qué deja |
|---|---|
| T1 · Repo y método | El repo con su estructura vacía pero compilando, el método de AgentPey (skills, agentes, permisos) y los registros |
| T2 · Herramientas y claves | Rust con `wasm32v1-none`, `stellar` CLI y Foundry verificados; versiones vivas como decisiones `P-`; `pnpm run bootstrap` con las claves de testnet en `.env.local` |
| T3 · `/fase-plan 1` | El spec de la Fase 1 aprobado y el tag `v0.0.1` |

### Fase 1 · MVP en testnet

Borrador de tareas T4–T17 en el [mensaje inicial](docs/fase-0-fundamentos/claude-code-mensaje-inicial.md),
sección "Fase 1 · MVP en testnet".
T3 lo convierte en `docs/fase-1-mvp-testnet/SPEC.md`. No se implementa nada antes de que esté
aprobado.

- **Bloque A · Núcleo y contratos:** dominio común (T4), contrato Soroban (T5), contrato EVM
  (T6), despliegue en testnet (T7).
- **Bloque B · Strava y oráculo:** prueba técnica de Strava (T8), API y base de datos (T9), km de
  la semana (T10), liquidación (T11).
- **Bloque C · Web:** pantalla de compromiso (T12), estado de la semana (T13), reglas y
  privacidad (T14).
- **Bloque D · Ensayo y cierre:** ensayo de punta a punta en las dos cadenas (T15), publicación
  en Render (T16), `/fase-cerrar 1` (T17).

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
