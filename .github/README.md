# GitHub Configuration

This directory contains GitHub-specific configuration files for the LifeBalance project.

## 📁 Contents

### [`workflows/deploy.yml`](workflows/deploy.yml)
GitHub Actions workflow for automated deployment to Firebase Hosting.

**Triggers:**
- Every push to `main` → Type checks, builds, and deploys
- Every pull request to `main` → Type checks and builds (validation only)

**Steps:**
1. Type check with TypeScript (`npx tsc --noEmit`)
2. Build production bundle (`npm run build`)
3. Deploy to Firebase Hosting (pushes only)

### [`DEPLOYMENT_SETUP.md`](DEPLOYMENT_SETUP.md)
Comprehensive setup guide with manual and automated options.

### Setup Scripts

#### [`quick-setup.sh`](quick-setup.sh) ⚡ **Recommended**
One-command automated setup. Run on your **local machine**:
```bash
bash .github/quick-setup.sh
```

Does everything automatically:
- Adds all environment secrets to GitHub
- Creates Firebase service account
- Verifies authentication

#### [`setup-secrets.sh`](setup-secrets.sh)
Alternative script for just setting up GitHub secrets.

## 🚀 Quick Start

**On your local machine** (not in Codespaces), run:

```bash
bash .github/quick-setup.sh
```

Then push the workflow:

```bash
git add .github/
git commit -m "ci: Add GitHub Actions deployment workflow"
git push origin main
```

Monitor at: https://github.com/OPS-PIvers/LifeBalance/actions

## 🔒 Required Secrets

The workflow needs these GitHub repository secrets:

**Firebase Configuration** (from `.env.local`):
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_GEMINI_API_KEY`

**Deployment**:
- `FIREBASE_SERVICE_ACCOUNT` (from `firebase login:ci`)

## 📊 Workflow Status

[![Deploy to Firebase Hosting](https://github.com/OPS-PIvers/LifeBalance/actions/workflows/deploy.yml/badge.svg)](https://github.com/OPS-PIvers/LifeBalance/actions/workflows/deploy.yml)

## 🌐 Live Site

After deployment: https://lifebalance-26080.web.app

## 🐛 Troubleshooting

See [DEPLOYMENT_SETUP.md](DEPLOYMENT_SETUP.md#troubleshooting) for common issues and solutions.
