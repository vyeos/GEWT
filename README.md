# GEWT Fee Management

Tauri + React desktop client with a Rust Axum API and PostgreSQL persistence.

## Desktop Client

```bash
bun install
bun run dev
```

Set `VITE_API_BASE_URL` if the API is not running on `http://localhost:45123`.

```bash
VITE_API_BASE_URL=http://localhost:45123 bun run dev
```

## Shipped Desktop API Configuration

The packaged Tauri app starts the Rust API inside the desktop app. On user
machines, put the API environment file at the app config path:

macOS:

```text
~/Library/Application Support/com.vyeos.gewt/.env
```

Windows:

```text
%APPDATA%\com.vyeos.gewt\.env
```

Example:

```env
DATABASE_URL=postgres://user:password@host:5432/gewt
JWT_SECRET=replace-me-with-a-long-random-secret
API_ADDR=127.0.0.1:45123
```

The desktop UI talks to the embedded API on `http://localhost:45123`.

## API

```bash
cd api
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/gewt
export JWT_SECRET=replace-me
export API_ADDR=127.0.0.1:45123
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
