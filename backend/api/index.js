import express from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cron from 'node-cron';
import { uploadToIPFS } from '../services/ipfs.js';
import { createTokenOnPump, getTokenMarketData } from '../services/pump.js';
import * as store from '../services/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Manual CORS — set headers on EVERY request, before anything else
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

const uploadsDir = process.env.UPLOADS_DIR || join('/tmp', 'pump-tcg-uploads');
await fs.mkdir(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const upload = multer({ storage: multer.memoryStorage() });

async function getCurrentRound() {
  let round = await store.getOpenRound();
  if (!round) {
    const now = Date.now();
    const roundId = Math.floor(now / (24 * 60 * 60 * 1000));
    round = { round_id: roundId, start_time: now, end_time: now + 24*60*60*1000, pot_amount: 0, status: 'open' };
    await store.upsertRound(round);
  }
  return round;
}

async function roundEndingScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    const now = Date.now();
    const openRounds = (await store.getAllRounds()).filter(r => r.status === 'open' && r.end_time <= now);
    for (const round of openRounds) await settleRound(round);
  });
}

async function settleRound(round) {
  console.log(`Settling round ${round.round_id}`);
  const tokens = await store.getTokensByRound(round.round_id);
  if (tokens.length === 0) {
    await store.upsertRound({ ...round, status: 'closed' });
    return;
  }
  let winner = tokens[0];
  for (const token of tokens) {
    if (token.status === 'active') {
      try {
        const market = await getTokenMarketData(token.mint);
        if (market && market.marketCap > 0) {
          await store.updateToken(token.mint, { market_cap: market.marketCap });
          if (market.marketCap > (winner.market_cap || 0)) winner = token;
        }
      } catch (e) {
        console.error(`Market fetch error for ${token.ticker}:`, e);
      }
    } else if ((token.market_cap || 0) > (winner.market_cap || 0)) {
      winner = token;
    }
  }
  await store.upsertRound({ ...round, status: 'closed', winner_mint: winner.mint });
  console.log(`Winner: ${winner.ticker} (${winner.mint})`);
}

// Core routes
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

app.post('/api/launch', upload.single('image'), async (req, res) => {
  try {
    const { ticker, name, description } = req.body;
    const imageFile = req.file;
    if (!ticker || !name || !description || !imageFile) return res.status(400).json({ error: 'Missing required fields' });
    if (!/^[A-Z0-9]{3,5}$/.test(ticker)) return res.status(400).json({ error: 'Invalid ticker format' });
    const existing = await store.getTokenByTicker(ticker);
    if (existing) return res.status(409).json({ error: 'Ticker already in use' });

    let imageCid, metadataCid, imageUrl;
    try {
      imageCid = await uploadToIPFS(imageFile.buffer, `${ticker}-${Date.now()}.png`);
      imageUrl = `ipfs://${imageCid}`;
      const metadata = { name, symbol: ticker, description, image: `https://gateway.pinata.cloud/ipfs/${imageCid}`, external_url: '', attributes: [] };
      metadataCid = await uploadJSONToIPFS(metadata);
    } catch (ipfsError) {
      console.error('IPFS upload failed, using local fallback:', ipfsError);
      const fallbackName = `${ticker}-${Date.now()}.png`;
      const fallbackPath = join(uploadsDir, fallbackName);
      await fs.writeFile(fallbackPath, imageFile.buffer);
      imageUrl = `/uploads/${fallbackName}`;
    }

    const pumpResult = await createTokenOnPump({ name, symbol: ticker, description, imageUri: imageUrl, initialBuyAmountSOL: 0.1 });
    const now = Date.now();
    const round = await getCurrentRound();
    await store.insertToken({
      mint: pumpResult.mintAddress, ticker, name, description, image_url: imageUrl, metadata_uri: metadataCid || null,
      launch_time: now, round_id: round.round_id, bond_curve: pumpResult.bondCurve, status: 'active', market_cap: 0, total_supply: 0
    });

    res.json({ success: true, mint: pumpResult.mintAddress, ticker, name, description, imageUrl, roundId: round.round_id, message: 'Token launched and seeded with 0.1 SOL' });
  } catch (error) {
    console.error('Launch error:', error);
    res.status(500).json({ error: 'Launch failed', details: error.message });
  }
});

app.get('/api/status', async (req, res) => {
  const round = await getCurrentRound();
  const tokens = (await store.getTokensByRound(round.round_id)).sort((a,b) => (b.market_cap||0) - (a.market_cap||0)).slice(0,10);
  res.json({
    roundId: round.round_id,
    timeLeft: round.end_time - Date.now(),
    potAmount: round.pot_amount,
    tokenCount: (await store.getTokensByRound(round.round_id)).length,
    topTokens: tokens.map(t => ({ ticker: t.ticker, name: t.name, marketCap: t.market_cap || 0, imageUrl: t.image_url }))
  });
});

app.get('/api/leaderboard', async (req, res) => {
  const round = await getCurrentRound();
  const tokens = (await store.getTokensByRound(round.round_id)).sort((a,b) => (b.market_cap||0) - (a.market_cap||0));
  res.json({
    roundId: round.round_id,
    tokens: tokens.map((t, idx) => ({ rank: idx+1, ticker: t.ticker, name: t.name, marketCap: t.market_cap || 0, imageUrl: t.image_url }))
  });
});

app.get('/api/token/:mint', async (req, res) => {
  const { mint } = req.params;
  const token = await store.getTokenByMint(mint);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  try {
    const market = await getTokenMarketData(mint);
    res.json({ ...token, market });
  } catch (e) {
    res.json(token);
  }
});

// 404 fallback (CORS already set above)
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

roundEndingScheduler();

export default app;
