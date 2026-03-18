import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { uploadToIPFS } from '../services/ipfs.js';
import { createTokenOnPump, getTokenMarketData } from '../services/pump.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure uploads directory exists (use /tmp for Vercel serverless)
const uploadsDir = process.env.UPLOADS_DIR || join('/tmp', 'pump-tcg-uploads');
await fs.mkdir(uploadsDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// Database in /tmp (Vercel persists across requests, not restarts)
const dbPath = process.env.DATABASE_PATH || join('/tmp', 'game.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    ticker TEXT UNIQUE,
    name TEXT,
    description TEXT,
    image_url TEXT,
    metadata_uri TEXT,
    launch_time INTEGER,
    round_id INTEGER,
    market_cap REAL DEFAULT 0,
    total_supply INTEGER DEFAULT 0,
    bond_curve TEXT,
    status TEXT DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS rounds (
    round_id INTEGER PRIMARY KEY,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    pot_amount REAL DEFAULT 0,
    winner_mint TEXT,
    distribution_tx TEXT,
    status TEXT DEFAULT 'open'
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_round ON tokens(round_id);
`);

function getCurrentRound() {
  const now = Date.now();
  const round = db.prepare('SELECT * FROM rounds WHERE status = "open" ORDER BY round_id DESC LIMIT 1').get();
  if (!round) {
    const roundId = Math.floor(now / (24 * 60 * 60 * 1000));
    const start = now;
    const end = start + 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO rounds (round_id, start_time, end_time) VALUES (?, ?, ?)').run(roundId, start, end);
    return db.prepare('SELECT * FROM rounds WHERE round_id = ?').get(roundId);
  }
  return round;
}

function roundEndingScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    const now = Date.now();
    const openRounds = db.prepare('SELECT * FROM rounds WHERE status = "open" AND end_time <= ?').all(now);
    for (const round of openRounds) {
      await settleRound(round);
    }
  });
}

async function settleRound(round) {
  console.log(`Settling round ${round.round_id}`);
  const tokens = db.prepare('SELECT * FROM tokens WHERE round_id = ?').all(round.round_id);
  if (tokens.length === 0) {
    db.prepare('UPDATE rounds SET status = "closed" WHERE round_id = ?').run(round.round_id);
    return;
  }
  // Refresh market caps
  let winner = tokens[0];
  for (const token of tokens) {
    if (token.status === 'active') {
      try {
        const market = await getTokenMarketData(token.mint);
        if (market && market.marketCap > 0) {
          db.prepare('UPDATE tokens SET market_cap = ? WHERE mint = ?').run(market.marketCap, token.mint);
          if (market.marketCap > (winner.market_cap || 0)) winner = token;
        }
      } catch (e) {
        console.error(`Failed to fetch market for ${token.ticker}:`, e);
      }
    } else if (token.market_cap > (winner.market_cap || 0)) {
      winner = token;
    }
  }
  db.prepare('UPDATE rounds SET status = "closed", winner_mint = ? WHERE round_id = ?').run(winner.mint, round.round_id);
  console.log(`Winner: ${winner.ticker} (${winner.mint})`);
  // TODO: trigger airdrop distribution off-chain or via pump SDK
}

const upload = multer({ storage: multer.memoryStorage() });

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

app.post('/api/launch', upload.single('image'), async (req, res) => {
  try {
    const { ticker, name, description } = req.body;
    const imageFile = req.file;
    if (!ticker || !name || !description || !imageFile) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!/^[A-Z0-9]{3,5}$/.test(ticker)) {
      return res.status(400).json({ error: 'Invalid ticker format' });
    }
    const existing = db.prepare('SELECT * FROM tokens WHERE ticker = ?').get(ticker);
    if (existing) return res.status(409).json({ error: 'Ticker already in use' });

    // Upload image to IPFS
    let imageCid, metadataCid, imageUrl;
    try {
      imageCid = await uploadToIPFS(imageFile.buffer, `${ticker}-${Date.now()}.png`);
      imageUrl = `ipfs://${imageCid}`;
      const metadata = {
        name,
        symbol: ticker,
        description,
        image: `https://gateway.pinata.cloud/ipfs/${imageCid}`,
        external_url: '',
        attributes: []
      };
      metadataCid = await uploadJSONToIPFS(metadata);
    } catch (ipfsError) {
      console.error('IPFS upload failed, using local fallback:', ipfsError);
      const fallbackName = `${ticker}-${Date.now()}.png`;
      const fallbackPath = join(uploadsDir, fallbackName);
      await fs.writeFile(fallbackPath, imageFile.buffer);
      imageUrl = `/uploads/${fallbackName}`;
    }

    // Create token on Pump.fun
    const pumpResult = await createTokenOnPump({
      name,
      symbol: ticker,
      description,
      imageUri: imageUrl,
      initialBuyAmountSOL: 0.1
    });

    const now = Date.now();
    const round = getCurrentRound();
    db.prepare(`
      INSERT INTO tokens (mint, ticker, name, description, image_url, metadata_uri, launch_time, round_id, bond_curve, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(pumpResult.mintAddress, ticker, name, description, imageUrl, metadataCid || null, now, round.round_id, pumpResult.bondCurve);

    console.log(`Token ${ticker} launched on Pump.fun: ${pumpResult.mintAddress}`);
    res.json({
      success: true,
      mint: pumpResult.mintAddress,
      ticker,
      name,
      description,
      imageUrl,
      roundId: round.round_id,
      message: 'Token launched and seeded with 0.1 SOL'
    });
  } catch (error) {
    console.error('Launch error:', error);
    res.status(500).json({ error: 'Launch failed', details: error.message });
  }
});

app.get('/api/status', (req, res) => {
  const round = getCurrentRound();
  const tokens = db.prepare('SELECT * FROM tokens WHERE round_id = ? ORDER BY market_cap DESC LIMIT 10').all(round.round_id);
  res.json({
    roundId: round.round_id,
    timeLeft: round.end_time - Date.now(),
    potAmount: round.pot_amount,
    tokenCount: db.prepare('SELECT COUNT(*) as c FROM tokens WHERE round_id = ?').get(round.round_id).c,
    topTokens: tokens.map(t => ({ ticker: t.ticker, name: t.name, marketCap: t.market_cap, imageUrl: t.image_url }))
  });
});

app.get('/api/leaderboard', (req, res) => {
  const round = getCurrentRound();
  const tokens = db.prepare('SELECT * FROM tokens WHERE round_id = ? ORDER BY market_cap DESC').all(round.round_id);
  res.json({
    roundId: round.round_id,
    tokens: tokens.map((t, idx) => ({
      rank: idx + 1,
      ticker: t.ticker,
      name: t.name,
      marketCap: t.market_cap,
      imageUrl: t.image_url
    }))
  });
});

app.get('/api/token/:mint', async (req, res) => {
  const { mint } = req.params;
  const token = db.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  try {
    const market = await getTokenMarketData(mint);
    res.json({ ...token, market });
  } catch (e) {
    res.json(token);
  }
});

roundEndingScheduler();

export default app;
