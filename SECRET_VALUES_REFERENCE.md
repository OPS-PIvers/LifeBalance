# GitHub Secrets - Correct Values Reference

## ⚠️ Problem Detected

The deployed app is using literal variable names instead of actual values. This means the GitHub secrets were set to the variable names rather than the actual API keys.

## 🔍 How to Verify

Go to: https://github.com/OPS-PIvers/LifeBalance/settings/secrets/actions

Check if your secrets have these exact values:

## ✅ Correct Secret Values (from your .env.local)

Copy these **exact values** when updating your GitHub secrets:

| Secret Name | Correct Value |
|------------|---------------|
| `VITE_FIREBASE_API_KEY` | `AIzaSyB6iDEWegkSWN4IsYygPh9HjKUwRqu19-4` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `lifebalance-26080.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `lifebalance-26080` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `lifebalance-26080.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `611571061016` |
| `VITE_FIREBASE_APP_ID` | `1:611571061016:web:241054ac44415661830e6d` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `G-JJNX8HYJZK` |
| `VITE_GEMINI_API_KEY` | *(Your actual Gemini API key - currently placeholder)* |
| `FIREBASE_SERVICE_ACCOUNT` | *(Your service account JSON - already set correctly)* |

## 🛠️ Fix Options

### Option 1: Automated Script (Recommended - 1 minute)

On your **local machine**, run:

```bash
bash .github/fix-secrets.sh
```

This will update all secrets with the correct values from your `.env.local` file.

### Option 2: Manual Update (5 minutes)

1. Go to: https://github.com/OPS-PIvers/LifeBalance/settings/secrets/actions
2. For each secret in the table above:
   - Click the secret name
   - Click "Update"
   - **Copy the value EXACTLY from the "Correct Value" column above**
   - Click "Update secret"

## ❌ Common Mistake

**WRONG** ❌: Setting the value to `VITE_FIREBASE_API_KEY` (the variable name)
**RIGHT** ✅: Setting the value to `AIzaSyB6iDEWegkSWN4IsYygPh9HjKUwRqu19-4` (the actual API key)

## 🚀 After Fixing

Trigger a new deployment:

```bash
git commit --allow-empty -m "chore: Trigger deployment with fixed secrets"
git push origin main
```

The new deployment will use the correct API keys and your app will work properly.

## 🔒 Security Note

Firebase client-side configuration (API keys, project IDs, etc.) are **safe to expose** in client-side code. These are public by design. The security is enforced by Firebase security rules, not by hiding these values.
