# GEWT Fee Management

Tauri + React desktop client with a Rust Axum API and PostgreSQL persistence.

## Desktop Client

```bash
bun install
bun run dev
```

Set `VITE_API_BASE_URL` if the API is not running on `http://localhost:8080`.

```bash
VITE_API_BASE_URL=http://localhost:8080 bun run dev
```

## API

```bash
cd api
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/gewt
export JWT_SECRET=replace-me
cargo run
```

The API runs migrations on startup. Seed data includes branches `Prantij`, `HMT`, `Talod`, September as the academic year start month, and the initial admin login:

```text
user ID: admin
password: admin123
```

Rotate the seeded password and `JWT_SECRET` before production use.

## Checks

```bash
bun run build
cd api && cargo check
cd src-tauri && cargo check
```
