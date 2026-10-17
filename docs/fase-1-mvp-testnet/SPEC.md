# Spec Fase 1 · MVP en testnet

- **Estado:** Aprobado (2026-10-16)
- **Rama base:** `main`
- **Tareas:** T4 a T9, agrupadas el 16-oct para ganar velocidad (sección 11). T10 a T12 quedan reservadas por si hay que
  partir alguna; la Fase 2 numera desde T13
- **Fechas:** desde el 16-oct-2026, sin fecha comprometida. Límite práctico: el **reinicio de Stellar
  testnet del 16-dic-2026**, que borra cuentas y contratos (secciones 8 y 9)
- **Referencias:** [mensaje inicial](../fase-0-fundamentos/claude-code-mensaje-inicial.md) (borrador de esta fase, el
  contrato, los datos de red y Strava), [`docs/DECISIONES.md`](../DECISIONES.md) (`P-1` a `P-10`),
  [`CLAUDE.md`](../../CLAUDE.md) (restricciones y criterios transversales). Decisiones de la fase con prefijo `A-`
  en [`DECISIONES.md`](DECISIONES.md)

## 1. Objetivo

Hoy el repo tiene las herramientas, las claves de testnet y dos contratos vacíos. **Al terminar la fase, un
compromiso completo funciona en Stellar testnet y en Avalanche Fuji:**

1. el usuario elige cadena, conecta su wallet y Strava, y bloquea entre 20 y 50 USDC de prueba con una meta de km
   para la semana siguiente;
2. corre, y Strava registra las carreras;
3. al abrirse la ventana de liquidación, el oráculo suma los km válidos y liquida: si cumplió, el depósito vuelve;
   si no, queda bloqueado para siempre en el contrato;
4. si el oráculo no liquida a tiempo, cualquiera puede devolver el depósito a su dueño (`release_if_stale`), y el
   propio sistema lo hace.

Las dos cadenas se comportan igual porque pasan la misma tabla de casos (`P-2`). Todo corre en `dry-run` por
defecto; firmar en `live` y cualquier transacción que mueva fondos piden el OK del usuario.

## 2. Alcance

| Bloque | Qué deja | Tareas |
|---|---|---|
| **A** · Núcleo y contratos | Dominio común, tabla de casos y los dos contratos | T4 |
| **B** · Strava y API | Conexión con Strava, API y base, vínculo firmado, km de la semana | T5 |
| **C** · Despliegue y oráculo | Contratos en testnet y liquidación idempotente en las dos cadenas | T6 |
| **D** · Web | Comprometerse, ver la semana, reglas y privacidad | T7 |
| **E** · Ensayo y cierre | Ensayo de punta a punta en las dos cadenas, publicación en Render, cierre | T8, T9 |

## 3. Fuera de alcance

Lo de la regla 5 de `CLAUDE.md`, sin excepciones en esta fase:

- pozos, premios, comisiones o rendimiento sobre depósitos;
- admin, retiro, upgrade o pausa en los contratos;
- metas que no sean km corridos;
- otras cadenas;
- pagos en pesos, con tarjeta u onramps;
- app móvil nativa;
- rankings, muros o cualquier dato de un usuario visible para otro;
- IA con datos de Strava;
- WalletConnect;
- mainnet: llega en la Fase 2.

También queda fuera de esta fase, porque es de la Fase 2:
- alertas por correo;
- subir la app de Strava a 10 atletas;
- la revisión de contratos para mainnet;
- la consulta a Strava sobre los términos (4.8).

Los webhooks de Strava tampoco entran en la Fase 1 (4.8).

## 4. Diseño

### 4.1 Hechos que fijan el diseño (verificados el 16-oct sobre `a4198f1`)

**El código hoy.**
- `packages/core` solo tiene `AgentHabitError` y `hasErrorCode`, con los códigos `ConfigError`, `NetworkError` y
  `SecretLeak`. Biome le impide importar algo distinto de zod o de archivos relativos.
- `packages/config` valida el entorno con zod: `SETTLE_MODE`, las URLs RPC y las claves, con checksum y rango.
- Los paquetes `db`, `strava`, `chain-stellar` y `chain-avalanche`, y las apps `api`, `web` y `settler`, son stubs.
- Los dos contratos están vacíos pero compilan y tienen un test cada uno. Herramientas y versiones: `P-8`.
- Los jobs de contratos de CI no corren pnpm.
- `pnpm run bootstrap` dejó en `.env.local` las claves de deployer, oráculo y usuario de prueba por cadena
  (`P-10`). Las cuentas de Stellar están fondeadas y el usuario de prueba tiene la trustline de USDC.
- `.claude/settings.json` pide confirmación para `pnpm settle` solo si el comando lleva `--live`.

**La red.**

| Dato | Valor | Fuente y fecha |
|---|---|---|
| Protocolo de Stellar testnet | 29 | `getVersionInfo`, 16-oct |
| USDC de Stellar testnet | `USDC:GBBD47IF…LFLA5`; SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, 7 decimales | [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses), 15-oct; SAC derivado con `Asset.contractId` el 16-oct |
| USDC de Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65`, 6 decimales | [Circle](https://developers.circle.com/stablecoins/usdc-contract-addresses), 15-oct |
| Fuji | chainId 43113 (`eth_chainId` = `0xa869`), EVM Cancun sin Pectra | RPC, 16-oct; [ACP-131](https://docs.avax.network/docs/acps/131-cancun-eips) |
| Faucet de USDC de Circle | 20 USDC por pedido, uno cada 2 horas por dirección y cadena; incluye Stellar testnet y Fuji | [faucet.circle.com](https://faucet.circle.com/), 16-oct |
| Historial de eventos de la RPC de Stellar | anuncia 120.960 ledgers (7 días), pero el 16-oct el ledger más viejo disponible tenía ~19 h | `getHealth`, 16-oct |
| Reinicios de Stellar testnet | 2 a 4 por año; el próximo, el **16-dic-2026** a las 17:00 UTC | [developers.stellar.org/docs/networks](https://developers.stellar.org/docs/networks), 16-oct |

**Strava:** los datos del mensaje inicial, verificados por el subagente `integraciones` el 16-oct (sección 4.8).
Tres correcciones al borrador:
- los límites de lectura en modo un jugador son 100 cada 15 minutos y 1.000 al día;
- el refresh token rota en cada renovación;
- el cache de 7 días alcanza también al total semanal y a los ids de las actividades.

### 4.2 El contrato (misma semántica en Soroban y en EVM)

**Constructor, inmutable:** `token`, `oracle`, `min_amount`, `max_amount`, `min_goal_m`, `max_goal_m`,
`week_anchor`, `week_len`, `grace` y `stale_after`.
- **Valida:** `0 < min_amount ≤ max_amount`, `0 < min_goal_m ≤ max_goal_m`, `week_len > 0` y
  `0 < grace < stale_after`.
- No hay admin, ni retiro, ni upgrade, ni pausa (`CLAUDE.md`, restricción 3).

| Instancia | Montos | Meta | `week_len` | `grace` | `stale_after` |
|---|---|---|---|---|---|
| Producción | 20–50 USDC (en unidades del token: ×10⁷ en Stellar, ×10⁶ en Fuji) | 10.000–300.000 m | 604.800 s | 172.800 s (48 h) | 604.800 s (7 días) |
| Ensayo | los mismos | 500–300.000 m (`A-11`) | 3.600 s (1 hora) | 1.020 s (17 min) | 3.600 s |

**`week_anchor`** es un lunes a las 00:00 en UTC-3, un timestamp fijo. Límite conocido: en abril de 2027, cuando
Chile pase a horario de invierno, la semana empieza a la 01:00 local. No se resuelve en el MVP.

**Tipos, iguales en las dos cadenas:**

| Dato | Tipo |
|---|---|
| Timestamps, `week_len`, `grace`, `stale_after` | `u64` |
| `week_id`, `goal_m` | `u64` |
| Montos | `i128` en Soroban (por el SAC) y `uint256` en EVM; siempre dentro de `[min_amount, max_amount]` |

**Aritmética del tiempo,** definida una vez en `packages/core` (T4) y reimplementada igual en cada contrato:

- `current_week = floor((now − week_anchor) / week_len)`.
- Antes del ancla no hay semana: `current_week` y `commit` fallan con el error `BeforeAnchor`. No hay underflow.
- `week_end(w) = week_anchor + (w + 1) · week_len`.
- Ventana de `settle`: `week_end + grace ≤ now < week_end + stale_after`.
- Ventana de `release_if_stale`: `now ≥ week_end + stale_after`.
- `now` es el tiempo de la cadena: el timestamp del ledger o del bloque.

**Estados de una posición:** `None` (no existe), `Active`, y los finales `Returned`, `Forfeited` y
`ReleasedStale`.

**Funciones, y no hay otras:**

- **`commit(user, week_id, amount, goal_m)`**
  - Requiere la autorización de `user`: `require_auth` en Soroban; en EVM, `msg.sender == user`.
  - `week_id` tiene que ser exactamente `current_week + 1`: solo se compromete la semana siguiente (`A-8`). Un
    `commit` firmado al final de una semana que entra a la cadena después del borde revierte, y eso es seguro.
  - Valida monto y meta contra los límites.
  - Hay una sola posición por (usuario, semana): si ya existe, en cualquier estado, falla con
    `AlreadyCommitted`.
  - Transfiere el monto del usuario al contrato (el SAC en Soroban; en EVM, `SafeERC20.safeTransferFrom` con un
    `approve` previo). Verifica que el saldo del contrato subió exactamente en `amount`, y si no, revierte: protege
    de un token que cobre comisión.
  - Emite `Committed`.
- **`settle(user, week_id, met)`**
  - Solo el oráculo (`P-4`), dentro de la ventana y con la posición `Active`.
  - `met` es un booleano: **la distancia no se publica en la cadena** (`A-4`, por POL 6.2 y 2.3 de Strava, ver
    4.8). La comparación `distancia ≥ meta` vive una sola vez en `packages/core` y la hace el oráculo.
  - Si `met`, devuelve el monto (`Returned`). Si no, el monto queda en el contrato (`Forfeited`) y suma a
    `total_forfeited`.
  - Emite `Settled`.
- **`release_if_stale(user, week_id)`**
  - La puede llamar cualquiera, una vez abierta su ventana y con la posición `Active`.
  - Devuelve el monto a `user` (`ReleasedStale`).
  - Emite `ReleasedStale`.
- **Lecturas:** `get_position`, `current_week`, `config` y `total_forfeited`.

**Orden de las validaciones,** el mismo en las dos cadenas, para que dos errores simultáneos den el mismo
resultado:
1. existe la semana (`BeforeAnchor`);
2. autorización;
3. estado de la posición;
4. ventana de tiempo;
5. límites de monto y meta;
6. token.

T4 lo fija exacto por función y la tabla de casos lo prueba.

**Si el token rechaza la devolución** (USDC en blacklist en EVM, trustline quitada o desautorizada en Stellar):
- `settle` con `met = true` y `release_if_stale` revierten enteros, y la posición sigue `Active`. No hay try/catch
  ni "pull payment".
- El usuario la recupera cuando el token vuelva a aceptarlo: `release_if_stale` no tiene plazo.
- Las demás posiciones no se tocan.

**Propios de Soroban:**
- `__constructor` y eventos con `#[contractevent]`.
- Las posiciones van en almacenamiento `persistent`, nunca `temporary`.
- Cada escritura extiende el TTL de la posición y de la instancia, de modo que cubra desde el `commit` hasta
  `week_end + stale_after` con margen: al menos 30 días en producción. T4 fija las cifras en ledgers dentro de los
  límites de la red y verifica la restauración de entradas archivadas en el protocolo 29.
- Snapshots de testutils commiteados.

**Propios de EVM:**
- `ReentrancyGuard` en las tres funciones que mueven fondos, `SafeERC20` y sin `Ownable`.
- Fuzz de montos y tiempos con Foundry.

**Invariantes, probados en las dos cadenas con la tabla de casos de T4:**
- Ninguna función saca fondos salvo hacia el dueño de la posición.
- **Después de cada paso:** `saldo(contrato) = Σ montos Active + total_forfeited`.
- `settle` falla fuera de su ventana o si no lo llama el oráculo.
- Una posición no se liquida dos veces, y no hay dos `commit` en la misma semana.
- `release_if_stale` no funciona antes de tiempo.
- Lo `Forfeited` no se mueve nunca.

### 4.3 La tabla de casos compartida (el puente entre los dos contratos)

- **Dónde vive y quién la lee** (`A-3`):
  - La tabla se escribe como datos en `packages/core`.
  - `scripts/gen-cases.ts` la exporta a `contracts/fixtures/cases.json`, que se commitea.
  - El generador vive en `scripts/`, porque `packages/core` no puede usar `node:fs` (Biome).
  - Escribir en `contracts/` desde un script no viola `P-2`: ningún paquete TS importa de ahí.
- **Test de desvío.** Un test de vitest, dentro de `pnpm check`, falla si el JSON commiteado no coincide con el que
  genera la tabla. Hace falta porque los jobs de contratos de CI no corren pnpm.
- **Cómo la leen los contratos.**
  - Los tests de Rust la leen con `serde_json`, como dev-dependency resuelta con `cargo add`.
  - Los de Foundry, con `vm.parseJson`, con `fs_permissions` de lectura en `foundry.toml`.
- **Formato:**
  - esquema plano, con claves en orden alfabético y tipos homogéneos (lo exige `vm.parseJson`);
  - números grandes como strings decimales;
  - actores simbólicos: `user`, `oracle`, `stranger`;
  - montos relativos a `min_amount` y `max_amount`, que cada runner escala a los decimales de su cadena.
- **Errores por nombre, no por número.**
  - Solidity identifica sus errores personalizados por selector, sin número. El número solo existe en el
    `#[contracterror]` de Soroban, y lo fija la tabla.
  - Los fallos ajenos al contrato tienen dos categorías comunes, que cada runner traduce a lo nativo:
    - `Unauthorized`: `require_auth` del host en Soroban, o el error propio en EVM;
    - `TokenFailure`: un error del SAC, o `SafeERC20` en EVM.
- **Qué cubre cada caso.** Una entrada (tiempo, actor, función y argumentos) y una salida esperada (estado, saldos y
  error, o éxito). Después de cada paso se verifica el invariante de saldos.

Así una diferencia entre cadenas aparece como un test que falla en una sola de ellas (`P-2`).

### 4.4 Cuentas, vínculo con Strava y cómo el oráculo encuentra las posiciones

**Vínculo wallet ↔ atleta, firmado.**
- Para asociar una wallet de una cadena a una cuenta de Strava, la wallet firma un mensaje de la API con un nonce y
  un vencimiento. Los dos kits de `P-7` firman mensajes.
- Sin esa firma, alguien podría asociar la wallet de otra persona a una cuenta de Strava vacía, y esa posición se
  liquidaría como no cumplida.
- La misma firma abre la sesión con la que la API autentica las lecturas de la web (T7).

**El espejo de posiciones** (`A-2`). El liquidador **no descubre las posiciones leyendo eventos**:
- la RPC pública de Stellar guarda ~19 h de eventos (4.1), y el `commit` puede tener más de una semana al
  liquidarse;
- la RPC pública de Fuji limita el rango de `eth_getLogs`.

En cambio:

1. Tras un `commit` confirmado, la web informa a la API la cadena, el contrato, la semana y el hash.
2. La API lee `get_position` en la cadena y verifica el hash. Recién entonces guarda la posición, sin confiar en lo
   que dice la web.
3. Al guardarla, congela el `athlete_id` vinculado en ese momento. Un cambio de vínculo posterior no afecta a una
   posición `Active`.
4. La clave del espejo y del registro de liquidaciones es `(cadena, dirección del contrato, usuario, week_id)`. Así
   no se mezclan las instancias de producción y de ensayo, ni las direcciones nuevas tras un reinicio de testnet.
5. Antes de cada `settle` o `release_if_stale`, el liquidador vuelve a leer la posición en la cadena.

**Si la web nunca informó una posición,** nadie la liquida y vence. Entonces la devuelve `release_if_stale`:
- la llama el usuario desde el botón "recuperar" de la web (T7), que firma su propia wallet;
- o cualquiera, porque la función es abierta.

### 4.5 Strava y la semana

- **La ventana de una semana es semiabierta, `[week_start, week_end)`, medida sobre `start_date` en UTC.**
  - No se usa `start_date_local`, que cambia con la zona horaria del atleta.
  - Una carrera cuenta en la semana en que empezó.
- Para cada posición, el oráculo lista las actividades del atleta congelado en el espejo con
  `GET /athlete/activities` y suma las válidas:
  - con `sport_type` `Run` o `TrailRun` (`A-9`);
  - con `trainer` distinto de `true`;
  - con `manual = false`;
  - con `device_name` o `upload_id`;
  - con distancia y `moving_time` mayores que 0;
  - con un ritmo, calculado con `moving_time`, de 2:30 min/km o más lento. Es un filtro contra autos y bicicletas
    mal etiquetados.
- La suma se hace en metros enteros: cada actividad se trunca a metro antes de sumar. `met = total ≥ goal_m`.
- **Retención (POL 6.2).**
  - El total y los ids de las actividades se borran a los 7 días de leídos, o al liquidar, lo que pase primero.
  - Lo mismo vale para las lecturas de la web durante la semana (T7).
  - El Cron purga lo vencido.
  - Para siempre solo queda el resultado (cumplió o no) y el hash de la liquidación.
- **OAuth 2.0 con `activity:read_all`,** validando el `scope` devuelto.
  - Con `activity:read` no se ven las carreras "Only You", y no contarían.
  - El access token dura 6 horas. El refresh token rota y se guarda de forma atómica.
  - Los tokens se guardan cifrados con `TOKEN_ENCRYPTION_KEY`.
- **Ningún dato de Strava llega a una función de IA** (POL 5.3; `CLAUDE.md`, restricción 5) ni se muestra a otro
  usuario (POL 2.3).
- El detalle de lo verificado está en 4.8. T5 lo confirma con la cuenta real y escribe `docs/integraciones/strava.md`.

### 4.6 Liquidación (`apps/settler`)

- **Solo con datos completos.** `settle` se llama solo si la lectura de Strava fue completa y sin errores.
  - Cualquier error salta esa posición sin cortar la corrida: un 429, un 5xx, un fallo a mitad de la paginación,
    un error de la RPC o un token vencido.
  - Si no se resuelve antes de que cierre la ventana, la posición termina en `release_if_stale`. El error del
    verificador nunca le cuesta al usuario.
- **Acceso revocado = 0 km** (`A-10`). Si el usuario revocó el acceso de AgentHabit a Strava, su semana se liquida
  como no cumplida (`Forfeited`). Hay revocación cuando:
  - el usuario desconecta Strava desde la web, y la API lo registra;
  - Strava rechaza el refresh token como inválido o revocado.

  Eso se diferencia de un error pasajero, que solo salta la posición. Las reglas y la confirmación de la web (T7) lo
  dicen en una frase.

  Riesgo: un refresh token que perdiéramos nosotros se vería igual que una revocación. Por eso la rotación se
  guarda de forma atómica, con test (T5), y el liquidador registra el motivo.
- **Idempotente.** Lee la posición en la cadena antes de actuar, con el tiempo de la cadena, así que una segunda
  corrida no hace nada. Espera el recibo de cada transacción antes de registrarla.
- **Modo** (`A-7`).
  - Firma solo si `SETTLE_MODE=live` **y** el comando lleva `--live`. El Cron Job lleva los dos explícitos en
    `render.yaml`.
  - En `dry-run` el liquidador no carga la clave del oráculo: el adaptador recibe un firmante solo en `live`.
  - `release-stale` respeta el mismo modo.
  - Pasar a `live` requiere instrucción explícita del usuario en el chat (`CLAUDE.md`, restricción 6).
- **Comandos:**
  - `pnpm settle --chain stellar|avalanche --instance production|rehearsal [--week <id>] [--live]`
  - `pnpm release-stale --chain … --instance … [--live]`
- **Cron Job diario** en Render, a las 03:30 UTC (`A-1`). El borrador decía un solo cron, el miércoles a las 03:00
  UTC.
  - La ventana de `settle` abre el miércoles a las 03:00 UTC: el domingo a las 24:00 en UTC-3, más 48 h.
  - Un cron semanal que fallara una vez recién volvería a intentar cuando la ventana ya cerró, y la posición se
    devolvería por `release_if_stale` aunque el usuario no hubiera cumplido.
  - Cada corrida hace tres cosas: liquida lo que está en ventana, llama a `release_if_stale` para lo vencido y
    purga los datos de Strava vencidos.
- **Registro.** Cada liquidación queda en la base: clave de 4.4, decisión, hash, modo y fecha. No guarda la
  distancia más allá de los 7 días de 4.5.
- **Ensayo** (`A-11`).
  - En las instancias `rehearsal` el resultado también sale de Strava: el usuario corre dentro de la hora
    comprometida.
  - Por eso la meta mínima del ensayo es 500 m.
  - El liquidador no tiene ningún camino para un resultado manual, en ninguna instancia (`CLAUDE.md`,
    restricción 4).

### 4.7 Despliegue y la interfaz `ChainAdapter`

**Scripts de despliegue.** `pnpm run deploy:stellar` y `pnpm run deploy:avalanche` despliegan dos instancias por
cadena: producción y ensayo.
- Se pueden correr de nuevo: si `deployments/<red>.json` ya registra una instancia con el mismo wasm o bytecode y los
  mismos parámetros, no la vuelven a desplegar.
- Tienen guardia de desvío: si lo registrado no coincide con lo que hay en la red, se detienen.
- **Tras un reinicio de testnet:** el script detecta que el contrato registrado ya no existe. Con el OK del
  usuario, archiva la entrada marcada `reset` y vuelve a desplegar. Comprueba antes que el SAC de USDC siga
  existiendo, y si no, lo informa. T6 lo prueba.

**`deployments/stellar-testnet.json` y `deployments/avalanche-fuji.json`** registran, por instancia:
- el tipo (`production` o `rehearsal`) y la dirección;
- el hash del wasm o del bytecode;
- los parámetros del constructor;
- el hash de la transacción y la fecha;
- la interfaz exportada: spec del contrato en Soroban, ABI en EVM.

Son el único puente entre TS y los contratos (`P-2`) y se leen con zod.

**La interfaz `ChainAdapter`.** Sus tipos puros viven en `packages/core`; la implementan `chain-stellar` y
`chain-avalanche`.
- **Lecturas:** `config`, `currentWeek`, `getPosition` y `totalForfeited`.
- **Construir la transacción que firma la wallet:** `buildCommit` (más el `approve` en EVM) y
  `buildReleaseIfStale`.
- **Firmar con un firmante que se recibe solo en `live`:** `settle` y `releaseIfStale`.
- **Verificar un mensaje firmado por una wallet** (4.4).

Los montos son `bigint` con los decimales del token de cada cadena.

### 4.8 Strava: lo verificado en la documentación oficial

Lo verificó el subagente `integraciones` el 16-oct-2026, solo con fuentes oficiales. Fuentes:
- [Getting Started](https://developers.strava.com/docs/getting-started/) (GS)
- [Authentication](https://developers.strava.com/docs/authentication/) (AUTH)
- [Rate Limits](https://developers.strava.com/docs/rate-limits/) (RL)
- [API Reference](https://developers.strava.com/docs/reference/) (REF)
- [Changelog](https://developers.strava.com/docs/changelog/) (CL)
- [Webhooks](https://developers.strava.com/docs/webhooks/) (WH)
- [API Agreement](https://www.strava.com/legal/api) (AGR)
- [API Policy](https://www.strava.com/legal/api_policy) (POL, vigente desde el 1-jun-2026)
- [Brand Guidelines](https://developers.strava.com/guidelines/) (BRAND)

| Tema | Lo verificado | Qué cambia en el diseño |
|---|---|---|
| Suscripción | Crear una app exige una suscripción de Strava (GS; POL 3.3) | Es del dueño de la app, el usuario. Si cada invitado de la Fase 3 también necesita una, no está verificado |
| Capacidad | Toda app nueva nace con capacidad 1, en modo un jugador. Se sube a 10 atletas desde el panel, sin revisión; más de 10 requiere revisión (RL; POL 3.3) | En la Fase 1 solo se conecta la cuenta del usuario |
| Límites | Con capacidad 1: **lecturas 100 cada 15 min y 1.000 al día**, total 200 y 2.000. Con capacidad 10: lecturas 200 y 2.000. Las cabeceras son `X-ReadRateLimit-*` (RL) | T5 lee las cabeceras y respeta los límites de lectura, que son los que aplican |
| Scope | `activity:read` deja fuera las actividades "Only You". `activity:read_all` las incluye (AUTH; REF). La respuesta trae el `scope` aceptado y hay que validarlo (CL, 23-abr-2026) | Se pide `activity:read_all`, como en el borrador. Si el usuario no acepta ese scope, la conexión se rechaza |
| Tokens | El access token dura 6 h. **El refresh token rota**: al emitirse uno nuevo, el anterior deja de servir (AUTH) | T5 guarda cada token nuevo de forma atómica. Una renovación rechazada es revocación (`A-10`) solo si el cuerpo nombra al refresh token como inválido y el token guardado sigue siendo el usado; un 401 del listado y todo lo demás son errores pasajeros (`A-17`) |
| Campos | `sport_type` es el campo vigente; `type` está deprecado. `Run`, `TrailRun` y `VirtualRun` son valores distintos. **`device_name` viene en el listado** desde el 27-oct-2025, junto con `manual`, `trainer`, `upload_id`, `distance` (m), `moving_time`, `start_date` (UTC) y `timezone` (REF; CL) | Una sola lectura por página de actividades, sin pedir el detalle de cada una. En zod, todos los campos son opcionales |
| Listado | `GET /athlete/activities` con `after` y `before` en epoch, y paginación con `page` y `per_page`. **No hay máximo documentado de `per_page`** (REF) | T5 pide páginas chicas, pagina hasta una página vacía y mide el máximo real (`A-17`) |
| Cache | **POL 6.2: no se puede guardar Strava Data más de 7 días**, ni mostrarlo a terceros. POL 6.4 limita la retención al propósito, y POL 6.3 obliga a reflejar en 48 h las actividades borradas | Purga a los 7 días (4.5). **La distancia no se publica en la cadena** (`A-4`) |
| Revocación | Si el atleta revoca el acceso, sus datos se borran en 30 días (POL 7.4) | T5 borra los tokens y los datos de Strava de ese usuario al detectar la revocación |
| IA | **POL 5.3** prohíbe usar Strava Data, incluso derivada o agregada, en cualquier aplicación de IA: entrenamiento, embeddings, RAG o la ventana de contexto | Ningún dato real de Strava pasa por un prompt, tampoco el de Claude Code: en tests y evidencia solo hay fixtures sintéticos (`CLAUDE.md`, restricción 5) |
| Visibilidad | POL 2.3: los datos se muestran solo al usuario autenticado | Ningún dato de un usuario es visible para otro, como dice la regla 5 |
| Webhooks | Existen (crear, borrar y actualizar actividades, y revocación), pero exigen un callback público (WH) | No en la Fase 1: el oráculo relee la semana al liquidar |
| Marca | "Connect with Strava" y "Powered by Strava" no son obligatorios. Si se usan, aplican sus reglas, y "Strava" no puede ir en el nombre de la app (BRAND; POL 4.2) | T7 sigue BRAND si muestra el botón |
| Cambios con fecha | Nueva URL base `api-v3.strava.com` desde el 4-ene-2027. Desde el 1-jun-2027 el token va solo en cabeceras y `oauth/deauthorize` se retira (CL) | El cliente de T5 tiene la URL base configurable y nunca manda el token por query |

**Sin verificar, queda para T5 con la cuenta del usuario:**
- el máximo real de `per_page`;
- si cada página cuenta como una lectura;
- si `device_name` o `upload_id` pueden venir vacíos en carreras con reloj;
- si una carrera manual puede traer alguno de los dos.

**Riesgo de términos para fases con terceros.** El portal de desarrolladores dice que Strava puede revocar tokens de
usos "that enable virtual races or competitions". AgentHabit no es una competencia, ni cobra por el acceso a la API
(POL 5.8). Aun así, se consulta a developers@strava.com antes del piloto con terceros de la Fase 3. No bloquea la Fase
1, que usa solo la cuenta del usuario.

## 5. Tareas

Agrupadas el 16-oct, a pedido del usuario, para ganar velocidad: 14 tareas pasan a 6, con el mismo contenido y los
mismos "Hecho cuando" (la tabla de equivalencias está en la sección 11). Todas siguen el mismo flujo:
- rama `cc/t<n>-<slug>` desde `origin/main`;
- `pnpm check` en verde, más `contracts:test:*` si tocan contratos;
- bitácora, `evidencia/T<n>.md` y `ESTADO.md`;
- se marcan ✅ dentro de su propio PR (`P-11`).

**T4 y T5 son independientes** (no comparten archivos) y pueden correr en paralelo, en dos sesiones. Para eso, los
filtros de carreras de 4.5 son de T5 (`packages/core/src/runs.ts`) y no de T4.

Las marcadas con **💰** están en el perímetro de fondos: contratos, claves, oráculo, `settle`, despliegues, o el
vínculo que decide de quién son los km. Cualquier transacción contra la red, incluso en testnet, pide el OK del
usuario antes (regla 8).

#### T4 · Núcleo y contratos
- **Estimación:** 32 h (el dominio, la tabla de casos y los dos contratos van juntos: la tabla es el contrato de los
  dos) · **Depende de:** nada · **💰:** sí
- **Archivos principales:**
  - `packages/core/src/`: semanas, límites, tabla de casos y los tipos de `ChainAdapter`;
  - `scripts/gen-cases.ts` y `contracts/fixtures/cases.json`, con su test de desvío;
  - `contracts/stellar/commitment/`;
  - `contracts/evm/src/Commitment.sol`, `contracts/evm/test/` y `contracts/evm/foundry.toml`.
- **Hecho cuando:**
  - **Dominio y tabla:**
    - [ ] la aritmética de 4.2 está en funciones puras, con tests de bordes: el ancla y antes del ancla, el último
      segundo de una semana, y las ventanas de `settle` y de `release_if_stale`
    - [ ] la tabla de casos cubre:
      - cada invariante de 4.2, cada error por nombre y el orden de validaciones;
      - el `commit` en el borde de una semana;
      - el token que rechaza la devolución
    - [ ] `contracts/fixtures/cases.json` se genera con el formato de 4.3, y un test de `pnpm check` detecta si quedó
      desactualizado
    - [ ] Biome sigue impidiendo que `packages/core` importe algo distinto de zod o de archivos relativos
  - **Soroban:**
    - [ ] el contrato de 4.2 tiene `__constructor`, posiciones `persistent` con el TTL fijado en ledgers y eventos
      con `#[contractevent]`
    - [ ] pasa la tabla de casos entera, leída de `contracts/fixtures/cases.json`, con los snapshots de testutils
      commiteados
    - [ ] un test avanza los ledgers hasta la ventana de `release_if_stale` y la posición sigue legible
    - [ ] el caso del token que rechaza la devolución usa `set_authorized(user, false)` del SAC
    - [ ] `pnpm run contracts:build:stellar` compila el wasm, y en CI también
  - **EVM:**
    - [ ] el contrato de 4.2 usa `SafeERC20` y `ReentrancyGuard`, sin `Ownable`, y verifica el aumento de saldo en
      `commit`
    - [ ] pasa la misma tabla de casos, leída con `vm.parseJson`
    - [ ] hay fuzz de montos y tiempos, un test de reentrada con un token malicioso y un mock de blacklist
    - [ ] `forge test` está en verde en local y en CI

#### T5 · Strava, API y km de la semana
- **Estimación:** 19 h · **Depende de:** la app de Strava del usuario (requiere su suscripción) y una base en Neon ·
  **💰:** sí, porque el vínculo decide de quién son los km
- **Archivos principales:**
  - `docs/integraciones/strava.md`;
  - `packages/core/src/runs.ts`: los filtros de 4.5 y `met = total ≥ goal_m`;
  - `packages/db/`, `apps/api/`, `packages/strava/`;
  - `packages/config/`: las variables de la base y de Strava.
- **Hecho cuando:**
  - **Prueba técnica de Strava** (ya no para la tarea: es su primer paso):
    - [ ] `integraciones` escribió `docs/integraciones/strava.md` con sus 10 secciones fijas, a partir de 4.8
    - [ ] con la cuenta del usuario se probó lo que 4.8 deja sin verificar:
      - el OAuth y el scope;
      - los límites leídos de las cabeceras y el máximo real de `per_page`;
      - el formato de `device_name` y `upload_id` en carreras de Garmin.

      Lo corre el usuario, sin guardar en git ni pasar por un prompt ningún dato real
  - **API, base y vínculo:**
    - [ ] Drizzle tiene sus tablas con migraciones:
      - el vínculo wallet × cadena ↔ atleta;
      - la conexión Strava con tokens cifrados;
      - el espejo de posiciones con la clave de 4.4;
      - el registro de liquidaciones
    - [ ] el vínculo exige un mensaje firmado por la wallet, con nonce y vencimiento, y abre la sesión. Hay tests de
      firma válida, ajena, vencida y repetida
    - [ ] el flujo OAuth valida el `scope`, y la renovación guarda el refresh token rotado. Tests con un Strava
      simulado
    - [ ] la API registra una posición solo después de leerla en la cadena, y congela el `athlete_id` (4.4). Hasta
      T6 se prueba con un adaptador simulado
    - [ ] todo lo que entra por HTTP pasa por zod, y ningún token aparece en los logs
  - **Km de la semana:**
    - [ ] los filtros de 4.5 tienen tests con actividades sintéticas: ventana semiabierta sobre `start_date`, tipos,
      `trainer`, `manual`, dispositivo, ceros y ritmo con `moving_time`. También la suma en metros enteros
    - [ ] trae las actividades de la ventana con paginación, aplica los filtros y devuelve el total en metros con los
      ids usados, o un error si la lectura quedó incompleta
    - [ ] respeta los límites de lectura (cabeceras `X-ReadRateLimit-*`)
    - [ ] la purga a los 7 días (4.5) tiene un test
    - [ ] los tests usan fixtures sintéticos: los datos reales del usuario no entran a git

#### T6 · Despliegue en testnet y liquidación
- **Estimación:** 13 h · **Depende de:** T4 y T5, y AVAX y USDC de prueba en Fuji · **💰:** sí, con el OK del
  usuario para cada despliegue y cada firma en `live`
- **Archivos principales:**
  - `scripts/deploy-stellar.ts`, `scripts/deploy-avalanche.ts` y `scripts/lib/`;
  - `deployments/*.json`;
  - `packages/chain-*/`: las lecturas, `settle` y `releaseIfStale`;
  - `apps/settler/`.
- **Hecho cuando:**
  - **Despliegue:**
    - [ ] hay dos instancias por cadena, producción y ensayo, registradas en `deployments/*.json` como dice 4.7
    - [ ] una segunda corrida de cada script no despliega nada; la guardia de desvío y el flujo de reinicio de
      testnet están probados con una red simulada
    - [ ] los adaptadores leen `config` y `current_week` de las cuatro instancias y coinciden con
      `deployments/*.json`
  - **Liquidación:**
    - [ ] el liquidador hace lo que dice 4.6 en las dos cadenas y en las dos instancias:
      - liquida lo que está en ventana;
      - llama a `release_if_stale` para lo vencido;
      - purga los datos de Strava vencidos
    - [ ] un test con un Strava simulado que falla a mitad de la paginación verifica que no se firma nada para esa
      posición y que las demás siguen
    - [ ] el acceso revocado se liquida como `Forfeited` y un error pasajero salta la posición (`A-10`), con tests que
      los distinguen
    - [ ] es idempotente: una segunda corrida no hace nada, con test
    - [ ] firma solo con `SETTLE_MODE=live` y `--live`; en `dry-run` no carga la clave del oráculo, con test
    - [ ] un `settle` y un `release-stale` en `live` sobre las instancias de ensayo, con el OK del usuario, quedan en
      la evidencia

#### T7 · Web
- **Estimación:** 17 h (se corta primero el historial y después la meta sugerida) · **Depende de:** T5 y T6 · **💰:**
  sí: arma las transacciones que firma la wallet
- **Archivos principales:** `apps/web/`
- **Hecho cuando:**
  - **Compromiso:**
    - [ ] se elige cadena, se conecta la wallet (`P-7`), se firma el vínculo y se conecta Strava
    - [ ] monto y meta tienen los límites del contrato, y la meta sugerida es el promedio de las últimas 4 semanas
      (cortable)
    - [ ] una confirmación dice en una frase qué pasa si fallas, y que revocar el acceso a Strava cuenta como no
      cumplir (`A-10`)
    - [ ] un `commit` firmado desde la web queda en la cadena y en el espejo de la API
  - **Estado de la semana:**
    - [ ] muestra km contra meta, días restantes y el enlace al explorador, con datos leídos con la sesión del
      usuario
    - [ ] tiene el botón "recuperar" (`release_if_stale`, firmado por la wallet) cuando la posición venció
    - [ ] muestra el resultado de las semanas anteriores, solo cumplió o no (cortable)
    - [ ] un test prueba que una sesión no puede leer datos de otro usuario
  - **Reglas y privacidad:**
    - [ ] una página explica en lenguaje simple:
      - que lo perdido no va a nadie;
      - qué carreras cuentan;
      - qué datos de Strava se guardan y por cuánto tiempo;
      - que nadie más ve tus datos;
      - qué pasa si el oráculo no liquida;
      - que revocar el acceso a Strava cuenta como no cumplir.

#### T8 · Ensayo de punta a punta y publicación en Render
- **Estimación:** 10 h, más el tiempo de correr: cada ensayo exige salir a correr dentro de una hora fija ·
  **Depende de:** T6 y T7 · **💰:** sí, con el OK del usuario. El Cron Job tiene la clave del oráculo
- **Archivos principales:** `docs/fase-1-mvp-testnet/evidencia/T8.md`, `render.yaml`, los README
- **Hecho cuando:**
  - **Ensayo:**
    - [ ] en las instancias de ensayo de las dos cadenas hay tres posiciones: una cumplida, una fallida y una devuelta
      por `release_if_stale`
    - [ ] la cumplida y la fallida se liquidan con carreras reales del usuario en Strava, corridas dentro de la hora
      comprometida (`A-11`)
    - [ ] cada transacción está en la evidencia, con enlace a stellar.expert o al explorador de Fuji
  - **Render:**
    - [ ] la web y la API corren como servicio web, y el liquidador como Cron Job diario (4.6), con el modo explícito
    - [ ] los secretos se cargan con `sync: false` y ninguno está en el repo
    - [ ] el callback de Strava apunta al dominio que se elija en esta tarea (`A-6`)

#### T9 · `/fase-cerrar 1`
- **Estimación:** 2 h · **Depende de:** todas, y de la semana real de 7 días (sección 6)
- **Hecho cuando:**
  - [ ] cada criterio de la sección 6 tiene su evidencia
  - [ ] hay plan de demo y una retro de 3 líneas
  - [ ] el tag `v0.1.0` está creado, con permiso

**Total estimado:** unas 93 h, igual que antes de agrupar.

## 6. Criterios de aceptación de la fase

- [ ] Las dos cadenas pasan la misma tabla de casos, generada en `packages/core` (T4).
- [ ] El ensayo de T8 queda completo en las dos cadenas.
- [ ] Una semana real de 7 días queda liquidada en testnet por el Cron Job, con el resultado sacado de Strava. Puede
  ser la misma semana: una corrida en `dry-run` y otra posterior en `live`, dentro de la ventana y con el OK del
  usuario.
- [ ] Ningún secreto está en git, ni en los logs, ni en la salida de los scripts.
- [ ] Ningún dato de Strava llega a una función de IA, a otro usuario ni a la cadena, ni se guarda más de 7 días.

## 7. Plan de demo

1. En la web publicada:
   1. elegir Stellar;
   2. conectar Freighter, firmar el vínculo y conectar Strava;
   3. comprometer 20 USDC con una meta.
2. Mostrar la posición en stellar.expert y en el estado de la semana.
3. Repetir en Fuji con Core o MetaMask.
4. Mostrar la evidencia de T8: cumplir, fallar y la devolución por plazo vencido, en las dos cadenas.
5. Mostrar la semana real de 7 días liquidada por el Cron Job: primero el `dry-run` y después el `live`.

## 8. Orden y cortes

**Orden:**

| Paso | Tareas |
|---|---|
| 1 | T4 y T5, en paralelo (dos sesiones) |
| 2 | T6 |
| 3 | T7 |
| 4 | T8 |
| 5 | La semana real de 7 días (una semana de calendario completa, más 48 h), y después T9 |

**Calendario.** La semana real tiene que comprometerse, correrse y liquidarse antes del reinicio de Stellar testnet
del 16-dic-2026. Si no alcanza:
1. se vuelve a correr `pnpm run bootstrap`, que repone las cuentas sin tocar las claves;
2. se redespliega con el flujo de reinicio de 4.7.

**Orden de corte,** si al final de la fase falta tiempo:
1. el historial de semanas anteriores (T7);
2. la meta sugerida (T7): el usuario escribe la suya;
3. Avalanche en la web: queda solo por script.

**No se cortan:** T4, T6, el ensayo de T8, `release_if_stale` ni el botón "recuperar".

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Las dos cadenas divergen en un borde (redondeo de tiempos, orden de errores) | La misma tabla de casos, generada en `packages/core`, con errores por nombre y orden de validaciones fijo (4.3) |
| Strava falla o devuelve datos incompletos al liquidar | Solo se liquida con la lectura completa; si no, se salta y se reintenta. Si no se resuelve, `release_if_stale` (4.6) |
| El oráculo no liquida a tiempo y un usuario que falló recupera el depósito | Cron diario con reintentos dentro de la ventana (4.6). El fallo favorece al usuario, por diseño |
| Una posición que la web no informó nunca se liquida | Vence: el Cron no la ve, pero el usuario la recupera con el botón "recuperar" o cualquiera con `release_if_stale` (4.4) |
| Alguien asocia la wallet de otro a una cuenta de Strava vacía | El vínculo exige un mensaje firmado por la wallet, y el `athlete_id` se congela en cada posición (4.4) |
| USDC bloquea la dirección del usuario (blacklist en EVM, trustline en Stellar) | La devolución revierte entera y la posición sigue `Active` hasta que el token lo acepte; las demás no se tocan (4.2) |
| USDC de Fuji, que es un proxy, empieza a cobrar comisión | `commit` verifica el aumento exacto del saldo y revierte si no (4.2) |
| Las posiciones de Soroban se archivan antes de liquidarse | Almacenamiento `persistent`, TTL extendido en cada escritura y un test que avanza los ledgers (T4) |
| La RPC pública guarda pocos eventos, o limita `eth_getLogs` | El espejo se llena desde el `commit` y se verifica con `get_position` (4.4) |
| Reinicio de Stellar testnet el 16-dic-2026 | La semana real va antes; si no alcanza, `bootstrap` y el flujo de reinicio de 4.7 |
| La app de Strava requiere suscripción y nace en modo un jugador | En la Fase 1 solo se conecta la cuenta del usuario (T5) |
| Un dato de Strava se cuela en git, en logs, en la cadena o en una función de IA | Solo fixtures sintéticos (T5), `met` en vez de la distancia en `settle` (`A-4`), purga a los 7 días y revisión de `/revisar` en T5 y T6 |
| Strava considera que el producto choca con sus términos | Consulta a developers@strava.com antes de la Fase 3 (4.8) |
| La clave del oráculo se pierde | `release_if_stale` devuelve todo y se despliega un contrato nuevo (`P-4`) |
| Una sola persona hace todo | El orden de corte de la sección 8 |

## 10. Preguntas abiertas

Respondidas por el usuario el 16-oct:

- [x] **1. ¿Para qué semana se puede comprometer?** Solo para la siguiente (`A-8`), como se recomendó.
- [x] **2. ¿Qué carreras cuentan?** `Run` y `TrailRun`, sin cinta (`trainer`) ni `VirtualRun` (`A-9`), como se
  recomendó.
- [x] **3. Si el usuario revoca el acceso a Strava, ¿cómo se liquida?** Cuenta como 0 km y queda `Forfeited`; los
  errores pasajeros solo saltan la posición (`A-10`), como se recomendó.
- [x] **4. ¿De dónde sale el resultado del ensayo de 1 hora?** De carreras reales en Strava, con meta mínima de
  500 m en la instancia de ensayo (`A-11`). Se recomendaba que lo declarara el operador; el usuario eligió la
  opción más fiel a la restricción 4.

Decididas en el spec según la recomendación del mensaje inicial o de la revisión, y aprobadas por el usuario con el
spec el 16-oct:
- [x] Lo perdido queda en el contrato, visible en `total_forfeited` (`A-5`). Quemarlo rompería el invariante "nada
  sale salvo hacia el dueño", y no se puede hacer igual en las dos cadenas: FiatToken rechaza transferir a
  `address(0)`, y en Stellar quemar es enviar al emisor.
- [x] Sin Exponential en la Fase 1, y `localhost` para la web y el callback de Strava hasta T8 (`A-6`).
- [x] `settle` recibe `met` y no la distancia (`A-4`, por los términos de Strava).

## 11. Registro de cambios del spec

| Fecha | Cambio |
|---|---|
| 2026-10-16 | Borrador a partir del mensaje inicial (T4–T17), verificado contra el código en `a4198f1`, contra la red y contra la documentación oficial de Strava (`integraciones`). Revisado por `arquitecto`, que encontró 4 bloqueantes y 9 importantes, todos incorporados. Cambios respecto del mensaje inicial: liquidación solo con datos completos; vínculo wallet ↔ atleta firmado; tabla de casos con errores por nombre y su plomería; espejo por contrato; Cron diario que también devuelve lo vencido; `settle` con `met`; retención de 7 días; doble interruptor de `live`; balance-delta en `commit`; TTL de Soroban; flujo de reinicio de testnet |
| 2026-10-16 | Preguntas 1 a 4 respondidas por el usuario (`A-8` a `A-11`). El ensayo usa carreras reales con meta mínima de 500 m, y desaparece el camino del resultado manual |
| 2026-10-16 | **Aprobado** por el usuario, con `A-1` a `A-7` como estaban. `pnpm release-stale*` pasa a `ask` en `.claude/settings.json` (`A-7`) |
| 2026-10-16 | **Tareas agrupadas** a pedido del usuario, para ganar velocidad: 14 tareas pasan a 6, con el mismo contenido y los mismos "Hecho cuando". Equivalencias: T4 = antes T4, T5 y T6 · T5 = antes T8, T9 y T10 · T6 = antes T7 y T11 · T7 = antes T12, T13 y T14 · T8 = antes T15 y T16 · T9 = antes T17. Los filtros de carreras pasan a T5, para que T4 y T5 corran en paralelo. La prueba técnica de Strava deja de parar la tarea. La Fase 2 numera desde T13 |
| 2026-10-17 | T5: la fila "Tokens" y la de "Listado" de 4.8 apuntan a `A-17` (revocación solo explícita y sin carrera; paginación hasta una página vacía), y el callback de OAuth pasa por la web con la sesión (`A-19`) |
