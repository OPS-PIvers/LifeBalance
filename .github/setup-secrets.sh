#!/bin/bash

# GitHub Actions Secrets Setup Script
# This script helps you add all required secrets to your GitHub repository

set -e

echo "🔧 GitHub Actions Secrets Setup for LifeBalance"
echo "================================================"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed."
    echo "   Install it from: https://cli.github.com/"
    echo ""
    echo "   On macOS: brew install gh"
    echo "   On Ubuntu: sudo apt install gh"
    echo ""
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "🔐 Authenticating with GitHub..."
    gh auth login
fi

echo "✅ GitHub CLI is ready"
echo ""

# Get repository info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

if [ -z "$REPO" ]; then
    echo "❌ Not in a GitHub repository or repository not found"
    echo "   Make sure you're in the LifeBalance directory and it's pushed to GitHub"
    exit 1
fi

echo "📦 Repository: $REPO"
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ .env.local file not found"
    echo "   Please create it from .env.local.example first"
    exit 1
fi

# Source the .env.local file
set -a
source .env.local
set +a

echo "🔑 Adding Firebase configuration secrets..."

gh secret set VITE_FIREBASE_API_KEY -b"$VITE_FIREBASE_API_KEY" && echo "  ✓ VITE_FIREBASE_API_KEY"
gh secret set VITE_FIREBASE_AUTH_DOMAIN -b"$VITE_FIREBASE_AUTH_DOMAIN" && echo "  ✓ VITE_FIREBASE_AUTH_DOMAIN"
gh secret set VITE_FIREBASE_PROJECT_ID -b"$VITE_FIREBASE_PROJECT_ID" && echo "  ✓ VITE_FIREBASE_PROJECT_ID"
gh secret set VITE_FIREBASE_STORAGE_BUCKET -b"$VITE_FIREBASE_STORAGE_BUCKET" && echo "  ✓ VITE_FIREBASE_STORAGE_BUCKET"
gh secret set VITE_FIREBASE_MESSAGING_SENDER_ID -b"$VITE_FIREBASE_MESSAGING_SENDER_ID" && echo "  ✓ VITE_FIREBASE_MESSAGING_SENDER_ID"
gh secret set VITE_FIREBASE_APP_ID -b"$VITE_FIREBASE_APP_ID" && echo "  ✓ VITE_FIREBASE_APP_ID"
gh secret set VITE_FIREBASE_MEASUREMENT_ID -b"$VITE_FIREBASE_MEASUREMENT_ID" && echo "  ✓ VITE_FIREBASE_MEASUREMENT_ID"

if [ "$VITE_GEMINI_API_KEY" != "your_gemini_api_key_here" ] && [ -n "$VITE_GEMINI_API_KEY" ]; then
    gh secret set VITE_GEMINI_API_KEY -b"$VITE_GEMINI_API_KEY" && echo "  ✓ VITE_GEMINI_API_KEY"
else
    echo "  ⚠️  VITE_GEMINI_API_KEY not set (placeholder value detected)"
    echo "     You can add it later with: gh secret set VITE_GEMINI_API_KEY"
fi

echo ""
echo "🔐 Setting up Firebase Service Account..."
echo ""
echo "Now you need to create a Firebase service account token."
echo "Run this command and follow the instructions:"
echo ""
echo "  firebase login:ci"
echo ""
echo "Then add the token to GitHub with:"
echo ""
echo "  gh secret set FIREBASE_SERVICE_ACCOUNT -b\"<paste-token-here>\""
echo ""
echo "Or run this automated setup (requires manual authentication):"
echo ""
echo "  FIREBASE_TOKEN=\$(firebase login:ci --no-localhost)"
echo "  gh secret set FIREBASE_SERVICE_ACCOUNT -b\"\$FIREBASE_TOKEN\""
echo ""
echo "✅ Environment secrets setup complete!"
echo ""
echo "🚀 Next steps:"
echo "   1. Set up the FIREBASE_SERVICE_ACCOUNT secret (see above)"
echo "   2. Push your code to trigger the workflow:"
echo "      git add .github/"
echo "      git commit -m 'ci: Add GitHub Actions workflow'"
echo "      git push origin main"
echo ""
