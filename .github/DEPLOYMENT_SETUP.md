# GitHub Actions Deployment Setup Guide

This guide will help you complete the setup for automated deployments to Firebase Hosting.

## What's Already Done ✅

- GitHub Actions workflow created at [`.github/workflows/deploy.yml`](workflows/deploy.yml)
- Workflow configured to:
  - Type check with TypeScript
  - Build the application
  - Deploy to Firebase Hosting on pushes to `main`
  - Validate builds on pull requests (without deploying)

## What You Need to Do

### Option A: Automated Setup (Recommended - 2 minutes)

Run this single command from your project root on your **local machine**:

```bash
bash .github/setup-secrets.sh
```

This script will:
1. Verify you have GitHub CLI installed and authenticated
2. Automatically add all Firebase environment variables as GitHub secrets
3. Guide you through setting up the Firebase service account

### Option B: Manual Setup (5 minutes)

#### Step 1: Add Environment Variable Secrets

Go to your GitHub repository settings:
**https://github.com/OPS-PIvers/LifeBalance/settings/secrets/actions**

Click "New repository secret" and add each of these:

| Secret Name | Value (from your .env.local) |
|------------|------------------------------|
| `VITE_FIREBASE_API_KEY` | `AIzaSyB6iDEWegkSWN4IsYygPh9HjKUwRqu19-4` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `lifebalance-26080.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `lifebalance-26080` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `lifebalance-26080.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `611571061016` |
| `VITE_FIREBASE_APP_ID` | `1:611571061016:web:241054ac44415661830e6d` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-JJNX8HYJZK` |
| `VITE_GEMINI_API_KEY` | Your actual Gemini API key |

#### Step 2: Create Firebase Service Account

The service account allows GitHub Actions to deploy to Firebase Hosting.

**Option 2A: Using Firebase CLI (Easiest)**

1. Run this command on your **local machine**:
   ```bash
   firebase login:ci
   ```

2. Follow the authentication flow in your browser

3. Copy the token that's displayed

4. Add it as a GitHub secret:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: The token you just copied

**Option 2B: Using Service Account JSON (More Secure)**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: **lifebalance-26080**
3. Go to **IAM & Admin** → **Service Accounts**
4. Click **Create Service Account**
   - Name: `github-actions-deployer`
   - Click **Create and Continue**
5. Grant these roles:
   - **Firebase Hosting Admin**
   - **Service Account User**
6. Click **Done**
7. Click on the service account you just created
8. Go to **Keys** tab → **Add Key** → **Create new key**
9. Choose **JSON** format and download
10. Copy the entire contents of the downloaded JSON file
11. Add it as a GitHub secret:
    - Name: `FIREBASE_SERVICE_ACCOUNT`
    - Value: Paste the entire JSON content

## Verify Setup

Once you've added all secrets, push this workflow to GitHub:

```bash
git add .github/
git commit -m "ci: Add GitHub Actions deployment workflow"
git push origin main
```

You can monitor the deployment at:
**https://github.com/OPS-PIvers/LifeBalance/actions**

## How It Works

### On Every Push to `main`:
1. ✅ Checks out your code
2. ✅ Installs dependencies
3. ✅ Runs TypeScript type checking
4. ✅ Builds the production app
5. 🚀 Deploys to Firebase Hosting (https://lifebalance-26080.web.app)

### On Pull Requests:
1. ✅ Checks out the PR code
2. ✅ Installs dependencies
3. ✅ Runs TypeScript type checking
4. ✅ Builds the production app
5. ⏸️  Does NOT deploy (validates only)

## Troubleshooting

### "failed to fetch public key: HTTP 403"
- You need to run the setup from your **local machine**, not in Codespaces
- The Codespaces GitHub token doesn't have permission to manage secrets

### Build Fails with "Environment variable not found"
- Check that all secrets are added in GitHub repository settings
- Secret names must match exactly (case-sensitive)

### Deployment Fails with "Permission denied"
- Verify the `FIREBASE_SERVICE_ACCOUNT` secret is set correctly
- Ensure the service account has **Firebase Hosting Admin** role

### Type Check Fails
- Run `npx tsc --noEmit` locally to see the errors
- Fix TypeScript errors before pushing

## Next Steps

After successful deployment:
- Your app will be live at https://lifebalance-26080.web.app
- Every push to `main` will automatically deploy within 2-3 minutes
- Pull requests will be validated but not deployed
- You can view deployment logs in the GitHub Actions tab

## Security Notes

- Never commit `.env.local` to git (it's already in `.gitignore`)
- Firebase client config (API keys) are safe to expose in client-side code
- Service account credentials should only be stored as GitHub secrets
- The workflow only deploys from the `main` branch
