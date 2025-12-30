#!/bin/bash

# Script to update GitHub secrets with correct values from .env.local

set -e

echo "🔧 Fixing GitHub Secrets"
echo "========================"
echo ""

# Load environment variables from .env.local
if [ ! -f .env.local ]; then
    echo "❌ .env.local not found"
    exit 1
fi

set -a
source .env.local
set +a

echo "📤 Updating GitHub secrets with correct values..."
echo ""

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
    echo "  ⊘ VITE_GEMINI_API_KEY (skipped - placeholder value)"
fi

echo ""
echo "✅ Secrets updated!"
echo ""
echo "🚀 Trigger a new deployment:"
echo "   git commit --allow-empty -m 'chore: Trigger deployment with fixed secrets'"
echo "   git push origin main"
echo ""
