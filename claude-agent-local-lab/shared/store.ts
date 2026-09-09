import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export type Item = Record<string, any>;
let connection: DatabaseSync;
function db() {
  if (!connection) {
    if (!process.env.LAB_DB) throw new Error('Use npm run dev to configure the local lab.');
    mkdirSync(dirname(process.env.LAB_DB), { recursive: true, mode: 0o700 });
    connection = new DatabaseSync(process.env.LAB_DB);
    connection.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS items (thread TEXT, sk TEXT, data TEXT NOT NULL, PRIMARY KEY(thread, sk)); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT NOT NULL, run TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_thread ON events(thread, seq);');
    chmodSync(process.env.LAB_DB, 0o600);
  }
  return connection;
}
export function transaction<T>(fn: () => T): T {
  db().exec('BEGIN IMMEDIATE');
  try { const result = fn(); db().exec('COMMIT'); return result; }
  catch (error) { db().exec('ROLLBACK'); throw error; }
}
export function getItem(thread: string, sk = 'META'): Item | undefined {
  const row = db().prepare('SELECT data FROM items WHERE thread = ? AND sk = ?').get(thread, sk);
  return row ? JSON.parse(String(row.data)) : undefined;
}
export function putItem(thread: string, sk: string, data: Item) {
  db().prepare('INSERT INTO items(thread, sk, data) VALUES (?, ?, ?) ON CONFLICT(thread, sk) DO UPDATE SET data=excluded.data').run(thread, sk, JSON.stringify(data));
}
export function listItems(thread: string, prefix = ''): Item[] {
  return db().prepare('SELECT data FROM items WHERE thread = ? AND sk LIKE ? ORDER BY sk DESC').all(thread, prefix + '%').map(row => JSON.parse(String(row.data)));
}
export function updateMeta(thread: string, data: Item) {
  transaction(() => { const meta = getItem(thread); if (!meta) throw new Error('Missing conversation'); putItem(thread, 'META', { ...meta, ...data }); });
}
export function saveArtifact(thread: string, name: string, body: string) { putItem(thread, `ARTIFACT#${name}`, {body}); }
export function getArtifact(thread: string, name: string): string | undefined { return getItem(thread, `ARTIFACT#${name}`)?.body; }
export function appendEvent(thread: string, run: string, event: Item) { db().prepare('INSERT INTO events(thread, run, data) VALUES (?, ?, ?)').run(thread, run, JSON.stringify(event)); }
export function getEvents(thread: string, run: string): Item[] { return db().prepare('SELECT data FROM events WHERE thread=? AND run=? ORDER BY seq').all(thread, run).map(row=>JSON.parse(String(row.data))); }
export function createThread(userId: string) {
  const id = randomUUID(), now = new Date().toISOString();
  const item = {id,userId,runtimeSession:randomUUID(),status:'ready',messages:[],createdAt:now,updatedAt:now,runCount:0};
  transaction(()=>{putItem(id,'META',item);putItem(`USER#${userId}`,now+'#'+id,{id,createdAt:now});});
  return item;
}
export function beginRun(id: string, userId: string, content: string) {
  return transaction(()=>{
    const meta=getItem(id);
    if(!meta || meta.userId!==userId) throw new Error('NOT_FOUND');
    if(meta.status==='running' && meta.runDeadline>Date.now()) throw new Error('BUSY');
    if(meta.runCount>=30) throw new Error('LIMIT');
    const runId=randomUUID();
    const next={...meta,status:'running',activeRun:runId,runDeadline:Date.now()+300_000,cancelRequested:false,pendingApproval:null,messages:[...meta.messages,{role:'user',content}].slice(-39),updatedAt:new Date().toISOString(),runCount:meta.runCount+1};
    putItem(id,'META',next);return next;
  });
}
export function decideApproval(thread: string, userId: string, id: string, decision: string) {
  return transaction(()=>{
    const meta=getItem(thread),approval=getItem(thread,`APPROVAL#${id}`);
    if(!meta || meta.userId!==userId) throw new Error('NOT_FOUND');
    if(!['approved','denied'].includes(decision)) throw new Error('INVALID');
    if(!approval || approval.status!=='pending' || approval.expiresAt<=Date.now() || approval.runId!==meta.activeRun || meta.status!=='running' || meta.cancelRequested) throw new Error('EXPIRED');
    putItem(thread,`APPROVAL#${id}`,{...approval,status:decision,decidedBy:userId,decidedAt:Date.now()});
  });
}
