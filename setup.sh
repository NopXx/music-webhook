#!/bin/bash
# Setup script สำหรับ Music Webhook Server

echo "🎵 Setting up Music Webhook Server..."
echo ""

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun.js is not installed. Please install it first:"
    echo "   curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✅ Bun.js found: $(bun --version)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
bun install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully!"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  .env file not found. Creating from template..."
    
    # Create .env from template
    cat > .env << EOF
# Server Configuration
PORT=3000
HOST=localhost

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/music-scrobbler
DB_NAME=music-scrobbler

# API Configuration
WEBHOOK_SECRET=webhook-secret-$(openssl rand -hex 16)
API_KEY=api-key-$(openssl rand -hex 16)

# Environment
NODE_ENV=development
EOF

    echo "✅ .env file created with random secrets"
    echo "   Please review and update the configuration as needed"
else
    echo "✅ .env file already exists"
fi

# Check MongoDB connection
echo ""
echo "🔌 Checking MongoDB connection..."

if command -v mongosh &> /dev/null; then
    mongosh --eval "db.runCommand({ ping: 1 })" --quiet > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ MongoDB is running and accessible"
    else
        echo "⚠️  MongoDB is not running. Please start it:"
        echo "   brew services start mongodb-community"
        echo "   # or"
        echo "   mongod"
    fi
elif command -v mongo &> /dev/null; then
    mongo --eval "db.runCommand({ ping: 1 })" --quiet > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ MongoDB is running and accessible"
    else
        echo "⚠️  MongoDB is not running. Please start it:"
        echo "   brew services start mongodb-community"
        echo "   # or"
        echo "   mongod"
    fi
else
    echo "⚠️  MongoDB client not found. Please install MongoDB:"
    echo "   brew install mongodb-community"
fi

echo ""
echo "🚀 Setup complete! You can now:"
echo ""
echo "   Start development server:  bun run dev"
echo "   Start production server:   bun run start"
echo "   Run tests:                 bun run test"
echo ""
echo "📋 Next steps:"
echo "   1. Review .env configuration"
echo "   2. Start MongoDB if not running"
echo "   3. Run 'bun run dev' to start the server"
echo "   4. Configure web-scrobbler to use: http://localhost:3000/webhook/scrobble"
echo ""
echo "📖 Check README.md for detailed documentation"
