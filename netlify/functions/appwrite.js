const { Account, Client, Databases, Users } = require('node-appwrite');

function clean(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '').trim();
}

const APPWRITE_ENDPOINT = clean(process.env.APPWRITE_ENDPOINT || 'https://sgp.cloud.appwrite.io/v1');
const APPWRITE_PROJECT_ID = clean(process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT || 'lg');
const APPWRITE_API_KEY = clean(process.env.APPWRITE_API_KEY);
const DATABASE_ID = clean(process.env.APPWRITE_DATABASE_ID || process.env.DATABASE_ID || 'lg');
const COLLECTION_BOARDS = clean(process.env.APPWRITE_COLLECTION_BOARDS || 'boards');
const COLLECTION_POSTS = clean(process.env.APPWRITE_COLLECTION_POSTS || 'posts');
const COLLECTION_USERS = clean(process.env.APPWRITE_COLLECTION_USERS || 'users');

function createAdminClient() {
    return new Client()
        .setEndpoint(APPWRITE_ENDPOINT)
        .setProject(APPWRITE_PROJECT_ID)
        .setKey(APPWRITE_API_KEY);
}

function createJwtClient(jwt) {
    return new Client()
        .setEndpoint(APPWRITE_ENDPOINT)
        .setProject(APPWRITE_PROJECT_ID)
        .setJWT(jwt);
}

function createAccount(jwt) {
    return new Account(createJwtClient(jwt));
}

function createDatabases() {
    return new Databases(createAdminClient());
}

function createUsers() {
    return new Users(createAdminClient());
}

module.exports = {
    COLLECTION_BOARDS,
    COLLECTION_POSTS,
    COLLECTION_USERS,
    DATABASE_ID,
    createAccount,
    createDatabases,
    createUsers
};
