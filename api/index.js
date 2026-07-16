import Database from '../config/database.js';
import { app } from '../index.js';
import authService from '../services/authService.js';

let connectionPromise;

const ensureDatabaseConnection = async () => {
  if (!connectionPromise) {
    connectionPromise = Database.connect()
      .then(() => authService.seedAdmin())
      .catch((error) => {
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
