## Client Identity & API Configuration Parameters
- Must categorize incoming InnerTube API requests strictly based on the `clientName` and `clientVersion` payload parameters.
- Must provide a valid Proof of Origin (PoToken) when spoofing the `IOS` client to prevent HTTP 403 Forbidden responses, playback buffering, and reduced format availability.
- Shall expect SABR (Server Adaptive Bit Rate) protocol enforcement to restrict formats to 360p resolution or completely obfuscate stream data when utilizing the `TVHTML5` client.
- Shall utilize the `TVHTML5_SIMPLY_EMBEDDED_PLAYER` client to bypass age restrictions and web-based consent flows.
- Must utilize the `WEB_CREATOR` client to bypass restrictions exclusively when active account cookies are available.
- Shall utilize the `ANDROID_VR` client to bypass specific PoToken requirements, acknowledging the strict unavailability of "Made for Kids" content.
- Must utilize the `WEB` client tied to a valid Visitor ID or Session ID alongside a strict BotGuard attestation.

## Cryptographic Attestation (BotGuard & DroidGuard) Boundaries
- Must generate and submit a valid Proof of Origin (PoToken) to prevent HTTP Error 403 Forbidden responses or immediate, persistent IP address bans when querying the Google Video Server (GVS).
- Must fetch the Virtual Machine interpreter script and challenge program exclusively from the `api/jnn/v1/Create` endpoint.
- Must dynamically locate the initialization key by extracting a 3-character substring concatenated with an underscore from the bytecode string stored within the DOM.
- Must execute the memory reader function `H` to correctly encrypt bytes prior to returning them to the execution stack.
- Must maintain and track the exact register state: Register `21` as a rolling key array, `Z.W` as a linearly incrementing position tracker, and `Z.U` as a mutating cryptographic seed based on system time and execution history.
- Never attach standard browser debuggers or inject `console.log` statements; doing so triggers anti-logger traps that modify the `t.prototype` stack, shift the memory pointer, corrupt the instruction stream, and output an invalid `bgRequest` token.
- Must mimic the exact chronometric execution speed of a genuine browser to prevent statistical time-analysis failures.
- Must execute token generation in completely isolated external microservices (e.g., `bgutil-ytdlp-pot-provider` or `rustypipe-botguard`) utilizing sterile Deno and JSDOM environments.
- Must submit the resulting challenge calculation to the `api/jnn/v1/GenerateIT` endpoint to receive an integrity token.
- Must append session-bound tokens as a `pot` URL parameter for raw stream URLs.
- Must cryptographically bind unauthenticated session-bound tokens to the Visitor ID extracted from the `VISITOR_INFO1_LIVE` cookie or `visitorData` payload.
- Must transmit content-bound tokens within the `serviceIntegrityDimensions.poToken` payload for InnerTube player API requests.
- Must calculate a mathematically unique content-bound BotGuard challenge strictly bound to the specific Video ID for every single video processed.

## Signature Cipher Decryption Mechanics
- Must locate, extract, and execute the dynamic signature cipher decryption algorithm embedded within the `base.js` JavaScript payload.
- Must parse the URL-encoded `signatureCipher` field to extract the encrypted signature `s`, the base media URL `url`, and the signature parameter key `sp` (designated as `sig` or `nsig`).
- Must append the locally decrypted signature to the finalized stream URL.
- Must execute fallback extraction using an external headless JavaScript engine (PhantomJS, Node.js, or QuickJS) if hardcoded regular expressions fail to identify the decryption function.
- Never submit a mathematically incorrect `nsig` token; failure results in an immediate HTTP 403 Forbidden response and extreme bandwidth throttling to mere kilobytes per second.

## Browser Fingerprinting & Evasion Constraints
- Must overwrite `navigator.webdriver` to `false` using mechanisms that evade JavaScript prototype chain traversal checks.
- Never leak headless testing framework global variables (e.g., the `cdc_` variable array for ChromeDriver, or `__playwright` objects) into the window scope.
- Must configure the `WEBGL_debug_renderer_info` extension to return authentic consumer GPU strings for the `UNMASKED_VENDOR_WEBGL` and `UNMASKED_RENDERER_WEBGL` properties.
- Never return software renderer identification strings such as `SwiftShader`, `Mesa OffScreen`, or `llvmpipe`.
- Must match consumer font libraries (e.g., Microsoft Segoe UI or Apple San Francisco) and authentic sub-pixel anti-aliasing outputs to pass hidden `<canvas>` cryptographic pixel hashing.
- Must patch the browser engine directly at the C++ level (e.g., Camoufox) to emulate standard consumer screen geometry, font tables, and WebGL rendering contexts without relying on JavaScript overrides.

## Authentication & WebSocket Channels
- Never transport or spoof session cookies (`VISITOR_INFO1_LIVE` and `__Secure-3PSID`) from residential environments to headless datacenter servers.
- Must authenticate datacenter nodes utilizing the OAuth 2.0 Device Authorization Grant (RFC 8628) via the `google.com/device` endpoint.
- Must strictly spoof the `TVHTML5` client identity to establish OAuth 2.0 Device Flows.
- Must support and securely expose internal WebSocket channels to maintain continuous authentication polling, remote control, and state reporting.
- Must install the `websockets` Python dependency when executing yt-dlp to prevent immediate process termination and request errors.

## Rate Limiting & HTTP Error Codes
- Must implement exponential backoff algorithms, rotate the egress IP address, and purge cached session data upon encountering an HTTP 429 Too Many Requests status code.
- Must honor HTTP `Retry-After` headers to prevent continuous 429 triggering.
- Must mandate a strict 24-hour halt in pipeline traffic for penalized residential IP addresses to reset internal trust scores.
- Must ensure the IP address utilized by the proxy to resolve the stream manifest identically matches the geolocation of the worker node IP executing the binary download to prevent an HTTP 403 Forbidden mismatch.
- Never rotate IP addresses within the boundaries of a single IPv6 `/64` subnet (comprising 18.4 quintillion addresses); algorithms aggregate and ban the entire `/64` prefix simultaneously.
- Never rely on sequential `/24` IPv4 blocks; algorithms block the entire `/24` subnet when abuse thresholds are breached.

## Network Routing & IP Rotation Topology
- Must route the Control Plane (API calls, InnerTube metadata requests, `base.js` fetching, BotGuard challenges) exclusively through Residential Proxies costing between $4 and $15 per gigabyte.
- Must route the Data Plane (binary stream downloads) exclusively through Datacenter or IPv6 infrastructure costing $1.00 to $2.50 monthly per IP, or $0.60 per GB.
- Must automate kernel-level IPv6 rotation utilizing Stateless Address Autoconfiguration (SLAAC) and IPv6 Privacy Extensions.
- Must configure `sysctl` interface parameters to `privext 2` and `use_tempaddr 2`.
- Must set the SLAAC Preferred Lifetime (`temp_prefered_lft`) exactly to `1800` seconds to initiate all new TCP connections.
- Must set the SLAAC Valid Lifetime (`temp_valid_lft`) exactly to `3600` seconds to maintain deprecated IP address viability for an additional 1800 seconds, preventing ongoing download stream termination.
- Must utilize custom cronjob bash scripts executing `ip -6 addr add` to assign a random 64-bit interface ID every 30 minutes in hosting environments lacking native SLAAC support.

## Storage, Memory & Disk I/O Specifications
- Must process downloads and FFmpeg multiplexing entirely within primary volatile memory (RAM) utilizing a Linux `tmpfs` RAM disk to bypass IOPS saturation and disk fragmentation.
- Must explicitly define execution paths to segregate volatile workspace from permanent storage (e.g., `--paths "temp:/mnt/ramdisk" --paths "home:/mnt/hdd_storage"`).
- Must provision the `tmpfs` partition with sufficient gigabytes of RAM to concurrently hold the raw video file, the raw audio file, metadata tags, and FFmpeg processing overhead.
- Must strictly disable the default `--continue` behavior to prevent lingering `.part` fragments from causing fatal RAM disk exhaustion.
- Must mandate aggressive garbage collection wrappers (e.g., `--exec before_dl:"clean.sh"`) to purge abandoned partial files prior to initiating new downloads.

## Concurrency & Threading Parameters
- Must integrate external downloaders (e.g., `aria2c`) to force fragment concurrency on single file downloads.
- Must pass precise connection parameters to external downloaders to bypass connection limits: `--downloader aria2c --downloader-args aria2c:"-x 16 -k 1M"` establishing 16 concurrent TCP byte-range connections.
- Must implement process-level concurrency using message brokers (RabbitMQ/Redis) and worker node frameworks (Celery/GNU Parallel) with isolated yt-dlp instances.
- Must establish strict semaphores locking the FFmpeg multiplexing queue to a sequential process to prevent catastrophic CPU context switching and RAM disk exhaustion.

## SABR & Universal Media Protocol (UMP) Processing
- Shall expect non-compliant clients executing extraction against SABR to be permanently restricted to legacy Format 18 capping resolution at 360p.
- Must parse the proprietary, obfuscated UMP blob format to extract dynamically shifting internal stream URLs.
- Must request stream chunks utilizing precise millisecond time values rather than standard HTTP byte-ranges.
- Must extract multiplexed audio and video segments delivered within a single HTTP response or WebSocket payload.
- Must decode UMP variable-sized integers by reading the first 5 bits of the first byte to determine integer length.
- Must process proprietary UMP metadata blocks including Part 34 (`LIVE_METADATA_PROMISE_CANCELLATION`) and Part 36 (`USTREAMER_VIDEO_AND_FORMAT_DATA`).
- Must programmatically suppress and ignore server-side backoff instructions designed to force client fake buffering.
- Must inject reverse-engineered protocol bridges (`SabrStreamingAdapter` and `SabrUmpProcessor`) into core extraction hooks to unpack UMP wrappers in-memory prior to FFmpeg handover.