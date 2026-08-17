import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BACKUP_ROOT = path.resolve('public', 'data-backups');
const OUTPUT_ROOT = path.resolve('decrypted-backups');

const ENCRYPTED_FIELDS = {
  users: ['email', 'role', 'permissions', 'joinedBoards', 'ownedBoards', 'class', 'mutedUntil', 'banned'],
  posts: ['content', 'context', 'title', 'authorName', 'authorId', 'targetGroups'],
  comments: ['content', 'context', 'authorName', 'authorId'],
  confessions: ['content', 'context', 'authorName', 'authorId', 'toName']
};

let encryptKeyBuf = null;
if (process.env.BACKUP_ENCRYPT_KEY && process.env.BACKUP_ENCRYPT_KEY.length === 64) {
  encryptKeyBuf = Buffer.from(process.env.BACKUP_ENCRYPT_KEY, 'hex');
} else {
  console.error('BACKUP_ENCRYPT_KEY is missing or invalid');
  process.exit(1);
}

function decryptValue(value) {
  if (value === undefined || value === null || value === '') return value;
  const text = String(value);
  if (!/^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(text)) return value;

  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptKeyBuf, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function decryptDocument(collection, doc) {
  const cloned = { ...doc };
  const fields = ENCRYPTED_FIELDS[collection] || [];
  for (const field of fields) {
    if (field in cloned) {
      cloned[field] = decryptValue(cloned[field]);
    }
  }
  return cloned;
}

function decryptCollection(collection) {
  const folder = path.join(BACKUP_ROOT, collection);
  if (!fs.existsSync(folder)) {
    console.log(`No folder for ${collection}, skipping`);
    return;
  }

  const outputFolder = path.join(OUTPUT_ROOT, collection);
  fs.mkdirSync(outputFolder, { recursive: true });

  const files = fs.readdirSync(folder).filter(f => f.startsWith('chunk-') && f.endsWith('.json'));
  let totalDocs = 0;
  const allDocs = [];

  for (const file of files) {
    const filePath = path.join(folder, file);
    console.log(`Processing ${file}`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const decryptedChunk = data.map(doc => {
      totalDocs++;
      return decryptDocument(collection, doc);
    });

    const outFilePath = path.join(outputFolder, file);
    fs.writeFileSync(outFilePath, JSON.stringify(decryptedChunk, null, 2), 'utf8');
    allDocs.push(...decryptedChunk);
  }

  const mergedFile = path.join(OUTPUT_ROOT, `${collection}-all.json`);
  fs.writeFileSync(mergedFile, JSON.stringify(allDocs, null, 2), 'utf8');

  console.log(`Decrypted ${totalDocs} documents in ${collection}`);
}

function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  for (const collection of Object.keys(ENCRYPTED_FIELDS)) {
    decryptCollection(collection);
  }

  console.log('Decryption completed. Output in decrypted-backups/');
}

main();
