import Database from '../config/database.js';
import { app } from '../index.js';

let connectionPromise;

const ensureDatabaseConnection = async () => {
  if (!connectionPromise) {
    connectionPromise = Database.connect().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
};

export default async function handler(req, res) {
  await ensureDatabaseConnection();
  return app(req, res);
}
