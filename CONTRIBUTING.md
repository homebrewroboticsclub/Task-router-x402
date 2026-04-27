# Contributing to Task-router-x402

Public contributor expectations. Keep **README.md** and **config/env.example** accurate when you change behavior, routes, or environment variables.

## Language

- **Committed text must be English:** source, comments, commit messages, operator-facing logs, CLI help, `config/env.example`, **README.md**, **docs/**, OpenAPI/JSDoc, and UI strings in **public/**.
- **`npm test`** runs `test/no-cyrillic-in-repo.test.js` — do not add Cyrillic (or other non-ASCII script leakage) to tracked sources; fix at the source instead of excluding paths without maintainer approval.

## API contract

- OpenAPI is built with **swagger-jsdoc** (`src/docs/swagger.js` + `**@openapi**` on routers).
- When you add, remove, or change a public HTTP endpoint, update the matching JSDoc block and `components.schemas` if needed. Verify **Swagger UI** `/docs` and **JSON** `/docs-json`.
- **Robot-facing paths, headers, and JSON field names** used in production integrations are **stability-sensitive**. See [docs/ROBOT_INTEGRATION_STABILITY.md](docs/ROBOT_INTEGRATION_STABILITY.md); do not rename them for branding alone.

## Tests

- Do not change behavior without tests that cover the affected logic (unit or integration as appropriate).
- Integration tests that touch PostgreSQL must use **`TEST_DATABASE_URL`**, not production or compose `DATABASE_URL`.

## What not to commit

- **`.env`**, real keys, repository archives (`*.zip`, etc.), or **`private/`** contents.
- Do not run destructive SQL (`DROP`, `TRUNCATE` on production tables) or `docker compose down -v` on shared data without explicit operator approval.

Maintainers may keep a local **`AGENTS.md`** (gitignored) for team- or tool-specific automation rules; it is **not** part of the public tree.
