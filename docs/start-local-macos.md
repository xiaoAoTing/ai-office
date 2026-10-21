# 本地启动指南（macOS）

AI Office 本地跑起来需要三个服务：**PostgreSQL**、**后端（FastAPI）**、**前端（Next.js）**。
本机没有用 Docker 跑数据库，而是 Homebrew 的 `postgresql@16`，本文以此为准。

## 一条命令启动（推荐）

仓库根目录执行：

```bash
./dev.sh
```

脚本按顺序做完所有前置检查再起服务：缺 `backend/.env`、`frontend/.env.local`、`.venv`、`node_modules` 就自动补；
数据库连不上会先尝试 `brew services start postgresql@16`，不行再提示怎么办；然后自动跑 `alembic upgrade head`，
起后端和前端，并等两个服务真的应答了才算启动成功（不是"进程还在"就算成功）。

**改代码不用重启**：后端跑在 `uvicorn --reload` 下，改 `backend/app` 里的 `.py` 会自动重启（实测 worker 进程号会变、
`/health` 依旧正常）；前端是 `next dev`，改 `frontend/src` 即时热更新。两处例外要知道：
改 `backend/.env` / `frontend/.env.local` 里的配置不会被自动重启覆盖，改依赖要重跑脚本 —— 都是重启一下 `./dev.sh` 的事。

`Ctrl+C` 一次性停掉两个服务，不会留下孤儿进程。如果上次是被 `kill -9` 打死的，端口会被残留实例占住，
脚本这次启动时认得出来（按本项目自己的启动命令行匹配），问一句就把那棵进程树收掉；认不出归属的进程它不动。

常用参数：

| 参数 | 作用 |
|---|---|
| `--web-port 3002` | 指定前端端口。默认 3000，被占用时自动往上找空位（本机 3000/3001 常被你其他 dev server 占着，实测会落到 3002）；换端口时如果该来源不在 `CORS_ORIGINS` 里，脚本会临时补上（不改你的 `backend/.env`） |
| `--api-port 8001` | 指定后端端口，同样会往上找空位，前端地址自动跟着改 |
| `--skip-migrate` | 跳过 `alembic upgrade head`，启动更快 |
| `--open` | 就绪后自动打开浏览器 |
| `-y` | 前置修复不再逐个确认（无人值守时用） |

日志同时打到终端（带 `[api]` / `[web]` 前缀）和临时目录，脚本结尾会打印日志目录路径，出问题时去那里看全文。

## 手动分别启动（想看清每一步时）

三个终端窗口，按顺序启动：

### 1. PostgreSQL

```bash
brew services list | grep postgres   # 查看状态
brew services start postgresql@16    # 未启动时执行
```

`brew services` 是常驻服务，开机自启，通常不需要每次都手动开。

### 2. 后端（端口 8000）

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --port 8000 --timeout-graceful-shutdown 2
```

验证：浏览器打开 http://localhost:8000/health 返回正常即启动成功。

### 3. 前端（第二个终端，端口 3000）

```bash
cd frontend
npm run dev -- -H 127.0.0.1
```

只监听 127.0.0.1，避免暴露到局域网。若 3000 端口被其他本地项目占用，可换端口：

```bash
npm run dev -- -H 127.0.0.1 -p 3001
```

换端口后需要同步两处配置：

- `backend/.env` 的 `CORS_ORIGINS` 加入新来源，如 `["http://localhost:3000","http://localhost:3001"]`
- `frontend/.env.local` 的 `NEXT_PUBLIC_API_URL` 保持指向 `http://localhost:8000`（后端端口没变就不用动）

### 打开

浏览器访问 http://localhost:3000（或你改后的端口）。

## 停止

后端和前端终端里 `Ctrl+C` 即可。数据库想停就 `brew services stop postgresql@16`，一般留着。

## 首次搭建（换新机器时做一次）

`./dev.sh` 会把环境文件、虚拟环境、依赖、迁移都自动补齐，但不创建数据库角色和库 —— 下面第一步仍然要手动做一次。

### 数据库

```bash
brew install postgresql@16 && brew services start postgresql@16
createuser -h 127.0.0.1 -d postgres ai_office
# 必须授予 CREATEDB：pytest 每个会话会自己重建 ai_office_test
psql -h 127.0.0.1 -d postgres -c 'ALTER ROLE ai_office CREATEDB;'
createdb -h 127.0.0.1 -U ai_office ai_office
createdb -h 127.0.0.1 -U ai_office ai_office_test
```

注意：Homebrew 走默认端口 **5432**；docker-compose 的数据库发布在 **5433**，两种方式的连接串不同。

### 后端

```bash
cd backend
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

编辑 `.env`，把 `DATABASE_URL` / `TEST_DATABASE_URL` 指向本机数据库（127.0.0.1:5432，密码换成上面建角色时设的），然后：

```bash
alembic upgrade head      # 建表
python -m app.seed --demo # 演示数据（空库才允许）；或不带 --demo 只建六个 agent
```

### 前端

```bash
cd frontend
cp .env.example .env.local
npm ci
```

## 执行器模式（backend/.env 的 `EXECUTOR_WORKER`）

| 值 | 说明 | 依赖 |
|---|---|---|
| `fake` | 占位文本，走完整流程，无需模型（默认） | 无 |
| `llm` | 本地 Ollama 模型出真实文本 | Ollama + GPU |
| `qoder` | 每个阶段一次 `qoder -p`，无需 GPU/Docker | Qoder CLI 在 PATH |
| `websearch` | 不用模型，agent 实时镜像本 CLI 会话的直播桥 | Qoder CLI |

## 可选服务

- **Web 搜索（SearXNG）**：根目录 `.env` 设置 `SEARXNG_SECRET`，`docker compose up -d`，监听 `127.0.0.1:8888`。不启也能跑，只是研究阶段没有联网检索。
- **API 交互文档**：默认关闭，需要时在 `backend/.env` 设 `API_DOCS=true` 后访问 http://localhost:8000/docs。

## 常见问题

- **pip 全部 HTTPS 失败**：python.org 官方安装包不带 CA bundle，`export SSL_CERT_FILE=/etc/ssl/cert.pem`，或在 `.venv/pip.conf` 里加 `cert = /etc/ssl/cert.pem`。
- **前端页面请求被 403/400 拒绝**：检查 `CORS_ORIGINS` 是否包含当前前端来源，Host 是否是 `localhost` / `127.0.0.1`。
- **端口被占**：`lsof -nP -iTCP:3000 -iTCP:8000 -sTCP:LISTEN` 看被谁占了。`./dev.sh` 自己会往上找空位并临时补 CORS，
  所以一般不用管；确认是本项目上次没退干净的残留，脚本也会先问一句再回收。
- **界面一直显示「No data from /api/v1/state. Is the backend running?」，但后端其实是好的**：
  看地址栏 —— 如果打开的是 `http://127.0.0.1:300x`（`next dev` 因为绑在 127.0.0.1 上，它自己打印的就是这个链接），
  而这个来源不在后端 `CORS_ORIGINS` 里，浏览器会静默拦掉 `/api/v1/state`，页面就永远停在"没有数据"。
  验证方法：`curl -i -H "Origin: http://127.0.0.1:3002" http://127.0.0.1:8000/api/v1/state | grep -i access-control`，
  没有输出就说明这个来源被拦了。`./dev.sh` 现在会把 `localhost` 和 `127.0.0.1` 两个来源一起补上；
  手动启动的话，两个都写进 `backend/.env` 的 `CORS_ORIGINS`，或者干脆统一用 `http://localhost:…` 打开。
- **后端每次热重启都有一行 `CancelledError: Task cancelled, timeout graceful shutdown exceeded`**：来自
  `--timeout-graceful-shutdown 2` 到点掐断还在跑的 SSE/executor 任务，是手动按 README 的命令启动时也会有的正常日志，
  不是热重启失败。
