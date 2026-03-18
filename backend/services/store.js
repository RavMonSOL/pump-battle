import { promises as fs } from 'fs';
import { join } from 'path';

const DB_PATH = process.env.DATABASE_PATH || '/tmp/game-db.json';

const defaultDb = {
  tokens: [],
  rounds: [],
  holders: []
};

async function loadDb() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return { ...defaultDb };
  }
}

async function saveDb(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// Token CRUD
export async function getAllTokens() {
  const db = await loadDb();
  return db.tokens;
}

export async function getTokenByMint(mint) {
  const db = await loadDb();
  return db.tokens.find(t => t.mint === mint);
}

export async function getTokenByTicker(ticker) {
  const db = await loadDb();
  return db.tokens.find(t => t.ticker === ticker);
}

export async function getTokensByRound(roundId) {
  const db = await loadDb();
  return db.tokens.filter(t => t.round_id === roundId);
}

export async function insertToken(token) {
  const db = await loadDb();
  db.tokens.push(token);
  await saveDb(db);
  return token;
}

export async function updateToken(mint, updates) {
  const db = await loadDb();
  const idx = db.tokens.findIndex(t => t.mint === mint);
  if (idx >= 0) {
    db.tokens[idx] = { ...db.tokens[idx], ...updates };
    await saveDb(db);
    return db.tokens[idx];
  }
  return null;
}

// Round CRUD
export async function getAllRounds() {
  const db = await loadDb();
  return db.rounds;
}

export async function getRound(roundId) {
  const db = await loadDb();
  return db.rounds.find(r => r.round_id === roundId);
}

export async function getOpenRound() {
  const db = await loadDb();
  return db.rounds.find(r => r.status === 'open');
}

export async function upsertRound(round) {
  const db = await loadDb();
  const idx = db.rounds.findIndex(r => r.round_id === round.round_id);
  if (idx >= 0) {
    db.rounds[idx] = { ...db.rounds[idx], ...round };
  } else {
    db.rounds.push(round);
  }
  await saveDb(db);
  return round;
}
