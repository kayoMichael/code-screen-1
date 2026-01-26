# Code Screen Setup Instructions

Welcome! This document will help you get the codebase running on your local machine.

## Required Tools

Before starting, ensure you have the following installed:

| Tool | Version | Installation |
|------|---------|--------------|
| **Docker** | Latest | [docker.com/get-docker](https://docs.docker.com/get-docker/) |
| **Docker Compose** | v2+ | Included with Docker Desktop |
| **Make** | Any | Pre-installed on macOS/Linux. Windows: use WSL2 or Git Bash |
| **Git** | Any | [git-scm.com](https://git-scm.com/) |

### Optional (for local development without Docker)

| Tool | Version | Installation |
|------|---------|--------------|
| **nvm** | Latest | [github.com/nvm-sh/nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows) (Windows) |
| **Node.js** | 22+ | `nvm install 22 && nvm use 22` |
| **Yarn** | 1.22+ | `npm install -g yarn` |

> **Important**: This project uses Yarn. Do not use npm.

## Quick Start

### 1. Fork and clone the repository

1. Click the **Fork** button in the top-right corner of the repository page
2. Clone your fork:

```bash
git clone https://github.com/<your-username>/code-screen-1.git
cd code-screen-1
```

### 2. Set Node version

```bash
nvm use 22
```

### 3. Build and start all services

First time only, build the Docker images:
```bash
make dev
```

Then start all services:
```bash
make up
```

This will:
- Start PostgreSQL database
- Run database migrations automatically
- Start the backend server
- Start the frontend web app

### 4. Access the application

Once the containers are running:

| Service | URL |
|---------|-----|
| **Web App** | http://localhost:8280 |
| **GraphQL API** | http://localhost:3200/v1 |
| **Prisma Studio** (DB GUI) | http://localhost:3201 |

## Useful Commands

| Command | Description |
|---------|-------------|
| `make up` | Start all services |
| `make down` | Stop all services |
| `make exec-server` | Open shell in server container |
| `make exec-web` | Open shell in web container |
| `make test-server` | Run backend tests |
| `make studio` | Open Prisma Studio (local dev) |

## Database Migrations

After editing `server/prisma/schema.prisma`, generate a migration:

1. Shell into the server container:
   ```bash
   make exec-server
   ```

2. Create the migration:
   ```bash
   yarn prisma migrate dev
   ```

3. Enter a name for your migration when prompted, then exit the container

4. Regenerate the Prisma client:
   ```bash
   cd server && yarn db:gen
   ```

## Troubleshooting

### Ports already in use
Ensure these ports are available: **5434**, **3200**, **3201**, **8280**

```bash
# Check what's using a port (macOS/Linux)
lsof -i :8280
```

### Containers not starting
```bash
make down
make clean
make up
```

### Database issues
```bash
# Shell into server container
make exec-server

# Run migrations manually
yarn prisma migrate dev
```

### Permission denied on Make
```bash
# If make isn't found on Windows, use Docker Compose directly
docker compose up
```

## Need Help?

If you encounter any issues during setup, please reach out to your interviewer.

Good luck!
