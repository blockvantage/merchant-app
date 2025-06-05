import dotenv from 'dotenv';
dotenv.config();

export const AID = 'F2222222222222'; // must match the AID in your Android app
export const GET = Buffer.from('80CA000000', 'hex'); // "GET_STRING" APDU
export const PAYMENT = Buffer.from('80CF000000', 'hex'); // "PAYMENT" APDU

// Recipient address for payments (replace with your actual receiving address)
export const RECIPIENT_ADDRESS = '0xaD66946538E4B03B1910DadE713feBb8B59Cff60';

// Processing configuration
export const COOLDOWN_DURATION = 30000; // 30 seconds cooldown after processing
export const TARGET_USD = 10; // $10 target payment

// API configuration
export const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'YOUR_API_KEY';
export const ALCHEMY_BASE_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// CoinGecko API URLs
export const COINGECKO_TOKEN_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/token_price/ethereum';
export const COINGECKO_ETH_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'; 