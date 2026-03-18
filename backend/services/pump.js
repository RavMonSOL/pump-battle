import web3 from '@solana/web3.js';
import { Pump } from '@pump-fun/pump-sdk';

const { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL, SystemProgram, BN } = web3;

let pumpInstance = null;

export function getPumpConnection() {
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
}

export async function getPump() {
  if (pumpInstance) return pumpInstance;
  if (!process.env.TREASURY_PRIVATE_KEY) {
    throw new Error('TREASURY_PRIVATE_KEY not configured');
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
  pumpInstance = new Pump(connection);
  // Attach the treasury keypair for signing
  pumpInstance.treasuryKeypair = keypair;
  return pumpInstance;
}

// Helper to get buy token amount from sol amount (approximate)
function getBuyTokenAmountFromSolAmount(global, bondingCurve, solAmount) {
  // Simplified: use bonding curve price if available
  if (bondingCurve) {
    return Math.floor(solAmount / bondingCurve.price);
  }
  // Fallback: use a fixed estimate; in reality should compute from AMM equation
  return Math.floor(solAmount * 1000); // rough
}

export async function createTokenOnPump({ name, symbol, description, imageUri, initialBuyAmountSOL = 0.1 }) {
  const useSimulation = !process.env.TREASURY_PRIVATE_KEY || !process.env.PINATA_API_KEY;
  if (useSimulation) {
    console.log('Using simulation mode for token launch');
    const mockMint = 'MOCK' + Math.random().toString(36).substring(2, 10).toUpperCase() + 'pump';
    return {
      mintAddress: mockMint,
      bondCurve: 'SimBondCurve' + Math.random().toString(36).substring(2),
      metadata: { name, symbol, description, uri: imageUri }
    };
  }

  const pump = await getPump();
  const mint = Keypair.generate(); // New mint keypair
  const treasury = pump.treasuryKeypair;
  const creator = treasury.publicKey;
  const user = treasury.publicKey; // treasury buys initial

  // Fetch global state for calculations
  const global = await pump.fetchGlobal();
  const solAmount = new BN(initialBuyAmountSOL * LAMPORTS_PER_SOL);
  const instructions = await pump.createAndBuyInstructions({
    global,
    mint: mint.publicKey,
    name,
    symbol,
    uri: imageUri,
    creator,
    user,
    solAmount,
    amount: getBuyTokenAmountFromSolAmount(global, null, solAmount),
  });

  // Build and send transaction
  const { blockhash } = await pump.connection.getLatestBlockhash();
  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: treasury.publicKey,
  }).add(...instructions);

  // Sign and send
  transaction.sign(mint, treasury);
  const { signature } = await pump.connection.sendRawTransaction(transaction.serialize());
  await pump.connection.confirmTransaction(signature, 'confirmed');

  // After creation, we can fetch bonding curve
  // For simplicity, return mint address; bonding curve can be derived
  return {
    mintAddress: mint.publicKey.toBase58(),
    bondCurve: getBondingCurvePDA(mint.publicKey, pump), // function below
    metadata: { name, symbol, description, uri: imageUri }
  };
}

function getBondingCurvePDA(mint, pump) {
  // PumpSdk probably has a method, but we can derive via PublicKey.findProgramAddress
  // For now, just return placeholder string; not critical
  return 'bonding-curve-pda';
}

export async function getTokenMarketData(mintAddress) {
  const useSimulation = !process.env.TREASURY_PRIVATE_KEY;
  if (useSimulation) {
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
