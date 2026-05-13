import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDB() {
  await mongoose.connect(env.mongoUri, { autoIndex: true });
  console.log('[db] conectado ao MongoDB');
}
