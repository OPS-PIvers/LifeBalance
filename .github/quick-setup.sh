#!/bin/bash

# Quick GitHub Actions Setup - Run this on your LOCAL machine
# This script does everything in one go

set -e

echo "🚀 LifeBalance - GitHub Actions Quick Setup"
echo "==========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v gh &> /dev/null; then
    echo -e "${RED}❌ GitHub CLI not found${NC}"
    echo ""
    echo "Install it first:"
    echo "  macOS:   brew install gh"
    echo "  Ubuntu:  sudo apt install gh"
    echo "  Windows: Download from https://cli.github.com/"
    exit 1
fi

if ! command -v firebase &> /dev/null; then
    echo -e "${RED}❌ Firebase CLI not found${NC}"
    echo ""
    echo "Install it first:"
    echo "  npm install -g firebase-tools"
    exit 1
fi

echo -e "${GREEN}✅ All tools installed${NC}"
echo ""

# Authenticate if needed
echo "🔐 Checking authentication..."

if ! gh auth status &> /dev/null; then
    echo "Logging into GitHub..."
    gh auth login
fi

if ! firebase projects:list &> /dev/null 2>&1; then
    echo "Logging into Firebase..."
    firebase login
fi

echo -e "${GREEN}✅ Authenticated${NC}"
echo ""

# Get repo info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo -e "📦 Repository: ${GREEN}$REPO${NC}"
echo ""

# Check .env.local
if [ ! -f .env.local ]; then
    echo -e "${RED}❌ .env.local not found${NC}"
    echo "Create it from .env.local.example first"
    exit 1
fi

# Load environment variables
echo "📥 Loading environment variables from .env.local..."
set -a
source .env.local
set +a

# Add all secrets
echo ""
echo "🔑 Adding secrets to GitHub repository..."
echo ""

add_secret() {
    local name=$1
    local value=$2
    if gh secret set "$name" -b"$value" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $name"
        return 0
    else
        echo -e "  ${RED}✗${NC} $name (failed)"
        return 1
    fi
}

add_secret "VITE_FIREBASE_API_KEY" "$VITE_FIREBASE_API_KEY"
add_secret "VITE_FIREBASE_AUTH_DOMAIN" "$VITE_FIREBASE_AUTH_DOMAIN"
add_secret "VITE_FIREBASE_PROJECT_ID" "$VITE_FIREBASE_PROJECT_ID"
add_secret "VITE_FIREBASE_STORAGE_BUCKET" "$VITE_FIREBASE_STORAGE_BUCKET"
add_secret "VITE_FIREBASE_MESSAGING_SENDER_ID" "$VITE_FIREBASE_MESSAGING_SENDER_ID"
add_secret "VITE_FIREBASE_APP_ID" "$VITE_FIREBASE_APP_ID"
add_secret "VITE_FIREBASE_MEASUREMENT_ID" "$VITE_FIREBASE_MEASUREMENT_ID"

if [ "$VITE_GEMINI_API_KEY" != "your_gemini_api_key_here" ] && [ -n "$VITE_GEMINI_API_KEY" ]; then
    add_secret "VITE_GEMINI_API_KEY" "$VITE_GEMINI_API_KEY"
else
    echo -e "  ${YELLOW}⊘${NC} VITE_GEMINI_API_KEY (skipped - placeholder detected)"
fi

echo ""
echo "🔐 Setting up Firebase deployment..."
echo ""

# Get Firebase token
echo "Getting Firebase CI token..."
echo -e "${YELLOW}A browser window will open - please authenticate${NC}"
echo ""

FIREBASE_TOKEN=$(firebase login:ci --no-localhost 2>&1 | grep -oP '1//[A-Za-z0-9_-]+' | head -1)

if [ -z "$FIREBASE_TOKEN" ]; then
    echo -e "${RED}❌ Failed to get Firebase token${NC}"
    echo ""
    echo "Please run this manually:"
    echo "  1. firebase login:ci"
    echo "  2. Copy the token"
    echo "  3. Run: gh secret set FIREBASE_SERVICE_ACCOUNT -b\"<token>\""
    exit 1
fi

if add_secret "FIREBASE_SERVICE_ACCOUNT" "$FIREBASE_TOKEN"; then
    echo ""
    echo -e "${GREEN}✅ Firebase service account configured${NC}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎉 All secrets have been added to GitHub!"
echo ""
echo "🚀 Next steps:"
echo "   1. Push the workflow to GitHub:"
echo "      ${YELLOW}git add .github/${NC}"
echo "      ${YELLOW}git commit -m 'ci: Add GitHub Actions deployment workflow'${NC}"
echo "      ${YELLOW}git push origin main${NC}"
echo ""
echo "   2. Monitor the deployment:"
echo "      https://github.com/$REPO/actions"
echo ""
echo "   3. Your app will be live at:"
echo "      https://lifebalance-26080.web.app"
echo ""
