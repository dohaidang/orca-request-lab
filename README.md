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

Credential values are stored with Orca Secrets rather than regular plugin storage. Authentication is applied only when a request is sent and is not written into the `.http` file or request history.

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

## Limits and privacy

Response bodies are capped at 768 KB to keep the editor responsive. Request Lab does not collect telemetry. URLs, headers, and bodies are used only to send requests to the destination you specify. Environment configuration and request history remain in Orca's plugin-local storage.

## Testing

```shell
orca plugin check .
orca plugin test .
```

## License

MIT © 2026 Đỗ Hải Đăng
