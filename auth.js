import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { db } from './db.js';

const port = process.env.PORT || '3000';
const baseURL = process.env.BETTER_AUTH_URL || `http://localhost:${port}`;
const secret = process.env.BETTER_AUTH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters. See .env.example.');
}

export const auth = betterAuth({
  database: db,
  baseURL,
  secret,
  trustedOrigins: [baseURL],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100
  },
  plugins: [
    admin({
      defaultRole: 'user',
      bannedUserMessage: 'This teacher account is disabled. Please contact the seating-chart administrator.'
    })
  ]
});
