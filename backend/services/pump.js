import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Pump, createPump, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';

let pumpInstance = null;

export function getPumpConnection() {
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  return connection;
}

export async function getPump() {
  if (pumpInstance) return pumpInstance;
  if (!process.env.TREASURY_PRIVATE_KEY) {
    throw new Error('TREASURY_PRIVATE_KEY not configured — set env var to use real Pump.fun');
  }
  const connection = getPumpConnection();
  let keypair;
  const treasuryKeyStr = process.env.TREASURY_PRIVATE_KEY;
  if (treasuryKeyStr.startsWith('[')) {
    const secret = JSON.parse(treasuryKeyStr);
    keypair = Keypair.fromSecretKey(new Uint8Array(secret));
  } else {
    keypair = Keypair.fromBase58(treasuryKeyStr);
  }
  pumpInstance = await createPump(connection, keypair);
  return pumpInstance;
}

export async function createTokenOnPump({ name, symbol, description, imageUri, initialBuyAmountSOL = 0.1 }) {
  const useSimulation = !process.env.TREASURY_PRIVATE_KEY || !process.env.PINATA_API_KEY;
  if (useSimulation) {
    console.log('Using simulation mode for token launch (set TREASURY_PRIVATE_KEY and PINATA_API_KEY for real)');
    const mockMint = 'MOCK' + Math.random().toString(36).substring(2, 10).toUpperCase() + 'pump';
    return {
      mintAddress: mockMint,
      bondCurve: 'SimBondCurve' + Math.random().toString(36).substring(2),
      metadata: { name, symbol, description, uri: imageUri }
    };
  }

  const pump = await getPump();
  const { mint, bondCurve, metadata } = await pump.createToken({
    name,
    symbol,
    description,
    uri: imageUri,
  });
  if (initialBuyAmountSOL > 0) {
    const buyAmount = initialBuyAmountSOL * LAMPORTS_PER_SOL;
    await pump.buy(mint, bondCurve, buyAmount);
  }
  return {
    mintAddress: mint.toBase58(),
    bondCurve: bondCurve.toBase58(),
    metadata: {
      name: metadata.name,
      symbol: metadata.symbol,
      description: metadata.description,
      uri: metadata.uri,
    }
  };
}

export async function getTokenMarketData(mintAddress) {
  const useSimulation = !process.env.TREASURY_PRIVATE_KEY;
  if (useSimulation) {
    // Simulate some market data for demo
    return {
      marketCap: Math.random() * 100,
      supply: Math.floor(Math.random() * 1000000),
      reserve: Math.floor(Math.random() * 100),
      price: (Math.random() * 0.01).toFixed(10)
    };
  }
  const pump = await getPump();
  const mint = new PublicKey(mintAddress);
  const [marketState, bondingCurve] = await pump.fetchMarketState(mint);
  if (!marketState) return null;
  return {
    marketCap: marketState.marketCap / LAMPORTS_PER_SOL,
    supply: marketState.virtualSupply,
    reserve: marketState.virtualReserves,
    price: bondingCurve.price,
  };
}
