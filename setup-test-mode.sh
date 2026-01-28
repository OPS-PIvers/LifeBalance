#!/bin/bash

# LifeBalance Test Mode Setup Script
# This script configures the environment for AI coding agents to explore the application
# without requiring Firebase authentication or a real backend.

set -e  # Exit on error

echo "🧪 LifeBalance Test Mode Setup"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the LifeBalance root directory."
    exit 1
fi

# Check if .env.local exists
if [ -f ".env.local" ]; then
    echo "📋 Found existing .env.local file"

    # Check if test mode is already enabled
    if grep -q "VITE_ENABLE_TEST_MODE=true" .env.local; then
        echo "✅ Test mode is already enabled in .env.local"
    else
        echo "⚙️  Adding test mode flag to .env.local..."
        echo "" >> .env.local
        echo "# Test Mode (for AI coding agents)" >> .env.local
        echo "VITE_ENABLE_TEST_MODE=true" >> .env.local
        echo "✅ Test mode enabled"
    fi
else
    echo "⚙️  Creating .env.local file..."
    cat > .env.local << 'EOF'
# LifeBalance Environment Configuration
# This is a minimal configuration for TEST MODE only

# Test Mode (for AI coding agents)
VITE_ENABLE_TEST_MODE=true

# Firebase Configuration (not required for test mode, but included for reference)
# Uncomment and fill in if you need real Firebase integration
# VITE_FIREBASE_API_KEY=your_firebase_api_key
# VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
# VITE_FIREBASE_PROJECT_ID=your-project-id
# VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
# VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
# VITE_FIREBASE_APP_ID=your_app_id
# VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Gemini API (not required for test mode)
# VITE_GEMINI_API_KEY=your_gemini_api_key

# Firebase Cloud Messaging (not required for test mode)
# VITE_FIREBASE_VAPID_KEY=your_vapid_key_here
EOF
    echo "✅ Created .env.local with test mode enabled"
fi

echo ""
echo "📦 Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "⚙️  Installing dependencies (this may take a minute)..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📖 Next Steps:"
echo "================================"
echo ""
echo "1. Start the development server:"
echo "   npm run dev"
echo ""
echo "2. Navigate to test mode URL:"
echo "   http://localhost:3000/#/login?test=true"
echo ""
echo "3. You'll see an orange '🧪 TEST MODE - MOCK DATA' banner"
echo ""
echo "📝 What You Get in Test Mode:"
echo "================================"
echo "• Pre-authenticated as 'Test User' (test@example.com)"
echo "• Mock household with sample data:"
echo "  - 3 accounts (checking, savings, credit)"
echo "  - 4 budget buckets (Groceries, Entertainment, Utilities, Gas)"
echo "  - 2 sample transactions"
echo "  - 2 health habits ready for tracking"
echo "  - 2 stores (Safeway, Costco)"
echo "• Full CRUD operations (in-memory only)"
echo "• No Firebase/API keys required"
echo "• All data cleared on browser restart"
echo ""
echo "🔒 Security Notes:"
echo "================================"
echo "• Test mode ONLY works in development"
echo "• Mock code is automatically excluded from production builds"
echo "• Session-only persistence (no data saved)"
echo ""
echo "💡 Useful Commands:"
echo "================================"
echo "• npm run dev       - Start development server"
echo "• npm run build     - Build for production"
echo "• npm run lint      - Run linter"
echo ""
echo "📚 Documentation:"
echo "================================"
echo "• CLAUDE.md         - Full project documentation"
echo "• README.md         - Project overview"
echo ""
echo "Happy coding! 🚀"
