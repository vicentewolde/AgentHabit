# Firmas de mensajes de wallet (Stellar SEP-53 y Avalanche EIP-191)

Verificado el **2026-10-17** contra documentación oficial y, donde no hay prosa, contra los tipos y el código
publicados de los paquetes. Para el spec 4.4 (vínculo wallet ↔ atleta de Strava) y la tarea T5. Wallets fijadas en
`P-7`. No se hizo ninguna llamada autenticada ni se usó ninguna wallet real; lo que exige una wallet queda marcado
**NO VERIFICADO** con su prueba.

## 1. Resumen

| | Stellar | Avalanche (Fuji) |
|---|---|---|
| Estándar | SEP-53 `Final`, v1.0.0 (actualizado 2026-06-18) | EIP-191 versión `0x45` (`personal_sign`), `Final` |
| Se firma | `SHA-256("Stellar Signed Message:\n" ‖ UTF-8(mensaje))` con ed25519 | `keccak256(0x19 ‖ "Ethereum Signed Message:\n" ‖ len ‖ UTF-8(mensaje))` con secp256k1 |
| Firma | 64 bytes; Freighter la entrega en base64 | 65 bytes `r‖s‖v`, hex `0x…` |
| Verificar en el servidor | `Keypair.fromPublicKey(G…).verifyMessage(mensaje, firma)` de `@stellar/stellar-sdk` 17.2.1 | `verifyMessage` de `viem` 2.57.7 (solo EOA, sin red) o `publicClient.verifyMessage` (también contratos) |
| Madurez | Estándar joven (creado 2025-02-01), implementado en el SDK y en Freighter | Estándar de facto desde hace años |
| Riesgo | Bajo en Freighter; **medio en xBull** (codificación sin documentar) | Bajo en MetaMask; **medio en Core** (la doc de Core no lista `personal_sign`) |

Hallazgos que cambian el diseño o requieren decisión:

1. **El SDK ya trae SEP-53.** `Keypair#signMessage` y `Keypair#verifyMessage` existen en `@stellar/stellar-sdk`
   17.2.1 (la versión que ya usa el repo). No hay que armar el hash a mano. La trampa opuesta: `Keypair#verify` NO es
   SEP-53, verifica ed25519 crudo.
2. **No hay un estándar de login para Stellar equivalente a SIWE.** SEP-10 existe pero es otro mecanismo (transacción
   desafío + clave de servidor + `stellar.toml`); no conviene aquí (sección 4).
3. **Core no documenta `personal_sign`** en su referencia JSON-RPC (sí `eth_sign` y `avalanche_signMessage`). viem usa
   `personal_sign`. Hay que probarlo con Core real antes de prometer Core.
4. **Nombre del paquete de P-7.** `P-7` dice `@creit.tech/stellar-wallets-kit` (npm). La documentación del kit dice que
   la versión actual se publica en JSR como `@creit-tech/stellar-wallets-kit` y que el paquete npm es el heredado
   ("at some point we will stop doing it"). A la fecha el registro npm todavía marca `latest = 2.7.1`. Ver sección 9.

## 2. Requisitos de cuenta y app

- **Ninguna cuenta, clave de API, suscripción ni revisión.** La firma de mensajes es local a la wallet del usuario.
  Costo: 0. No hay límite de usuarios.
- **Stellar:** extensión Freighter (o xBull) instalada y con una cuenta `G…`. Freighter pide `address` en
  `signMessage` (ver sección 4).
- **Avalanche:** extensión con proveedor EIP-1193 inyectado: MetaMask o Core. Core se anuncia por EIP-6963 y también
  en `window.avalanche` (Core Docs, consultado 2026-10-17); detectar por EIP-6963 evita el conflicto entre
  extensiones que se pisan `window.ethereum`.
- **Cuenta de Stellar y permisos:** una firma SEP-53 prueba control de **una clave**, no de la cuenta. SEP-53,
  "Security Considerations": "A valid signature shows control of a private key, not necessarily control of the
  Stellar account" (cuentas multifirma o con la clave maestra desactivada). Aplica solo a cuentas `G…`; una cuenta de
  contrato `C…` no puede firmar ed25519 (inferencia: SEP-53 solo define ed25519 sobre claves de cuenta; no
  verificado con una wallet de contrato).

Versiones del repo (fuente: `package.json` de la raíz y de `packages/config`, 2026-10-17):
`@stellar/stellar-sdk` 17.2.1 y `viem` 2.57.7. El kit de wallets aún no está en el repo.

## 3. Autenticación

Aquí no hay OAuth: la "autenticación" es la propia firma. Flujo recomendado (diseño del proyecto, no un estándar;
cumple lo que pide el spec 4.4):

1. `POST /auth/challenge { chain, address }`. La API genera un **nonce aleatorio de al menos 128 bits**, lo guarda
   con `(chain, address, vencimiento, mensaje completo)` y devuelve el **texto exacto** a firmar.
2. La wallet firma ese texto tal cual.
3. `POST /auth/verify { chain, address, signature }`. La API busca el desafío guardado, comprueba que no venció y no
   se usó, **marca el nonce como consumido en la misma operación atómica**, verifica la firma contra el texto
   **guardado** (no contra uno reenviado por el cliente) y abre la sesión.

Por qué guardar el texto en vez de reconstruirlo desde lo que envía el cliente: así no hay un parser que pueda
discrepar entre cadenas, y cualquier cambio de un byte invalida la firma.

- Duración sugerida del desafío: 5 minutos (decisión de producto; ver preguntas). El vencimiento va **dentro** del
  mensaje firmado y además se aplica en el servidor.
- Refresco de tokens: no aplica a la firma. La duración de la sesión que se abre es decisión de T7.
- Redirect URIs: no aplican.

## 4. Operaciones

### 4.1 Stellar

**Firmar en el navegador** (kit o Freighter):

- Freighter (`@stellar/freighter-api`), documentación oficial:
  `signMessage(message: string, opts: { address: string }) -> Promise<{ signedMessage: string | null; signerAddress: string } & { error?: FreighterApiError }>`.
  La página dice que devuelve "a base64-encoded Ed25519 signature" y que "Follows SEP-53". No documenta
  `networkPassphrase` para este método. Rechazo del usuario: `"The user rejected this request."`.
- `stellar-wallets-kit` (tipos publicados en JSR):
  `StellarWalletsKit.signMessage(message: string, opts?: { networkPassphrase?: string; address?: string; path?: string }) -> Promise<{ signedMessage: string; signerAddress?: string }>`.
  Notas:
  - `signerAddress` es **opcional** en el tipo del kit. La página de `ModuleInterface.signMessage` es incoherente
    (muestra las dos formas). Tratarlo como no confiable: la identidad la fija la verificación, no este campo.
  - El kit advierte: "you can not request to sign a message or an authorization entry with Wallet Connect". El MVP no
    usa WalletConnect (`P-7`), así que no afecta. (El CHANGELOG 2.3.0 dice que se agregó firma por WalletConnect;
    la guía dice lo contrario. Irrelevante para el MVP.)
  - Si `StellarWalletsKit.signMessage` es estática o de instancia: la página de JSR no lo dice. **NO VERIFICADO**;
    se lee en los tipos del paquete instalado (`pnpm add` y abrir el `.d.ts`).

**Qué hace el kit con cada wallet** (código fuente en `main`, consultado 2026-10-17):

- Módulo Freighter: si `signedMessage` es `string` lo devuelve tal cual; si no, lo convierte a base64
  (`encodeBase64(new Uint8Array(signedMessage))`). Si viene vacío, rechaza con código `-3`. Pasa `signerAddress`
  sin tocarlo. El CHANGELOG (1.2.5, 1.9.4) confirma que Freighter respondió en dos formatos distintos en versiones
  anteriores.
- Módulo xBull: devuelve el resultado de `bridge.signMessage` **sin transformarlo**. La documentación de
  `xbull-wallet-connect` no describe `signMessage` ni su codificación. **NO VERIFICADO** (ver sección 8).
- El kit dice "Added xBull message signing logic" en 1.8.0 (2025-08-13).
- Ninguna entrada del CHANGELOG del kit menciona SEP-53.

**Verificar en el servidor** (`@stellar/stellar-sdk` 17.2.1, tipos y código publicados):

```ts
import { Keypair } from "@stellar/stellar-sdk";
const ok = Keypair.fromPublicKey(address).verifyMessage(message, signatureBytes);
```

- `verifyMessage(message: string | Uint8Array, signature: Uint8Array | Signature): boolean`.
  Doc del paquete: "Verifies a SEP-53 signed message against this keypair's public key."
- Implementación publicada: `verifyMessage(m, s) = this.verify(this._hashMessage(m), s)` con
  `_hashMessage = hash(MESSAGE_PREFIX ‖ bytes(m))` y `MESSAGE_PREFIX = "Stellar Signed Message:\n"`. `hash` es el
  SHA-256 del SDK (el archivo `hashing.js` no se leyó; SEP-53 dice SHA-256).
- `Keypair.fromPublicKey` lanza si la dirección no es una `G…` válida.

### 4.2 Avalanche / EVM

**Firmar en el navegador** (`viem` con `custom(window.ethereum | proveedor EIP-6963)`):

- `walletClient.signMessage({ account, message })`. Doc de viem: calcula una firma "in EIP-191 format"; "By default,
  viem signs the UTF-8 representation of the message"; con cuentas JSON-RPC usa `personal_sign`; devuelve `Hex`.
- La forma cruda es `personal_sign` con `params: [mensajeEnHex, dirección]` (MetaMask Docs). Algunas fuentes de
  terceros ponen `[dirección, mensaje]`; con viem no importa porque él arma los parámetros.

**Verificar en el servidor** (`viem`):

- **`verifyMessage({ address, message, signature })` de `viem`.** Solo cuentas EOA. El propio tipo publicado dice:
  "Only supports Externally Owned Accounts. Does not support Contract Accounts. It is highly recommended to use
  `publicClient.verifyMessage` instead". No hace llamadas de red. Devuelve `boolean` (usarlo con `await` no daña).
- **`publicClient.verifyMessage({ address, message, signature, mode })`.** Soporta EOA y cuentas de contrato:
  ERC-1271 (desplegadas) y ERC-6492 (aún no desplegadas), y ERC-8010 (pre-delegadas). `mode`: `'auto'` (por defecto)
  o `'eoa'` (salta los intentos on-chain). Con cuentas de contrato necesita una RPC.
- `recoverMessageAddress({ message, signature })` devuelve la dirección firmante; equivalente para EOA, pero entonces
  hay que comparar direcciones a mano.

## 5. Datos y formatos

### 5.1 Bytes exactos que se firman

**Stellar (SEP-53)** (SEP-53 en `stellar-protocol`, consultado 2026-10-17):

```
payload = UTF8("Stellar Signed Message:\n") ‖ UTF8(mensaje)     // prefijo termina en 0x0A
digest  = SHA256(payload)                                       // una sola ronda
firma   = ed25519_sign(clave_privada, digest)                   // 64 bytes; se firma el digest de 32 bytes
```

- El prefijo es el texto de 24 bytes `Stellar Signed Message:` más un salto de línea `\n`. No hay separador ni longitud
  entre prefijo y mensaje.
- Un mensaje de tipo string se codifica UTF-8; un mensaje binario se usa tal cual.
- SEP-53 **no define** la codificación de texto de la firma; los vectores muestran base64 y hex. Freighter documenta
  base64.

**EVM (EIP-191 versión `0x45`)**:

```
payload = 0x19 ‖ "Ethereum Signed Message:\n" ‖ ASCII(decimal(len(mensaje_en_bytes))) ‖ mensaje_en_bytes
digest  = keccak256(payload)
firma   = secp256k1 recuperable sobre digest -> r(32) ‖ s(32) ‖ v(1)
```

- Las fuentes oficiales consultadas (EIP-191, MetaMask) muestran `"\x19Ethereum Signed Message:\n" + len(message)`. Que
  `len` sea el **número decimal en ASCII de los bytes** del mensaje es la implementación estándar (viem, ethers), pero
  la página de EIP-191 no lo dice explícitamente. **NO VERIFICADO en texto**; lo cubre un test de ida y vuelta.
- La longitud es de **bytes UTF-8**, no de caracteres. Con tildes (por ejemplo "Semana") o emojis la diferencia
  importa; viem lo maneja, pero cualquier verificación manual debe contar bytes.

### 5.2 Formato de la firma que llega a la API

| | Stellar | EVM |
|---|---|---|
| Longitud | 64 bytes | 65 bytes |
| Texto | base64 (88 caracteres con relleno) desde Freighter | hex `0x` + 130 caracteres |
| Quién decodifica | la API, con validación estricta | viem acepta `Hex`, `ByteArray` o `Signature` |

- `Keypair#verify` y `#verifyMessage` **rechazan con `TypeError`** un string hex o base64 como firma (desde
  `stellar-sdk` 17.0.0; antes devolvían `false`). Hay que decodificar a `Uint8Array` antes de llamar.
- Stellar: `signature` debe medir exactamente 64 bytes; rechazar otra longitud antes de verificar.

### 5.3 Vectores de prueba (fixtures sintéticos)

SEP-53, mismo para los tres. Semilla `SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW`, dirección
`GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L`. Son claves públicas de prueba del estándar, no del
proyecto.

| Mensaje | Firma (base64) |
|---|---|
| `Hello, World!` | `fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==` |
| `こんにちは、世界！` | `CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==` |
| bytes (base64 `2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=`) | `VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==` |

Hex del primero: `7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04`.
Usar estos como test de la función de verificación de la API (el segundo cubre UTF-8 multibyte).

EVM: el proyecto debe generar su propio vector con una clave de prueba (`privateKeyToAccount` de `viem/accounts`, firma
local, sin red) y fijarlo como fixture, más un caso con tildes. No se copia ninguno de memoria.

### 5.4 Formato del mensaje (recomendación)

**Un solo texto legible por cadena, con los mismos campos**, generado por la API y guardado (sección 3).

**EVM: usar EIP-4361 (SIWE).** `Final`. Plantilla oficial (ABNF informal):

```
${domain} wants you to sign in with your Ethereum account:
${address}

${statement}

URI: ${uri}
Version: ${version}
Chain ID: ${chain-id}
Nonce: ${nonce}
Issued At: ${issued-at}
Expiration Time: ${expiration-time}
```

- Obligatorios: dominio, dirección, URI, versión (`1`), `Chain ID`, `Nonce` (mínimo 8 caracteres alfanuméricos),
  `Issued At`. Opcionales: `Expiration Time`, `Not Before`, `Request ID`, `Resources`, `statement`, `scheme`.
- La dirección debe estar en checksum EIP-55. `Chain ID` de Fuji: `43113` (valor de Avalanche, no verificado en esta
  nota; confirmar contra `build.avax.network` al implementar).
- Ventaja: las wallets que implementan SIWE comparan el dominio del mensaje con el origen de la página y avisan si no
  coinciden (la especificación lo exige a la wallet), lo que frena el phishing. Y es el caso de uso que la propia doc de
  MetaMask cita para `personal_sign`.
- La verificación del EOA es EIP-191, como pide EIP-4361 ("For Externally Owned Accounts (EOAs), the verification
  method specified in ERC-191 MUST be used").
- **No hace falta la librería `siwe`:** como la API guarda el texto, basta generarlo con una plantilla y verificar la
  firma. Usar el formato SIWE sin parsearlo es suficiente, y no agrega dependencia.

**Stellar: no hay estándar; usar la misma plantilla adaptada.** Ninguna de las alternativas encaja:

- SEP-10 (`Active`, v3.4.1) autentica con una transacción desafío de secuencia 0, `manage_data` con
  `<home domain> auth` y la firma del servidor (`SIGNING_KEY` en `stellar.toml`). Exige dominio con `stellar.toml`,
  clave de servidor y firmar una transacción; es más pesado, y firmar "transacciones" que no son transacciones es
  justo lo que SEP-53 quiere evitar.
- CAIP-122 ("Sign in With X") está en estado `Review` y **no define un perfil para Stellar**; solo da una plantilla
  genérica. Sirve de inspiración, no de estándar.

Propuesta (formato del proyecto, a documentar en el spec; campos en el mismo orden que SIWE):

```
${domain} wants you to sign in with your Stellar account:
${G-address}

Link this wallet to a Strava account on AgentHabit. This does not move funds.

URI: ${origin}
Version: 1
Network: Stellar Testnet            // o la passphrase exacta
Nonce: ${nonce}
Issued At: ${ISO-8601 UTC}
Expiration Time: ${ISO-8601 UTC}
```

Reglas comunes: solo `\n` (nunca `\r\n`), sin espacios al final de línea, sin líneas vacías extra, fechas ISO-8601
en UTC con `Z`. Esto previene que un kit o una wallet "normalice" el texto y rompa la verificación. Si la API guarda
el texto y compara contra el guardado, la normalización de la wallet **sí rompería** la firma: por eso se prueba
(sección 8).

## 6. Límites

- No hay rate limits ni cuotas: la verificación es local (CPU). Sí conviene limitar `POST /auth/challenge` y
  `/auth/verify` por IP y dirección (decisión del proyecto, T5/T7) para evitar llenar la tabla de nonces.
- Tamaño del mensaje: SEP-53 y EIP-191 no fijan máximo. Las wallets pueden truncar o rechazar mensajes largos o con
  muchas líneas: **NO VERIFICADO** por wallet; los mensajes propuestos tienen menos de 400 bytes.
- `publicClient.verifyMessage` con cuentas de contrato consume RPC de Fuji (límites de la RPC pública, ver spec 4.1).
  El `verifyMessage` suelto no.

## 7. Errores comunes

| Situación | Qué pasa | Reintentable |
|---|---|---|
| Usuario rechaza en Freighter | `error` con `"The user rejected this request."` | Sí, es el usuario |
| Usuario rechaza en un proveedor EIP-1193 | error `4001` (estándar EIP-1193; Core lo documenta para `avalanche_signMessage`) | Sí |
| Cuenta no autorizada en el proveedor | `4100` (documentado por Core para `eth_sign`) | Sí, tras `eth_requestAccounts` |
| Freighter sin `signedMessage` | el kit rechaza con código `-3` | Sí |
| Firma Stellar en hex/base64 pasada al SDK | `TypeError` (SDK 17.x) | No: bug del cliente; decodificar antes |
| Firma Stellar válida pero que no corresponde | `verifyMessage` devuelve `false` | No: rechazar con 401 |
| Firma EVM con otra cuenta o mensaje distinto | `verifyMessage` devuelve `false` | No |
| Desafío vencido o nonce ya consumido | lógica propia de la API | Se pide un desafío nuevo |
| `fromPublicKey` con dirección inválida | lanza | No: validar con zod antes |

Regla: solo `false` y excepciones de tipo son errores del cliente; ninguno se reintenta con el mismo nonce.
Mapear a `AgentHabitError` con `code` (no `throw new Error` genérico).

## 8. Cómo probar sin riesgo

Sin fondos ni cuenta de Strava, y sin datos reales:

1. **Unitarios (sin wallet):** los tres vectores SEP-53 de 5.3 contra `Keypair.fromPublicKey(...).verifyMessage`.
   También `Keypair.fromSecret(semilla del estándar).signMessage(...)` y comparar byte a byte con la tabla. Para EVM,
   `privateKeyToAccount(claveDePrueba).signMessage` y `verifyMessage`, con un mensaje con tildes. Casos negativos:
   un byte distinto, `\r\n`, otro nonce, otra dirección, firma de longitud errónea, firma en hex pasada a Stellar.
2. **Con la wallet del usuario, en testnet (corre el usuario, sin mover fondos; firmar un mensaje no envía nada):**
   - **Freighter:** firmar el mensaje de 5.4; confirmar que `signedMessage` es base64 de 64 bytes, que
     `signerAddress` coincide con la dirección, y que `verifyMessage` da `true`. Variante con salto de línea final y
     con tildes.
   - **xBull:** lo mismo. Es la prueba que resuelve el único **NO VERIFICADO** de Stellar: la codificación de lo que
     devuelve (¿base64, hex, objeto?).
   - **MetaMask y Core en Fuji:** firmar con `walletClient.signMessage`, verificar con `verifyMessage`. La prueba con
     **Core** es obligatoria: su referencia de JSON-RPC no lista `personal_sign`. Si falla, la alternativa es la
     decisión del usuario (excluir Core o probar `eth_sign`/`avalanche_signMessage`, que no tienen un prefijo
     documentado y no se recomiendan).
   - Para cada wallet, comparar el texto que muestra la wallet con el enviado (¿lo recorta, lo normaliza?).
3. **Cuentas de contrato / EIP-7702:** el `verifyMessage` suelto no las soporta. Si algún usuario tiene una cuenta
   MetaMask mejorada con EIP-7702, qué ruta de verificación corresponde para su `personal_sign` es **NO VERIFICADO**
   (la documentación consultada no lo dice). Prueba: firmar con esa cuenta y verificar con el `verifyMessage` suelto y
   con `publicClient.verifyMessage`.
4. **Versión del kit:** tras instalarlo, abrir sus tipos y confirmar la firma de `signMessage` (estática o no).

## 9. Riesgos y términos de uso relevantes

- **Nombre del paquete del kit (P-7).** `P-7` fija `@creit.tech/stellar-wallets-kit` (npm). La doc del kit lo
  presenta como heredado (V1) y la versión nueva está en JSR como `@creit-tech/stellar-wallets-kit`; sin embargo el
  registro npm marca `latest = 2.7.1` y el CHANGELOG indica 2.4.0 (2026-06-24): migra de `stellar-base` al SDK, y 2.6.0
  (2026-08-27): usa `stellar-sdk` v17, el mismo major que el repo. Mantener npm es compatible con `P-7`; la pregunta es
  hasta cuándo seguirán publicando ahí. pnpm 11: agregar el paquete con `allowBuilds` explícito si algún
  dependiente tiene scripts.
- **Phishing de firma:** un mensaje genérico ("firma esto") puede reutilizarse en otro sitio. Por eso va el dominio, la
  cadena, el nonce y el vencimiento **dentro** del texto firmado, y la API verifica contra el texto guardado.
- **No firmar nunca bytes que parezcan una transacción.** El prefijo de SEP-53 existe para eso: evita confundir el
  mensaje con una transacción y mitiga el replay entre contextos. No usar `signTransaction` ni `signAuthEntry` para
  el vínculo.
- **Replay:** un nonce de un solo uso y vencimiento corto. Una firma robada sirve solo para el mensaje que la generó,
  con su dominio y nonce.
- **Control de clave ≠ control de cuenta (Stellar).** Una cuenta multifirma o con la clave maestra desactivada puede
  firmar con una clave que ya no manda sobre la cuenta. Para el MVP (vínculo, no custodia) es aceptable; la
  autorización real de fondos la hace `require_auth` en el contrato.
- **EOA vs contrato (EVM).** Con el `verifyMessage` suelto, una wallet de contrato **no** puede vincularse, y el
  rechazo se ve como "firma inválida". Es una limitación de producto para comunicar, no un fallo de seguridad.
- **Direcciones:** comparar siempre en forma canónica (`getAddress` en EVM; la `G…` exacta en Stellar), sin
  distinguir mayúsculas solo en EVM.
- **Strava:** esta nota no maneja datos de Strava. El mensaje firmado no contiene datos de Strava ni de ningún
  atleta (solo wallet, dominio, nonce, fechas). Nada de esto va a una función de IA.
- **Licencias:** no se revisaron los términos de uso de Freighter, xBull, Core o MetaMask; no imponen condiciones
  relevantes a una dApp que pide firmas, pero no está verificado.

## 10. Fuentes

Todas consultadas el **2026-10-17**.

Stellar:
- SEP-53, "Sign and Verify Messages" (Final, v1.0.0, actualizado 2026-06-18):
  https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md y
  https://raw.githubusercontent.com/stellar/stellar-protocol/master/ecosystem/sep-0053.md
- SEP-10 (Active, v3.4.1): https://raw.githubusercontent.com/stellar/stellar-protocol/master/ecosystem/sep-0010.md
- Freighter, API de firma (`signMessage`, `signAuthEntry`): https://docs.freighter.app/extension-freighter-api/signing.md
- `@stellar/stellar-sdk` 17.2.1, tipos y código de `Keypair` (`signMessage`/`verifyMessage`/`verify`):
  https://unpkg.com/@stellar/stellar-sdk@17.2.1/lib/esm/base/keypair.d.ts y
  https://unpkg.com/@stellar/stellar-sdk@17.2.1/lib/esm/base/keypair.js
- `@stellar/stellar-sdk`, paquete y dependencias: https://registry.npmjs.org/@stellar/stellar-sdk/latest
- `js-stellar-sdk`, releases (v17.0.0, v17.2.1 del 1 de octubre; cambio `TypeError`/`Uint8Array`):
  https://github.com/stellar/js-stellar-sdk/releases y https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.0
- Stellar Wallets Kit, instalación y páginas: https://stellarwalletskit.dev/installation.html y
  https://stellarwalletskit.dev/how-to/sign-with-wallet.html
- Stellar Wallets Kit, tipos en JSR: https://jsr.io/@creit-tech/stellar-wallets-kit/doc/~/StellarWalletsKit.signMessage y
  https://jsr.io/@creit-tech/stellar-wallets-kit/doc/~/ModuleInterface.signMessage
- Stellar Wallets Kit, CHANGELOG: https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/CHANGELOG.md
- Stellar Wallets Kit, módulos: https://raw.githubusercontent.com/Creit-Tech/Stellar-Wallets-Kit/main/src/sdk/modules/freighter.module.ts y
  https://raw.githubusercontent.com/Creit-Tech/Stellar-Wallets-Kit/main/src/sdk/modules/xbull.module.ts
- Paquete npm del kit (`latest = 2.7.1`): https://registry.npmjs.org/@creit.tech/stellar-wallets-kit
- xBull Wallet Connect (sin documentar `signMessage`): https://raw.githubusercontent.com/Creit-Tech/xBull-Wallet-Connect/main/README.md

Avalanche / EVM:
- EIP-191 (Final): https://eips.ethereum.org/EIPS/eip-191
- EIP-1271 (Final, `isValidSignature`, valor `0x1626ba7e`): https://eips.ethereum.org/EIPS/eip-1271
- ERC-6492 (Final): https://eips.ethereum.org/EIPS/eip-6492
- EIP-4361 / SIWE (Final): https://eips.ethereum.org/EIPS/eip-4361
- CAIP-122 (Review): https://standards.chainagnostic.org/CAIPs/caip-122
- viem `verifyMessage` (utilidad, solo EOA): https://viem.sh/docs/utilities/verifyMessage
- viem `publicClient.verifyMessage` (EOA y contratos): https://viem.sh/docs/actions/public/verifyMessage
- viem `recoverMessageAddress`: https://viem.sh/docs/utilities/recoverMessageAddress
- viem `walletClient.signMessage`: https://viem.sh/docs/actions/wallet/signMessage
- viem 2.57.7, tipo de `verifyMessage`: https://unpkg.com/viem@2.57.7/_types/utils/signature/verifyMessage.d.ts
- MetaMask, `personal_sign`: https://docs.metamask.io/wallet/how-to/sign-data/
- Core, `eth_sign`: https://docs.core.app/docs/reference/eth_sign/
- Core, `avalanche_signMessage`: https://docs.core.app/docs/reference/avalanche_signmessage/
- Core, referencia JSON-RPC (sin `personal_sign`): https://docs.core.app/docs/reference/json-rpc-api/
- Core, introducción (EIP-1193 + EIP-6963): https://docs.core.app/docs/intro/

Del repo: `package.json` y `packages/config/package.json` (versiones de `@stellar/stellar-sdk` y `viem`);
`docs/fase-1-mvp-testnet/SPEC.md` 4.4; `docs/DECISIONES.md` P-7.

Pendiente de leer y no leído: `hashing.js` del SDK (el SHA-256 usado), la página "Detect it" de Core (EIP-6963) y la
página "Signing methods" de Core. La página `docs.core.app/docs/connecting-core-extension/` devolvió vacío.
