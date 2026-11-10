# Security Policy

## Supported version

Security fixes are applied to the latest version on the `main` branch.

## Reporting a vulnerability

Do not publish credentials, private endpoints, or exploit details in a public issue. Contact the maintainer through the GitHub profile associated with this repository and provide:

- the affected version;
- reproduction steps;
- expected and observed behavior;
- the potential impact;
- any suggested mitigation.

## Security model

Request Lab runs as an Orca trusted worker because it must make direct network requests. Review the permission prompt before enabling it. Authentication secrets use Orca Secrets. OAuth tokens and cookies remain in worker memory. Workspace exports omit environment values by default, and request history redacts sensitive headers and credential-like query parameters.
