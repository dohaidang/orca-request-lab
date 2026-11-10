# Request Lab

Request Lab is a focused HTTP workbench for Orca IDE. It reads `.http` and `.rest` files, sends requests directly from your machine, and presents status, timing, size, headers, and response bodies in a compact two-pane interface.

## Features

- Multiple requests per file, separated with `###`.
- GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE, and CONNECT.
- Request headers and raw or JSON bodies.
- Send with the button or `Ctrl+Enter`; cancel and resend without leaving the editor.
- JSON and XML formatting, text rendering, image previews, and binary response metadata.
- A quick-request panel and a custom editor for `.http` and `.rest` files.
- Named environments with `{{variable}}` substitution.
- Dynamic `{{$timestamp}}` and `{{$randomUUID}}` variables.
- Encrypted Bearer, Basic, and API key credentials through Orca Secrets.
- Local request history with status, duration, and replay.
- cURL import for common `-X`, `-H`, `-d`, `--data-*`, and `--url` options.
- Declarative status, header, body, and JSON assertions.
- JSON response capture into the active environment.
- Sequential collection runner with pass/fail results.
- Code generation for cURL, JavaScript Fetch, and Python Requests.
- OpenAPI 3.x JSON import with generated requests, examples, and assertions.
- In-memory session cookie jar with domain, path, expiry, and secure-cookie handling.
- Configurable retries for idempotent requests and transient HTTP failures.
- Collection report export as JSON or JUnit XML.
- OAuth 2.0 Client Credentials with encrypted secrets and in-memory token caching.
- GraphQL-over-HTTP request builder with JSON variables.
- Per-request timeout, retry, and cookie directives.
- No telemetry and no intermediary request service.

## Requirements

- Orca IDE 1.4.255 or newer.
- Approval to run the trusted worker used for direct HTTP and HTTPS requests.

## Development installation

1. Open **Settings → Plugins → Development** in Orca.
2. Select **Add path** and choose this repository folder.
3. Review and approve the trusted-worker permission, then enable the plugin.
4. Open the **Request Lab** panel, or open a `.http`/`.rest` file and select the **Request Lab** editor.

## Request syntax

```http
# @name Read item
GET {{baseUrl}}/api/items/1
Accept: application/json

### Create item
POST {{baseUrl}}/api/items
Content-Type: application/json

{
  "name": "demo",
  "requestId": "{{$randomUUID}}"
}
```

Create an environment named `Development`, add `baseUrl`, and Request Lab resolves the value immediately before sending. Missing variables stop the request and are listed in the UI.

## Authentication

Open **Auth** in the top toolbar and choose one of the following modes:

- **Bearer token** adds an `Authorization: Bearer …` header.
- **Basic auth** combines the configured username and password.
- **API key** adds a configurable header or query parameter.
- **OAuth 2.0 Client Credentials** obtains and caches an access token from the configured token endpoint.

Credential values are stored with Orca Secrets rather than regular plugin storage. Authentication is applied only when a request is sent and is not written into the `.http` file or request history.

OAuth client secrets use HTTP Basic authentication when requesting a token. Tokens are cached only in worker memory and refreshed before expiry. Token endpoint URLs must use HTTP or HTTPS.

## cURL import

Choose **Import cURL**, paste a command, and Request Lab converts it into `.http` syntax. Imported requests are appended to the current workbench and remain fully editable.

## History

The latest 30 requests are stored locally. History records the request name, method, template URL, response status, duration, and timestamp. It does not store generated authorization headers or encrypted credential values.

## Assertions and captures

Place declarative checks before the request line:

```http
# @name Create session
# @expect status 201
# @expect header content-type contains application/json
# @expect json $.user.id exists
# @expect body contains token
# @capture accessToken $.token
POST {{baseUrl}}/sessions
Content-Type: application/json

{"email":"developer@example.com"}
```

Supported assertion forms:

- `# @expect status 200`
- `# @expect header Content-Type contains application/json`
- `# @expect header X-Request-Id exists`
- `# @expect json $.data.id equals 42`
- `# @expect json $.items[0].name contains demo`
- `# @expect body contains success`

`# @capture variableName $.json.path` writes a successful JSON extraction into the active environment. A later request in the same collection run can use it as `{{variableName}}`.

## Collection runner

Choose **Run all** to execute requests from top to bottom. Request Lab applies the active environment and authentication to every request, evaluates assertions, performs captures, and presents an aggregate result panel. The run can be stopped while a request is active.

## Code generation

Choose **Generate code** for the selected request and switch between cURL, JavaScript Fetch, and Python Requests. Environment variables are resolved, while saved authentication is deliberately excluded so encrypted credentials are not exposed in generated source.

## OpenAPI import

Choose **OpenAPI**, paste an OpenAPI 3.x JSON document, and build a collection. Request Lab imports every supported path operation, converts path and required query parameters into `{{variables}}`, creates request body examples from schemas, and adds an assertion for explicit `2xx` responses.

The importer intentionally accepts JSON only. YAML documents should be converted to JSON before import.

## GraphQL builder

Choose **GraphQL** and provide an endpoint, query or mutation, optional operation name, and JSON variables. Request Lab creates a standard POST request with `Content-Type: application/json` plus status and `$.data` assertions. The generated request remains ordinary `.http` text and works with environments, authentication, capture, and collection runs.

## Per-request runtime directives

Place runtime overrides before a request line:

```http
# @timeout 5s
# @retry 2
# @cookies off
GET {{baseUrl}}/health
```

- `# @timeout 5000` uses milliseconds; `# @timeout 5s` uses seconds.
- `# @retry 0` through `# @retry 3` overrides the global retry policy.
- `# @cookies on` or `# @cookies off` overrides the session cookie jar for that request.

## Network runtime

Open **Network** to configure session cookies and retry behavior:

- The cookie jar respects cookie domain, path, expiry, and `Secure` attributes.
- Cookies live only in worker memory and disappear when the plugin stops.
- Cookies can be cleared immediately from the Network panel.
- Retries are limited to GET, HEAD, PUT, DELETE, and OPTIONS.
- Retryable responses are `429`, `502`, `503`, and `504`, plus transient network failures.
- The retry limit is capped at three attempts after the initial request.

## Reports

After running a collection, open **Results** and export either:

- **JSON** for custom tooling and archival.
- **JUnit XML** for CI systems and test-report viewers.

Reports contain request names, status codes, timing, assertions, captures, and summary counts. They do not contain encrypted authentication credentials.

## Limits and privacy

Response bodies are capped at 768 KB to keep the editor responsive. Request Lab does not collect telemetry. URLs, headers, and bodies are used only to send requests to the destination you specify. Environment configuration and request history remain in Orca's plugin-local storage.

## Testing

```shell
orca plugin check .
orca plugin test .
```

## License

MIT © 2026 Đỗ Hải Đăng
