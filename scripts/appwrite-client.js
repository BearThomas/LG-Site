const fs = require('fs');
const path = require('path');
const { Client, Databases } = require('node-appwrite');

function loadLocalEnv() {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        const [rawKey, ...rawValueParts] = trimmed.split('=');
        const key = rawKey.trim();
        const value = rawValueParts.join('=').trim().replace(/^['"]|['"]$/g, '');

        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

loadLocalEnv();

const APPWRITE_ENDPOINT = clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1');
const APPWRITE_PROJECT_ID = clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg');
const APPWRITE_API_KEY = clean(process.env.APPWRITE_API_KEY);
const DATABASE_ID = clean(process.env.APPWRITE_DATABASE_ID || 'lg');

if (!APPWRITE_API_KEY) {
    throw new Error('APPWRITE_API_KEY is required. Put it in .env or set it before running the script.');
}

const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

const databases = new Databases(client);

module.exports = {
    DATABASE_ID,
    databases
};
