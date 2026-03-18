import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images statically
app.use('/uploads', express.static(join(__dirname, '..', 'uploads')));

// Database setup
const db = new Database(join(__dirname, '..', 'game.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    ticker TEXT UNIQUE,
    name TEXT,
    description TEXT,
    image_url TEXT,
    launch_time INTEGER,
    round_id INTEGER,
    market_cap REAL DEFAULT 0,
    total_supply INTEGER DEFAULT 0
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

  CREATE TABLE IF NOT EXISTS holder_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mint TEXT,
    wallet TEXT,
    balance REAL,
    rank INTEGER,
    snapshot_time INTEGER,
    round_id INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_round ON tokens(round_id);
  CREATE INDEX IF NOT EXISTS idx_holders_mint ON holder_snapshots(mint);
`);

// Ensure uploads directory exists
await fs.mkdir(join(__dirname, '..', 'uploads'), { recursive: true });

// Multer for image uploads (store in memory)
const upload = multer({ storage: multer.memoryStorage() });

// Helpers
function getCurrentRound() {
  const now = Date.now();
  const round = db.prepare('SELECT * FROM rounds WHERE status = "open" ORDER BY round_id DESC LIMIT 1').get();
  if (!round) {
    // Create new round (24h from now)
    const start = now;
    const end = start + 24 * 60 * 60 * 1000;
    const roundId = Math.floor(now / (24 * 60 * 60 * 1000));
    db.prepare('INSERT INTO rounds (round_id, start_time, end_time) VALUES (?, ?, ?)').run(roundId, start, end);
    return db.prepare('SELECT * FROM rounds WHERE round_id = ?').get(roundId);
  }
  return round;
}

function roundEndingScheduler() {
  // Every minute check for rounds that have ended
  cron.schedule('*/5 * * * *', () => {
    const now = Date.now();
    const openRounds = db.prepare('SELECT * FROM rounds WHERE status = "open" AND end_time <= ?').all(now);
    for (const round of openRounds) {
      settleRound(round);
    }
  });
}

async function settleRound(round) {
  console.log(`Settling round ${round.round_id}`);
  // Find all tokens in this round
  const tokens = db.prepare('SELECT * FROM tokens WHERE round_id = ?').all(round.round_id);
  if (tokens.length === 0) {
    db.prepare('UPDATE rounds SET status = "closed" WHERE round_id = ?').run(round.round_id);
    return;
  }

  // Determine winner by market cap
  let winner = tokens[0];
  for (const token of tokens) {
    if (token.market_cap > winner.market_cap) {
      winner = token;
    }
  }

  // Update round
  db.prepare('UPDATE rounds SET status = "closed", winner_mint = ? WHERE round_id = ?').run(winner.mint, round.round_id);

  // Distribute pot to top 100 holders of winner token (to be implemented after snapshot)
  console.log(`Winner: ${winner.ticker} (${winner.mint})`);
}

// API Routes

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Launch token
app.post('/api/launch', upload.single('image'), async (req, res) => {
  try {
    const { ticker, name, description } = req.body;
    const imageFile = req.file;

    if (!ticker || !name || !description || !imageFile) {
      return res.status(400).json({ error: 'Missing required fields: ticker, name, description, image' });
    }

    // Validate ticker (3-5 uppercase chars)
    if (!/^[A-Z0-9]{3,5}$/.test(ticker)) {
      return res.status(400).json({ error: 'Ticker must be 3-5 uppercase letters or numbers' });
    }

    // Check if ticker already exists
    const existing = db.prepare('SELECT * FROM tokens WHERE ticker = ?').get(ticker);
    if (existing) {
      return res.status(409).json({ error: 'Ticker already in use' });
    }

    // Save image locally (in production, upload to IPFS)
    const imageFilename = `${ticker}-${Date.now()}.png`;
    const imagePath = join(__dirname, '..', 'uploads', imageFilename);
    await fs.writeFile(imagePath, imageFile.buffer);
    const imageUrl = `/uploads/${imageFilename}`;

    // In a real deployment, we would:
    // 1. Upload image to Pinata, get CID
    // 2. Create metadata JSON and upload to Pinata (or Bundlr)
    // 3. Use @pump-fun/pump-sdk to create token with metadata URI
    // 4. Buy initial 0.1 SOL worth via bonding curve
    // For now, simulate a mint address
    const mockMint = 'MOCK' + Math.random().toString(36).substring(2, 10).toUpperCase() + 'pump';

    // Insert token into DB
    const now = Date.now();
    const round = getCurrentRound();
    db.prepare(`
      INSERT INTO tokens (mint, ticker, name, description, image_url, launch_time, round_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mockMint, ticker, name, description, imageUrl, now, round.round_id);

    console.log(`Token ${ticker} launched for round ${round.round_id} (simulated)`);

    return res.json({
      success: true,
      mint: mockMint,
      ticker,
      name,
      description,
      imageUrl,
      roundId: round.round_id,
      message: 'Token launched successfully (simulated)',
      simulated: true
    });
  } catch (error) {
    console.error('Launch error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get game status
app.get('/api/status', (req, res) => {
  const round = getCurrentRound();
  const tokens = db.prepare('SELECT * FROM tokens WHERE round_id = ? ORDER BY market_cap DESC').all(round.round_id);
  const timeLeft = round.end_time - Date.now();
  res.json({
    roundId: round.round_id,
    timeLeft,
    potAmount: round.pot_amount,
    tokenCount: tokens.length,
    topTokens: tokens.slice(0, 10).map(t => ({
      ticker: t.ticker,
      name: t.name,
      marketCap: t.market_cap,
      imageUrl: t.image_url
    }))
  });
});

// Get leaderboard for current round
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

// Start the round ending scheduler
roundEndingScheduler();

app.listen(PORT, () => {
  console.log(`Pump TCG Backend running on port ${PORT}`);
  if (!process.env.PINATA_JWT) {
    console.warn('PINATA_JWT not set - IPFS uploads will fail');
  }
});