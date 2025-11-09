import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'data.sqlite');
const schemaPath = path.join(__dirname, '..', 'schema.sql');

const db = new Database(dbPath);
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);
console.log('Database initialized at', dbPath);
