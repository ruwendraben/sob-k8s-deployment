# ShopsOnBoard (SOB)

A multi-service application with client and author services.

## Project Structure

```
├── client/        # Public timeline & seller frontend
├── author/        # Admin dashboard
└── .github/       # GitHub Actions workflows
```

## Setup

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Git

### Generate Lock Files

Before pushing or running CI, generate `package-lock.json` files for both services to ensure reproducible builds:

Note:- for windows have to run "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"

```bash
# Install dependencies for client
cd client
npm install

# Install dependencies for author
cd ../author
npm install

# Commit the lock files
cd ..
git add client/package-lock.json author/package-lock.json
git commit -m "add package-lock.json files"
git push origin master
```

This ensures:
- Exact dependency versions are locked
- CI builds are reproducible across all machines
- GitHub Actions caching works properly

## Development

### Run Locally

```bash
# Client service
cd client
npm run dev

# Author service (in another terminal)
cd author
npm run dev
```

### Run with Docker

```bash
# Build and run client
cd client
docker-compose up

# Build and run author (in another terminal)
cd author
docker-compose up
```

## CI/CD

### GitHub Actions

- **CI Workflow** (`.github/workflows/ci.yml`): Runs on push/PR to `master`
  - Installs dependencies
  - Runs syntax checks
  - Builds Docker images

- **Deploy Workflow** (`.github/workflows/deploy.yml`): Runs on push to `master`
  - Builds and pushes Docker images to AWS ECR

### AWS Setup

1. Create ECR repositories:
   - `sob-client`
   - `sob-author`

2. Add GitHub Secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
