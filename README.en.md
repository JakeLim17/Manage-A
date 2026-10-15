# Manage-A — Local Project Dashboard

[English](README.en.md) · [한국어](README.md)

**Visualize your projects and track AI usage and web analytics on your own computer.**

Manage-A brings project structure, animated flow diagrams, health checks, AI tool usage, and website analytics into one local dashboard. It runs on `127.0.0.1` by default and does not upload the project source files it scans. Connect your own project folders and accounts.

The application interface is currently in Korean. This document provides English setup and feature guidance.

## Features

- **Project visualization:** discover local projects, languages, dependencies, pages, API routes, and Git activity. Explore animated diagrams and file references.
- **Project health:** inspect local HTTP responses, production-site records, and deployment status. Build and test results can be recorded manually.
- **AI usage:** read Codex CLI subscription limits; read Claude Code subscription limits on macOS; import Cursor usage CSV files or record limits manually. Track subscription plans and paused subscriptions separately.
- **API costs:** connect Anthropic or OpenAI organization Admin credentials to read API token and cost reports. These reports are separate from subscription limits.
- **Web analytics:** connect Google Analytics 4 (GA4) and Google Search Console to view active users, page views, channels, search clicks, impressions, and search queries.
- **SEO code checks:** discover sitemap, robots, and metadata files. This does not certify indexing, search ranking, or production behavior.
- **Local management:** keep profile settings, project notes, connections, and report snapshots on your own computer. Example analytics are explicitly labeled.

## Quick start

Install **Node.js 24** (minimum: 22.9). No dependency installation or build step is required.

### 1. Download

```sh
git clone https://github.com/JakeLim17/Manage-A.git
cd Manage-A
```

Without Git, select **Code → Download ZIP**, extract the archive, and open a terminal in that folder.

### 2. Choose your project folder

macOS / Linux:

```sh
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set the absolute path of the folder containing your projects:

```env
PROJECT_ROOT="/Users/your-name/Projects"
HOST=127.0.0.1
PORT=4310
```

On Windows, use a path such as `PROJECT_ROOT="C:/Users/your-name/Projects"`. If `PROJECT_ROOT` is not set, Manage-A scans its parent folder.

### 3. Run

```sh
npm start
```

Open **http://127.0.0.1:4310**. Keep the terminal running; press **Ctrl+C** to stop the server. Run `npm start` again to reopen the dashboard.

On macOS, you can also double-click `Start Dashboard.command`. This launcher uses the default port 4310; use `npm start` for a custom port.

### 4. Configure your workspace

- **Settings (`설정`):** set your display name.
- **Projects (`프로젝트`):** review discovered projects and add descriptions, features, and management status.
- **AI usage (`AI 사용량`):** connect your own CLI accounts, usage CSV files, or API credentials.
- **Web analytics (`방문·검색`):** connect Google, choose the correct project properties, and select Fetch analytics (`통계 가져오기`).
- **User guide (`사용설명서`):** read the in-app instructions for each screen.

Project visualization and management work without analytics credentials. `127.0.0.1` refers to the computer opening the address, so each user runs their own instance.

## Project service accounts and AI setup prompts

The overview shows GitHub, Vercel, and database accounts beside each project, with an account filter to group projects. Register multiple logins with aliases such as Personal 1, Personal 2, and Company through **Add account (`계정 추가`)**. Choose a project and use **Select accounts (`사용 계정 선택`)** to bind each service independently. **Check this project (`이 프로젝트 계정 확인`)** reads the actual resource ownership. Automatic lookup tries registered connections and matches the exact project ID; an explicitly selected login never falls back to another account. **Manage registered accounts (`등록 계정 관리`)** lets you rename aliases or replace an individual token without replacing the other logins.

Open **Service accounts (`서비스 계정`)**, choose a project, review its discovered IDs, and select **Check account (`계정 확인`)**. Targets are discovered from Git origin, Vercel project settings, Supabase project-ref files, and root Wrangler account configuration. Edit IDs explicitly or restore automatic discovery. Project `.env` secrets are not used for discovery.

Authenticated official GitHub and Supabase CLIs can be reused. Vercel and Cloudflare require read tokens. Register tokens through **Connect token (`토큰 연결`)** in local mode. The Supabase picker lists accessible projects for you to choose; similar names are never automatically matched.

The screen separates resource ownership from the login used to query it. Supabase shows the owning organization, without guessing a personal email. Cloudflare verifies configured account access, not a specific Worker or Pages deployment. Failed reads and mismatched IDs are not marked connected. Successful snapshots older than 15 minutes are marked for rechecking.

**Ask AI to connect (`AI에게 연동 요청`)** on the usage and service-account screens generates a copyable setup request. Copying does not send a message or run a connection. Never put tokens in AI chats or commits.

Tokens entered locally are stored in Git-ignored `.local/service-credentials.json`. Optional token environment variables are documented in `.env.example`; legacy tokens and environment credentials remain separately selectable; automatic lookup tries available connections. Manual account labels are notes, not proof of a verified connection.

## Integration requirements

- **Codex:** a locally installed, authenticated Codex CLI. The dashboard reads account rate limits without sending model prompts.
- **Claude subscription limits:** macOS, Python 3, an authenticated Claude Code CLI, and initial setup of the isolated quota-check folder. This integration depends on the CLI `/usage` output format.
- **Cursor:** CSV import and manual records; automatic live subscription quota retrieval is not available.
- **Anthropic / OpenAI API reports:** organization Admin credentials with report access. Personal subscription limits and organization API costs are different metrics.
- **Google analytics:** your own OAuth client JSON or service-account file, access to the selected properties, and enabled Analytics Data API, Analytics Admin API, and Search Console API in the corresponding Cloud project.

For Google OAuth, use Web analytics → Connect with Google (`Google로 연결`). Enter the local OAuth client JSON path, approve the two read-only scopes, then choose Discover properties (`통계 속성 찾기`). Desktop clients use a temporary loopback callback; Web clients require a loopback redirect URI already registered in the client configuration.

The base application uses Node.js. Windows and Linux setup instructions are provided, but real-environment verification has currently been performed on macOS. Claude quota automation requires macOS. Other CLI-dependent features require the relevant tools to be installed locally.

## Data and access

The server binds to `127.0.0.1` by default. Management settings and saved reports are stored under `.local/`; dashboard OAuth and API credentials are stored locally and are not included in dashboard responses or management exports.

`.env`, `.local/`, `output/`, and `.output/` are excluded from Git. Keep OAuth client JSON and service-account keys outside the repository. Exported project information and real-data screenshots can contain private information.

Remote access requires separate configuration. See the [Korean README](README.md#원격-접근-선택) for the authenticated remote mode and SSH tunnel instructions.

## Troubleshooting

- **`node` or `npm` is missing:** install Node.js, reopen the terminal, and check `node --version`.
- **No projects appear:** check `PROJECT_ROOT` and restart the server after changing `.env`.
- **Port 4310 is in use:** check an existing Manage-A process, or choose a different `PORT` and open that port's address.
- **Google is connected but reports fail:** check the three Cloud APIs, property permissions, and project-specific property selection. Authentication and actual data receipt are shown separately.
- **AI limits are unavailable:** check CLI installation, login, platform support, and the connector's diagnosis. The dashboard does not invent missing limits.

## Development

```sh
npm run dev
npm run check
npm test
```

Tests use temporary project and data folders and ports 4319/4320. They do not modify your actual managed projects.

## License

A software license has not yet been designated. Permission for reuse and redistribution will be documented when a license is selected.
