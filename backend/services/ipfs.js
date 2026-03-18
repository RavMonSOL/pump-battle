import { PinataSDK } from 'pinata';
import { promises as fs } from 'fs';
import { join } from 'path';

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
  console.warn('PINATA_API_KEY or PINATA_SECRET_KEY not set; IPFS uploads disabled');
}

export async function uploadToIPFS(fileBuffer, filename) {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error('Pinata credentials not configured');
  }
  const pinata = new PinataSDK({ pinataApiKey: PINATA_API_KEY, pinataSecretAccessKey: PINATA_SECRET_KEY });
  const result = await pinata.upload.file(fileBuffer, { name: filename });
  return result.data.IpfsHash; // CID
}

export async function uploadJSONToIPFS(json) {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error('Pinata credentials not configured');
  }
  const pinata = new PinataSDK({ pinataApiKey: PINATA_API_KEY, pinataSecretAccessKey: PINATA_SECRET_KEY });
  const result = await pinata.upload.json(json);
  return result.data.IpfsHash;
}

export function buildMetadataURI(cid, name, description, ticker) {
  // Pump.fun expects metadata to be at: https://arweave.net/<cid>
  // But we can also use ipfs://<cid> if they support it
  return `ipfs://${cid}`;
}
