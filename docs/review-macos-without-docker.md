# 评审：macOS 不用 Docker 的启动方案

> 由像素办公室的代码评审员 Casey 完成（provider=qoder，任务 #8 交付物 v1）。清库重做真实起点前留档。

# Code review: macOS startup without Docker (Homebrew PostgreSQL 16)

**Change under review:** the docker-compose Postgres service is replaced by Homebrew PostgreSQL 16 on port **5432** (was 5433), and the venv's CA is pointed at `/etc/ssl/cert.pem`.

**Assumption:** this is a local-development change, and CI still targets the compose path — anything macOS-specific leaking into shared defaults breaks it [NEEDS INPUT: CI workflow]. Claims not verified against a source are marked (unverified); confirm them before acting.

**Missing inputs** (placeholders below until provided):
- [NEEDS INPUT: compose file/override diff — removed service, old port mapping, image tag, credentials]
- [NEEDS INPUT: `.env.example`, app settings / `DATABASE_URL` handling]
- [NEEDS INPUT: `alembic.ini` and `alembic/env.py` URL source]
- [NEEDS INPUT: `conftest.py` / test fixtures]
- [NEEDS INPUT: CI workflow and production DB config]
- [NEEDS INPUT: exact CA/SSL setup commands — env var, pip config, or edited `venv/bin/activate`]
- [NEEDS INPUT: `SHOW hba_file;` output and role list (`\du`) on the Homebrew cluster]

---

## 必须修 (Must fix)

### M1. Authentication: local cluster likely defaults to trust + a superuser role
- **Where:** [NEEDS INPUT: pg_hba.conf, role list, app DSN]
- **Problem:** the compose service defined its own user/password [NEEDS INPUT: compose file]. Homebrew's `initdb` creates a superuser named after the macOS account and, by default, `trust` auth for local connections (unverified — confirm via `SHOW hba_file;`). If `trust` also covers 127.0.0.1 on 5432, **any** process on the machine can connect as any role with no password. The cluster is now shared with every other project on the machine, so a superuser DSN can reach other projects' databases.
- **Why it matters:** least-privilege violation with a large blast radius; it also diverges from CI's password auth, so auth bugs surface late.
- **Fix:** create a dedicated role (e.g. `bookshop`) owning only `bookshop_dev`/`bookshop_test`; require `scram-sha-256` for `host` (TCP) lines; keep the password in the gitignored `.env`. Commit no `pg_hba.conf` edits.

**Checklist — authentication**
- [ ] dedicated non-superuser role for the app
- [ ] `scram-sha-256` required for TCP
- [ ] `trust` limited to (or removed from) the local socket
- [ ] no `pg_hba.conf` changes in git
- [ ] DSN only in gitignored `.env`, not in tracked settings defaults

### M2. Port 5432 enables silent wrong-server connections
- **Where:** [NEEDS INPUT: `.env.example`, settings default, compose port mapping]
- **Problem:** 5432 is Postgres's default port. A second local Postgres (another project, Postgres.app, second Homebrew install) either blocks `brew services start` or, with a stale DSN, the app connects to *that* server without error. On 5433 a mismatch failed loudly.
- **Why it matters:** connecting to a similarly named database on another cluster is silent data loss; port-in-use is a classic onboarding blocker.
- **Fix:** either keep a non-default port (5433 also stays consistent with upstream) or add a preflight: `pg_isready -p 5432` plus an app-startup check that `current_database()`/`current_user` match expectations. If 5432 stays, database and role names must be unique per project.

### M3. Test suite is not provably isolated from the dev database
- **Where:** [NEEDS INPUT: conftest.py, test settings]
- **Problem:** nothing guarantees tests hit a separate database. On the shared cluster, fixtures that drop/create tables or run migrations will act on `bookshop_dev` if the URL points there.
- **Why it matters:** destructive fixture actions on dev data; concurrent runs fight over one database.
- **Fix:** separate `bookshop_test` database; test role has no privileges on the dev DB; a guard in `conftest.py` that refuses to run unless the URL's database name ends in `_test`.

**Checklist — data isolation**
- [ ] `bookshop_dev` and `bookshop_test` as separate databases
- [ ] test role cannot write to dev DB
- [ ] `conftest.py` asserts `_test` database
- [ ] documented reset procedure

### M4. `/etc/ssl/cert.pem` in the venv is machine-specific and over-broad
- **Where:** [NEEDS INPUT: exact CA/SSL setup commands]
- **Problem:** (a) the path is macOS-only — CI (Linux) and other machines fail with hard-to-debug `SSLError`s; (b) `/etc/ssl/cert.pem` is the system trust bundle (unverified), so OS updates — or anything added to the system store, e.g. a proxy CA — silently change what the venv trusts; (c) a loopback Postgres normally needs no CA at all, so the override likely leaks beyond its intended purpose (e.g. `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE` applying to every HTTPS client in the venv).
- **Why it matters:** reproducibility and trust hygiene; it can also mask the real fix (e.g. the app not using `certifi`).
- **Fix:** for the DB use `sslmode=disable`/`prefer` on loopback so the CA is irrelevant; for HTTPS clients rely on `certifi` and, only if a custom CA is genuinely required, append that single CA. Scope any `SSL_CERT_FILE` to the one command that needs it, inside the macOS setup script — not in shared config or a hand-edited venv.

### M5. Migrations: no idempotent bootstrap, wrong default target
- **Where:** [NEEDS INPUT: alembic.ini, `alembic/env.py`, setup script/Makefile]
- **Problem:** the compose image created its role and database automatically (unverified — confirm against the compose file); Homebrew does not. On a fresh machine `alembic upgrade head` runs against whatever the hardcoded URL says — old 5433 → connection refused, or dev DB by default → silent data mutation.
- **Why it matters:** onboarding friction plus migrations pointed at the wrong database.
- **Fix:** idempotent `scripts/setup_db.sh` (create role if absent, `createdb` for dev/test, grants) wired into README/Makefile; `env.py` reads `DATABASE_URL` from the environment with **no** default pointing at dev; `make migrate` fails unless the URL names the expected database.

**Checklist — migrations/tests**
- [ ] alembic URL comes from env only, no hardcoded host/port
- [ ] fresh-machine setup script is idempotent
- [ ] tests never run against a non-`_test` URL
- [ ] upgrade + downgrade both exercised on the new cluster

### M6. Upstream sync: keep machine-specific changes out of tracked files
- **Where:** [NEEDS INPUT: list of tracked files edited vs upstream]
- **Problem:** every edit to tracked defaults (compose ports, `.env.example`, settings defaults, CA paths) reappears as a conflict on each `git fetch upstream` / rebase, and risks macOS-specific edits reaching CI or other contributors as an accidental "fix".
- **Why it matters:** the fork-vs-upstream diff should stay semantic, not environmental; merge friction compounds with every change.
- **Fix:** drive everything through env vars (`DATABASE_URL`, …); local values in gitignored `.env`; don't edit `docker-compose.yml` at all — simply stop using it locally; prefer adding new files (scripts, docs) over editing existing ones; document the macOS deviation in a README section instead of changing shared defaults.

**Checklist — upstream sync**
- [ ] zero edits to tracked env/port defaults
- [ ] overrides only in gitignored files
- [ ] new files added rather than existing files edited
- [ ] deviation documented in README
- [ ] trial `git fetch upstream && git rebase` done on a scratch branch

---

## 建议修 (Suggested)

### S1. Data-directory lifecycle (backup / reset / upgrade)
- **Where:** [NEEDS INPUT: setup docs]
- **Problem:** container data vanished predictably with `down -v`; the Homebrew cluster persists silently (default data dir under Homebrew's `var`, e.g. `/opt/homebrew/var/postgresql@16` on Apple Silicon, unverified), and a major Homebrew PostgreSQL upgrade requires a documented upgrade step before the cluster starts (unverified).
- **Fix:** document `pg_dump` backup, a `make reset-db` that drops/recreates databases (not the cluster), and the major-upgrade command; note that deleting the data directory destroys **all** local databases.

### S2. Keep the Docker path working for CI and other contributors
- **Where:** [NEEDS INPUT: CI workflow]
- **Problem:** if CI or teammates still use compose, divergent local-only docs rot quickly, and a changed tracked port default breaks the compose path.
- **Fix:** README "two supported paths" (Docker / macOS-native) sharing the same env-var contract; CI untouched.

### S3. Migration round-trip check
- **Problem:** nothing verifies `alembic downgrade base && upgrade head` still works after model changes on the new cluster.
- **Fix:** one scheduled CI job (or weekly local task) running the round-trip against `bookshop_test`.

### S4. Version drift note
- **Problem:** Homebrew updates PostgreSQL 16 minors outside project control (unverified); local minor drift vs CI is usually harmless but should be known when migration behaviour differs.
- **Fix:** record `SELECT version();` output in onboarding docs; pin only if a mismatch actually bites.

---

## 可接受 (Acceptable)

- **PostgreSQL 16 locally** — matching the compose image's major version keeps migration behaviour consistent [NEEDS INPUT: compose image tag and CI/production Postgres major version].
- **Port 5432** — acceptable *only after* M2's collision check passes; matches the Postgres default and simplifies DSNs.
- **`brew services` running Postgres at login** — normal dev-machine convenience; stop it when unused.
- **A venv-level CA override** — acceptable only in the narrowed form from M4 (scoped to one command, single CA appended, not the whole system bundle, never in tracked config).
- **Leaving `docker-compose.yml` in the repo unused locally** — acceptable; it keeps the upstream diff empty and the Docker path intact for CI/others.

## Sources

None cited — no web research results were available for this review. Statements about tool behaviour marked (unverified) should be confirmed against the PostgreSQL 16 documentation (`pg_hba.conf`, `initdb`, `sslmode`), the Homebrew `postgresql@16` formula/service documentation and Apple's certificate trust documentation before this review is finalised.

## Open items

- CI workflow and production DB config (decides M2/M4/M6 severity and S2)
- Compose file/override: removed service, port mapping, image tag, credentials (M1, M5, 可接受)
- Exact CA/SSL setup commands (M4)
- `SHOW hba_file;` and `\du` output from the Homebrew cluster (M1)
- `conftest.py`, `alembic/env.py`, `.env.example` and settings defaults (M3, M5)