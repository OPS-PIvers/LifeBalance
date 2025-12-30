# 🚀 Deployment Checklist

## ✅ What's Been Done

1. **GitHub Actions Workflow Created**
   - File: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   - Type checks with TypeScript
   - Builds production bundle
   - Deploys to Firebase Hosting on push to `main`
   - Validates builds on pull requests

2. **TypeScript Environment Setup**
   - Created [`src/vite-env.d.ts`](src/vite-env.d.ts) for Vite env types
   - Fixed all TypeScript compilation errors
   - Build tested and working ✓

3. **Setup Scripts Created**
   - [`.github/quick-setup.sh`](.github/quick-setup.sh) - One-command setup
   - [`.github/setup-secrets.sh`](.github/setup-secrets.sh) - Secrets only
   - Both scripts are executable and ready to use

4. **Documentation**
   - [`.github/DEPLOYMENT_SETUP.md`](.github/DEPLOYMENT_SETUP.md) - Complete setup guide
   - [`.github/README.md`](.github/README.md) - Quick reference
   - This checklist

## 🎯 What You Need to Do

### Step 1: Run Setup Script (5 minutes)

On your **local machine** (not in Codespaces), open a terminal in the project directory and run:

```bash
bash .github/quick-setup.sh
```

This will:
- ✅ Add all environment secrets to GitHub
- ✅ Create Firebase service account for deployment
- ✅ Verify everything is configured correctly

**Why not in Codespaces?**
The Codespaces GitHub token doesn't have permission to manage repository secrets.

### Step 2: Push the Workflow

After the setup script completes, commit and push the workflow:

```bash
git add .github/ src/vite-env.d.ts DEPLOYMENT_CHECKLIST.md
git commit -m "ci: Add GitHub Actions deployment workflow"
git push origin main
```

### Step 3: Monitor Deployment

Watch the deployment happen in real-time:
- GitHub Actions: https://github.com/OPS-PIvers/LifeBalance/actions
- Live site: https://lifebalance-26080.web.app

The first deployment takes ~2-3 minutes.

## 🔧 Alternative: Manual Setup

If you prefer manual setup or the script doesn't work, see the detailed guide:
[`.github/DEPLOYMENT_SETUP.md`](.github/DEPLOYMENT_SETUP.md#option-b-manual-setup-5-minutes)

## 📋 Secrets Required

The following secrets need to be in GitHub (the script adds them automatically):

| Secret Name | Source |
|------------|--------|
| `VITE_FIREBASE_API_KEY` | `.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `.env.local` |
| `VITE_FIREBASE_PROJECT_ID` | `.env.local` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `.env.local` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `.env.local` |
| `VITE_FIREBASE_APP_ID` | `.env.local` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `.env.local` |
| `VITE_GEMINI_API_KEY` | `.env.local` |
| `FIREBASE_SERVICE_ACCOUNT` | `firebase login:ci` |

## 🎉 After Setup

Once deployed, every time you push to `main`:
1. GitHub Actions runs automatically
2. Code is type-checked
3. Production build is created
4. Changes are deployed to Firebase Hosting
5. Your live site updates within 2-3 minutes

## ❓ Need Help?

- **Script fails?** Check [troubleshooting guide](.github/DEPLOYMENT_SETUP.md#troubleshooting)
- **Manual setup?** Follow [manual instructions](.github/DEPLOYMENT_SETUP.md#option-b-manual-setup-5-minutes)
- **Build errors?** Run `npm run build` locally to debug

## 🔒 Security Notes

- ✅ `.env.local` is git-ignored (never committed)
- ✅ Firebase client config is safe to expose (used in browser)
- ✅ Service account credentials only in GitHub secrets
- ✅ Workflow only deploys from `main` branch
