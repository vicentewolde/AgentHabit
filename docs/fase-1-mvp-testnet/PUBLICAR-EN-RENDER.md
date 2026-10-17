# Publicar AgentHabit en Render (T8a)

> Guía para dejar la API y la web publicadas, de modo que tu socio pueda usarlas antes del domingo 25-oct (`A-22`).
> El blueprint es [`render.yaml`](../../render.yaml). **Nada de esto se ha probado todavía en Render**: la primera
> publicación va a ser la prueba, y esta guía dice qué esperar y qué ajustar si falla.

## Qué hay que saber antes

- **Cuatro cosas de la sintaxis de Render no están verificadas contra su referencia completa:** `routes`, `headers`,
  `autoDeployTrigger` y el uso de `npx pnpm`. Render valida el archivo al crear el blueprint y dice qué línea falla.
  Si se queja, me pasas el mensaje y lo corrijo.
- **Plan gratuito.** Entiendo que un servicio web gratuito se duerme tras un rato sin uso y tarda en despertar, pero no
  lo verifiqué hoy. Si pasa, la primera pantalla del socio tardará. Se cambia a un plan de pago desde el panel.
- **Render no tiene región en São Paulo.** El blueprint usa Virginia, la más cercana. La región no se puede cambiar
  después de crear el servicio.
- **La API no tiene ninguna clave de firma.** Solo arma transacciones para que las firmen las wallets. Las claves del
  oráculo se cargan recién con el liquidador (T6b).

## Antes de publicar

1. El contrato de producción tiene que estar desplegado y `deployments/stellar-testnet.json` tiene que estar en
   `main`. Sin ese archivo la API no arranca (`ConfigError`).
2. T6a y T7a tienen que estar mergeadas en `main`: Render publica desde ahí.

## Pasos

1. En <https://dashboard.render.com> elige **New** → **Blueprint** y conecta el repositorio
   `vicentewolde/AgentHabit`, rama `main`.
2. Render lee `render.yaml` y te pide los valores de las variables que no están en el archivo. **Pégalos tú**; no se
   pasan por el chat:

   | Servicio | Variable | Qué poner |
   |---|---|---|
   | `agenthabit-api` | `DATABASE_URL` | La cadena de conexión de Neon (la misma de tu `.env.local`) |
   | `agenthabit-api` | `TOKEN_ENCRYPTION_KEY` | **La misma** clave de tu `.env.local`: con otra, los tokens de Strava guardados no se descifran |
   | `agenthabit-api` | `STRAVA_CLIENT_ID` y `STRAVA_CLIENT_SECRET` | Los de tu app de Strava |
   | `agenthabit-api` | `STRAVA_REDIRECT_URI` | `https://agenthabit-web.onrender.com/strava/callback` |
   | `agenthabit-api` | `WEB_ORIGIN` | `https://agenthabit-web.onrender.com` |
   | `agenthabit-web` | `VITE_API_URL` | `https://agenthabit-api.onrender.com` |

   Esas dos direcciones suponen que Render te deja los nombres `agenthabit-api` y `agenthabit-web`. **Si el nombre ya
   estaba tomado, Render le agrega un sufijo:** copia las direcciones reales de cada servicio y corrige los tres
   valores que las usan (`STRAVA_REDIRECT_URI`, `WEB_ORIGIN` y `VITE_API_URL`), y vuelve a publicar.
3. En tu app de Strava (<https://www.strava.com/settings/api>) cambia el **Authorization Callback Domain** de
   `localhost` al dominio de la web, sin `https://` ni ruta: `agenthabit-web.onrender.com`.
4. Cuando termine la publicación, comprueba que la API responde: `https://agenthabit-api.onrender.com/health` debe dar
   `{"ok":true}`, y `https://agenthabit-api.onrender.com/config` debe mostrar el contrato de producción.
5. Abre la web y recorre el flujo con tu wallet y tu cuenta de Strava.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| El blueprint no se crea y marca una línea | Sintaxis de `routes`, `headers` o `autoDeployTrigger`: pásame el mensaje |
| La compilación dice `pnpm: command not found` | `npx pnpm` no funcionó: cambiar a `corepack enable && pnpm …` |
| La API cae con `ConfigError: No deployed instance` | `deployments/stellar-testnet.json` no está en `main` |
| La API cae con `invalid API environment: …` | Falta una variable de la tabla de arriba, o `DATABASE_URL` / `TOKEN_ENCRYPTION_KEY` mal pegada |
| La web carga, pero toda llamada falla con CORS | `WEB_ORIGIN` no coincide exactamente con la dirección de la web (con `https://`, sin `/` final) |
| Strava dice "redirect_uri mismatch" | El dominio del callback en Strava no es el de la web |
| La web llama a `localhost` | `VITE_API_URL` no estaba al compilar: ponla y vuelve a publicar la web |
