# Evidencia T6a · Contratos vivos en Stellar

Salidas crudas del 2026-10-17. El código de T6a entró a `main` por el [PR #13](https://github.com/vicentewolde/AgentHabit/pull/13);
el despliegue y esta evidencia, por su PR de cierre. Sin secretos: los tests usan claves sintéticas y una red simulada,
y las salidas reales de abajo solo muestran datos públicos.

## Verificación

Después de `/revisar` (commits `fix`). Antes de la revisión eran 291 tests.

```
$ pnpm check
Checked 103 files in 46ms. No fixes applied.
 Test Files  26 passed (26)
      Tests  318 passed (318)

$ pnpm exec vitest run (archivos de T6a)
 Test Files  11 passed (11)
      Tests  144 passed (144)
```

## Lo que prueba cada archivo

| Archivo | Qué prueba |
|---|---|
| `packages/chain-stellar/test/contract-client.test.ts` | Decodificar una llamada; leer config, semana y posición; armar `commit` y `release_if_stale`; **la regla del reenvío** (otro contrato, otra función, otra wallet, la posición de otro y dos operaciones no se envían); verificar un `commit` por su hash |
| `scripts/lib/deploy-stellar.test.ts` | Primer despliegue, repetición sin efecto, ancla conservada, desvío, wasm distinto y reinicio de testnet con `--reset` |
| `scripts/lib/deploy-stellar-cli.test.ts` | Sin `--yes` no envía nada, ninguna clave llega a la salida, claves o wasm ausentes, opción desconocida, y que el id del USDC de testnet coincide con el verificado el 16-oct |
| `apps/api/test/app.test.ts` | Los endpoints nuevos validados contra los esquemas compartidos: `/config`, `/me`, `/weeks/me`, `/tx/*`, la caché de Strava, lo que ve cada wallet y CORS |
| `packages/core/src/deployments.test.ts` | El formato de `deployments/*.json` y el ancla de lunes a las 00:00 en UTC-3 |

## Lo que no se pudo verificar todavía

- **La forma real de lo que devuelve el contrato desplegado** (`config`, `get_position`): los tests la simulan con la
  forma que `soroban-sdk` documenta. Se confirma con el primer despliegue.
- **Que Freighter firme el `commit` armado por la API.** Lo prueba el usuario en el ensayo del viernes 23.

## Revisión (`/revisar`)

El `revisor` no encontró bloqueantes ni ningún camino para sacar fondos hacia alguien que no sea el dueño. Marcó seis
importantes y varias sugerencias. Corregidos, cada uno con su test:

| Hallazgo | Corrección |
|---|---|
| Un commit que la web no informó dejaba de verse en "recuperar" tras una semana | `/weeks/me` mira las 12 semanas anteriores y las informadas, las consulta juntas y filtra por `Active` antes de limitar |
| La API no contrastaba `deployments/*.json` con el contrato | `verify()` compara token, oráculo, ancla y límites con `config()`; la API no arranca si difieren |
| El comando para enviar el despliegue estaba mal documentado | `pnpm run deploy:stellar --yes`; el README trae también `--reset` |
| La caché de Strava podía mostrar datos de más de 7 días y la purga no corría | Se ignora una lectura vencida y el servidor purga al arrancar y cada hora |
| Un número fuera de rango terminaba como un 500 | El contrato acota `weekId` (u64) y `amount` (i128) antes de llegar al SDK |
| `/tx/submit` no exigía Strava vivo para un `commit` | Lo exige, y un `release_if_stale` siempre pasa |
| Sugerencias: operación con otro origen, argumentos raros, `getAccount` caído, `WEB_ORIGIN` con `/`, plan sin fechas, id de un contrato huérfano | Todas corregidas |

Quedaron como deuda, anotadas: manejar un contrato vencido por inactividad (`restorePreamble`) y un límite de pedidos.

## El despliegue real, con el OK del usuario

El 17-oct, desde la carpeta principal, con las claves de `.env.local` (que el comando lee por sí mismo y no imprime).
Antes se corrió el plan (`pnpm run deploy:stellar`, sin `--yes`), que no envió nada.

```
$ pnpm run deploy:stellar --yes
wasm sha256: d044c26e67e51e9c52acc83f8fa5e52856faf2dc6aeaeb36e27a8a6baf9a1013
Deployed the production instance: CDK2X6SNXMNQDTWEKSTHB5M6N2CLK2RCAFKSTICEKWZV7AL5VPEFUDGR
  anchor (week 0 starts): 2026-10-12T03:00:00.000Z
  now is week 0, which started 2026-10-12T03:00:00.000Z
  a commit made now targets week 1, which starts 2026-10-19T03:00:00.000Z
  contract: https://stellar.expert/explorer/testnet/contract/CDK2X6SNXMNQDTWEKSTHB5M6N2CLK2RCAFKSTICEKWZV7AL5VPEFUDGR
  transaction: https://stellar.expert/explorer/testnet/tx/ea67f35dc028c8bf451e6470fe61a432f9e4efe60b8b47ae1f97f7a7f5840255
Recorded in deployments/stellar-testnet.json
```

El wasm es el mismo que compiló la CI en T4 y en el PR #13 (`d044c26e…`): lo que se desplegó es lo que se probó. El
comando leyó el contrato de vuelta y comprobó que contiene lo desplegado antes de registrarlo, así que `config()` se
decodifica bien contra la red real.

**Repetirlo no hace nada:**

```
$ pnpm run deploy:stellar --yes
Already deployed, nothing to do: CDK2X6SNXMNQDTWEKSTHB5M6N2CLK2RCAFKSTICEKWZV7AL5VPEFUDGR
```

## La lectura contra la red real (`pnpm run smoke:stellar`)

Solo lectura: no envía nada ni mueve fondos. Confirma lo que los tests solo simulaban: cómo decodifica el cliente las
respuestas del contrato real.

```
contract CDK2X6SNXMNQDTWEKSTHB5M6N2CLK2RCAFKSTICEKWZV7AL5VPEFUDGR
ok   config() matches deployments/stellar-testnet.json
ok   current_week()
     week 0
ok   total_forfeited()
     forfeited 0
ok   get_position(test user, next week)
     state None
ok   the network answered the commit simulation: refused with reason InsufficientBalance
```

El usuario de prueba **no tiene USDC todavía**, y la red lo dice con el motivo `InsufficientBalance` (el error 10 del
contrato de USDC, confirmado en vivo). Es el estado normal antes de pedir USDC en el faucet de Circle.

## Verificación

```
$ pnpm check
Checked 105 files in 59ms. No fixes applied.
 Test Files  26 passed (26)
      Tests  321 passed (321)
```
