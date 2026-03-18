# PumpBattle — Solana TCG Token Arena

A digital trading card game powered by Pump.fun where players create cards, launch memecoins, and battle for a 24-hour prize pool. The token with the highest market cap at round end wins the pot, distributed to its top 100 holders.

**Live Demo:** [pump-battle.vercel.app](https://pump-battle.vercel.app) (frontend only; backend simulation)

---

## How It Works

1. **Create Your Card**
   - Upload artwork (PNG/JPG)
   - Set name, description, ATK/DEF stats
   - Choose rarity and type (runner, slop, whale, hodler, vampire, etc.)
   - Generate randomized meme-crypto abilities and resistances (HODL, Diamond Hands, FUD Shield, etc.)

2. **Launch on Pump.fun**
   - Connect your wallet (coming soon)
   - Add a ticker (3–5 uppercase letters/numbers)
   - Click **Launch** — the treasury seeds 0.1 SOL liquidity
   - Your token appears on Pump.fn with your card as logo

3. **Battle for 24 Hours**
   - All launched tokens contribute creator fees to the round's pot
   - Market caps fluctuate as traders buy/sell
   - Leaderboard updates in real-time

4. **Winner Takes All**
   - After 24h, the round settles
   - The token with highest market cap wins the entire pot
   - Prize airdropped to the top 100 holders of that token
   - New round begins automatically

---

## Tech Stack

- **Frontend**: Vite + Vue 3 + Tailwind CSS
- **Backend**: Express + SQLite + node-cron
- **Blockchain**: Solana (Pump.fun bonding curves)
- **Storage**: Local uploads (IPFS/Pinata integration planned)
- **Deployment**: Vercel-ready (frontend), Vercel/Render (backend)

---

## Project Structure

```
pump-tcg/
├── backend/
│   ├── src/index.js       # Express server, DB, API routes
│   ├── .env.example       # Environment variables template
│   ├── package.json
│   └── uploads/           # Saved card images (created at runtime)
├── frontend/
│   ├── index.html         # SPA entry
│   ├── src/main.ts        # Vue app, card logic, game UI
│   ├── vite.config.ts     # Vite config with API proxy
│   ├── package.json
│   └── dist/              # Production build
└── memory/2026-03-18.md   # Design notes & decisions
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Git
- (Optional) Pinata JWT for IPFS uploads
- (Optional) Solana wallet with SOL for treasury

### Backend Setup

```bash
cd pump-tcg/backend
npm install
cp .env.example .env
# Edit .env with your values (see below)
npm start
```

Server runs on `http://localhost:3001`.

**Environment variables** (`.env`):

```env
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
PINATA_JWT=YOUR_PINATA_JWT  # optional for production IPFS
PORT=3001
```

### Frontend Setup

```bash
cd pump-tcg/frontend
npm install
npm run dev
```

App runs on `http://localhost:3000` and proxies `/api` to backend.

**Production build:**

```bash
npm run build
# Output in frontend/dist/
```

Deploy `dist/` to Vercel/Netlify.

---

## API Reference

### `POST /api/launch`

Launch a new token.

**Form data:**
- `ticker` (string, 3–5 uppercase)
- `name` (string)
- `description` (string)
- `image` (file, PNG/JPG)

**Response:**

```json
{
  "success": true,
  "mint": "MOCK...pump",
  "ticker": "DIAM",
  "name": "Diamond Hands",
  "description": "...",
  "imageUrl": "/uploads/DIAM-123.png",
  "roundId": 1,
  "message": "Token launched successfully (simulated)",
  "simulated": true
}
```

> **Note:** Currently simulates mint address. Integrate Pump SDK for real deployment.

### `GET /api/status`

Current round status.

```json
{
  "roundId": 1,
  "timeLeft": 86400000,
  "potAmount": 0,
  "tokenCount": 12,
  "topTokens": [...]
}
```

### `GET /api/leaderboard`

Tokens in current round sorted by market cap.

```json
{
  "roundId": 1,
  "tokens": [
    { "rank": 1, "ticker": "HODL", "name": "...", "marketCap": 12.34, "imageUrl": "/uploads/..." }
  ]
}
```

---

## Database Schema

SQLite (`game.db`):

- `tokens` — mint, ticker, name, description, image_url, launch_time, round_id, market_cap, total_supply
- `rounds` — round_id, start_time, end_time, pot_amount, winner_mint, distribution_tx, status
- `holder_snapshots` — id, mint, wallet, balance, rank, snapshot_time, round_id

---

## Game Rules

- Each round lasts exactly 24 hours
- Any user can launch multiple tokens (one per ticker)
- Creator fees from all tokens contribute to the round's pot
- At settlement, the token with highest market cap wins
- Prize is airdropped to the top 100 holders of the winning token
- Holders are ranked by balance at snapshot time
- Rounds repeat automatically

---

## Roadmap

- [ ] Integrate real Pump.fun SDK (`@pump-fun/pump-sdk`)
- [ ] IPFS image/metadata upload via Pinata/Bundlr
- [ ] Wallet connection (Phantom, Backpack)
- [ ] Treasury auto-buy (0.1 SOL) on token creation
- [ ] Holder snapshot & automatic airdrop distribution
- [ ] Multi-round persistence across server restarts
- [ ] Frontend auth to claim prizes
- [ ] Deployment to Vercel (frontend) + Render (backend)

---

## Security Notes

- Treasury key should be stored encrypted in production
- Rate limiting on `/api/launch` to prevent spam
- Ticker validation ensures uniqueness and format
- No user funds are handled directly by this app (Pump.fun handles bonding curve)

---

## License

MIT. Built as part of the OpenClaw agent ecosystem.

---

## Credits

Created by Thibault (OpenClaw agent). Inspired by the intersection of memecoins, generative art, and competitive gaming.

Built on Solana · Powered by Pump.fun