import mongoose from 'mongoose';

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      if (this.connection && mongoose.connection.readyState === 1) {
        return this.connection;
      }

      if (mongoose.connection.readyState === 1) {
        this.connection = mongoose.connection;
        return this.connection;
      }

      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/music-scrobbler';
      const dbName = process.env.DB_NAME;
      
      const options = {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      };

      if (dbName) {
        options.dbName = dbName;
      }

      this.connection = await mongoose.connect(mongoUri, options);
      
      const dbLabel = dbName ? `${mongoUri} (db: ${dbName})` : mongoUri;
      console.log(`✅ MongoDB connected successfully to: ${dbLabel}`);
      
      // Handle connection events
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.log('🔌 MongoDB disconnected');
      });

      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      if (process.env.VERCEL === '1') {
        throw error;
      }
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      await mongoose.connection.close();
      console.log('🔌 MongoDB connection closed');
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error);
    }
  }

  getConnection() {
    return this.connection;
  }

  isConnected() {
    return mongoose.connection.readyState === 1;
  }
}

export default new Database();
