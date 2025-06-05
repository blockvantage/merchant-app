import { NFC, Reader } from 'nfc-pcsc';
import dotenv from 'dotenv';
dotenv.config();

// Define a basic interface for the card object based on expected properties
interface CardData {
  type?: string; // e.g., 'TAG_ISO_14443_4'
  standard?: string; // e.g., 'TAG_ISO_14443_4'
  uid?: string;
  data?: Buffer; // Response from SELECT AID if autoProcessing is on
  atr?: Buffer;
}

// Interface for token data with price information
interface TokenWithPrice {
  address: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  priceUSD: number;
  valueUSD: number;
}

const AID = 'F2222222222222';                 // must match the AID in your Android app
const GET = Buffer.from('80CA000000', 'hex'); // "GET_STRING" APDU
const PAYMENT = Buffer.from('80CF000000', 'hex'); // "PAYMENT" APDU

// Recipient address for payments (replace with your actual receiving address)
const RECIPIENT_ADDRESS = '0x109F7f0bFE98E4d1352916056FDcd90b9547ba00'; // Replace with your wallet address

// Track addresses currently being processed to prevent duplicates
const processingAddresses = new Set<string>();
const addressCooldowns = new Map<string, number>();
const COOLDOWN_DURATION = 30000; // 30 seconds cooldown after processing

// Function to check if address can be processed
function canProcessAddress(address: string): boolean {
  const normalizedAddress = address.toLowerCase();
  
  // Check if already being processed
  if (processingAddresses.has(normalizedAddress)) {
    console.log(`⏳ Address ${address} is already being processed, please wait...`);
    return false;
  }
  
  // Check cooldown
  const lastProcessed = addressCooldowns.get(normalizedAddress);
  if (lastProcessed && Date.now() - lastProcessed < COOLDOWN_DURATION) {
    const remainingCooldown = Math.ceil((COOLDOWN_DURATION - (Date.now() - lastProcessed)) / 1000);
    console.log(`🕐 Address ${address} is in cooldown, please wait ${remainingCooldown} seconds before trying again`);
    return false;
  }
  
  return true;
}

// Function to mark address as being processed
function startProcessing(address: string): void {
  const normalizedAddress = address.toLowerCase();
  processingAddresses.add(normalizedAddress);
  console.log(`🔄 Starting to process address: ${address}`);
}

// Function to mark address processing as complete
function finishProcessing(address: string): void {
  const normalizedAddress = address.toLowerCase();
  processingAddresses.delete(normalizedAddress);
  addressCooldowns.set(normalizedAddress, Date.now());
  console.log(`✅ Finished processing address: ${address}`);
  console.log(`📱 Ready for next tap (this address has a ${COOLDOWN_DURATION/1000}s cooldown)\n`);
}

// Function to check if a string is a valid Ethereum address (40 hex characters)
function isEthereumAddress(str: string): boolean {
  // Remove any whitespace and convert to lowercase
  const cleaned = str.trim().toLowerCase();
  
  // Check if it's exactly 40 hex characters (optionally with 0x prefix)
  const hexPattern = /^(0x)?[0-9a-f]{40}$/;
  return hexPattern.test(cleaned);
}

// Function to normalize Ethereum address (ensure it starts with 0x)
function normalizeEthereumAddress(address: string): string {
  const cleaned = address.trim().toLowerCase();
  return cleaned.startsWith('0x') ? cleaned : `0x${cleaned}`;
}

// Function to get token prices from CoinGecko
async function getTokenPrices(tokenAddresses: string[]): Promise<{[address: string]: number}> {
  try {
    if (tokenAddresses.length === 0) return {};
    
    // CoinGecko API for token prices
    const addressList = tokenAddresses.join(',');
    const url = `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${addressList}&vs_currencies=usd`;
    
    const response = await fetch(url);
    if (!response.ok) return {};
    
    const priceData = await response.json() as any;
    
    const prices: {[address: string]: number} = {};
    for (const [address, data] of Object.entries(priceData)) {
      if (data && typeof data === 'object' && 'usd' in data) {
        prices[address.toLowerCase()] = (data as any).usd;
      }
    }
    
    return prices;
  } catch (error) {
    console.log('Could not fetch token prices from CoinGecko');
    return {};
  }
}

// Function to get ETH price
async function getEthPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (!response.ok) return 0;
    
    const data = await response.json() as any;
    return data.ethereum?.usd || 0;
  } catch (error) {
    console.log('Could not fetch ETH price');
    return 0;
  }
}

// Function to send payment request via NFC
async function sendPaymentRequest(reader: Reader, amountString: string, tokenAddress: string, decimals: number = 18): Promise<void> {
  try {
    // Convert amount to appropriate units for EIP-681
    const amount = parseFloat(amountString);
    const amountInSmallestUnits = Math.floor(amount * Math.pow(10, decimals));
    
    let eip681Uri: string;
    
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      // ETH payment request
      eip681Uri = `ethereum:${RECIPIENT_ADDRESS}?value=${amountInSmallestUnits}`;
    } else {
      // ERC-20 token payment request
      eip681Uri = `ethereum:${tokenAddress}/transfer?address=${RECIPIENT_ADDRESS}&uint256=${amountInSmallestUnits}`;
    }
    
    console.log(`\n💳 Sending EIP-681 payment request: ${eip681Uri}`);
    
    // Convert the EIP-681 URI to buffer
    const requestBuffer = Buffer.from(eip681Uri, 'utf8');
    
    // Create the complete APDU: PAYMENT command + data
    const completeApdu = Buffer.concat([
      PAYMENT, // Command (80CF0000)
      requestBuffer // The actual payment request data
    ]);
    
    console.log(`📡 Sending APDU: ${completeApdu}`);
    
    // Send the complete APDU with the payment request data
    // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
    const response = await reader.transmit(completeApdu, Math.max(256, requestBuffer.length + 10), {});
    const sw = response.readUInt16BE(response.length - 2);
    
    if (sw === 0x9000) {
      console.log('✅ Payment request sent successfully!');
      const phoneResponse = response.slice(0, -2).toString();
      if (phoneResponse) {
        console.log(`📱 Phone response: ${phoneResponse}`);
      }
    } else {
      console.log(`❌ Payment request failed with status: ${sw.toString(16)}`);
    }
  } catch (error) {
    console.error('Error sending payment request:', error);
  }
}

// Function to fetch balances from Alchemy API
async function fetchAlchemyBalances(address: string, reader: Reader): Promise<void> {
  try {
    console.log(`Fetching balances for Ethereum address: ${address}`);
    
    // You'll need to replace YOUR_API_KEY with your actual Alchemy API key
    // Get one free at: https://dashboard.alchemy.com/
    const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'YOUR_API_KEY';
    const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
    
    // Get ETH balance
    const ethBalanceResponse = await fetch(alchemyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [address, 'latest']
      })
    });

    // Get all token balances (this gets the top ~100 tokens automatically)
    const tokenBalancesResponse = await fetch(alchemyUrl, {
      method: 'POST', 
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'alchemy_getTokenBalances',
        params: [address]
      })
    });

    if (!ethBalanceResponse.ok || !tokenBalancesResponse.ok) {
      throw new Error(`HTTP error! ETH: ${ethBalanceResponse.status}, Tokens: ${tokenBalancesResponse.status}`);
    }

    const ethData = await ethBalanceResponse.json() as any;
    const tokenData = await tokenBalancesResponse.json() as any;

    console.log('\n=== WALLET BALANCES ===');

    let ethPrice = 0;
    let tokensWithPrices: TokenWithPrice[] = [];

    // Get ETH price and display ETH balance
    if (ethData.result) {
      const ethBalance = parseInt(ethData.result, 16) / Math.pow(10, 18);
      if (ethBalance > 0) {
        ethPrice = await getEthPrice();
        const ethValueUSD = ethBalance * ethPrice;
        console.log(`ETH: ${ethBalance.toFixed(4)} ($${ethValueUSD.toFixed(2)})`);
        
        // Add ETH as a "token" option for payment
        if (ethBalance > 0 && ethPrice > 0) {
          tokensWithPrices.push({
            address: '0x0000000000000000000000000000000000000000', // ETH address
            symbol: 'ETH',
            name: 'Ethereum',
            balance: ethBalance,
            decimals: 18,
            priceUSD: ethPrice,
            valueUSD: ethValueUSD
          });
        }
      }
    }

    // Display token balances with USD values
    if (tokenData.result && tokenData.result.tokenBalances) {
      console.log('\n=== TOKEN BALANCES ===');
      
      const nonZeroBalances = tokenData.result.tokenBalances.filter((token: any) => 
        token.tokenBalance && token.tokenBalance !== '0x0'
      );

      if (nonZeroBalances.length > 0) {
        // Get token metadata for the tokens with balances
        const tokenAddresses = nonZeroBalances.map((token: any) => token.contractAddress);
        
        const metadataResponse = await fetch(alchemyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'alchemy_getTokenMetadata',
            params: tokenAddresses
          })
        });

        // Get token prices from CoinGecko
        const tokenPrices = await getTokenPrices(tokenAddresses);

        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json() as any;
          
          nonZeroBalances.forEach((token: any, index: number) => {
            try {
              const balance = parseInt(token.tokenBalance, 16);
              const metadata = metadataData.result?.[index];
              const decimals = metadata?.decimals || 18;
              const symbol = metadata?.symbol || 'UNKNOWN';
              const name = metadata?.name || 'Unknown Token';
              const contractAddress = token.contractAddress.toLowerCase();
              
              const formattedBalance = balance / Math.pow(10, decimals);
              const priceUSD = tokenPrices[contractAddress] || 0;
              const valueUSD = formattedBalance * priceUSD;
              
              if (formattedBalance > 0) {
                if (priceUSD > 0) {
                  console.log(`${symbol}: ${formattedBalance.toFixed(4)} ($${valueUSD.toFixed(2)}) - ${name}`);
                  
                  // Add to tokens with prices for payment calculation
                  tokensWithPrices.push({
                    address: token.contractAddress,
                    symbol,
                    name,
                    balance: formattedBalance,
                    decimals,
                    priceUSD,
                    valueUSD
                  });
                } else {
                  console.log(`${symbol}: ${formattedBalance.toFixed(4)} (Price unknown) - ${name}`);
                }
              }
            } catch (e) {
              console.log(`Token ${token.contractAddress}: Raw balance ${token.tokenBalance}`);
            }
          });
        }
      } else {
        console.log('No token balances found');
      }
    }

    // Calculate $10 payment options and send payment request
    await calculateAndSendPayment(tokensWithPrices, reader);

  } catch (error) {
    console.error('Error fetching Alchemy data:', error);
    console.log('\n📝 To use this feature:');
    console.log('1. Get a free API key at: https://dashboard.alchemy.com/');
    console.log('2. Set environment variable: export ALCHEMY_API_KEY=your_key_here');
    console.log('3. Or replace YOUR_API_KEY in the code with your actual key');
  }
}

// Function to calculate $10 worth of tokens and send payment request
async function calculateAndSendPayment(tokensWithPrices: TokenWithPrice[], reader: Reader): Promise<void> {
  const TARGET_USD = 10; // $10 target payment

  // Filter tokens that have sufficient balance for $10 payment
  const viableTokens = tokensWithPrices.filter(token => 
    token.priceUSD > 0 && token.valueUSD >= TARGET_USD
  );

  if (viableTokens.length === 0) {
    console.log(`\n❌ No tokens found with sufficient balance for $${TARGET_USD} payment`);
    return;
  }

  console.log(`\n💰 PAYMENT OPTIONS ($${TARGET_USD}):`);
  
  viableTokens.forEach((token, index) => {
    const requiredAmount = TARGET_USD / token.priceUSD;
    console.log(`${index + 1}. ${requiredAmount.toFixed(6)} ${token.symbol} (${token.name})`);
  });

  // For demo, automatically select the first viable token
  // In a real app, you might want user selection or some logic to pick the best option
  const selectedToken = viableTokens[0];
  const requiredAmount = TARGET_USD / selectedToken.priceUSD;
  
  console.log(`\n🎯 Selected: ${requiredAmount.toFixed(6)} ${selectedToken.symbol}`);
  
  // Send payment request with proper decimals
  await sendPaymentRequest(reader, requiredAmount.toFixed(6), selectedToken.address, selectedToken.decimals);
}

const nfc = new NFC();

nfc.on('reader', (reader: Reader) => {
  console.log('Reader →', reader.name);

  reader.aid = AID;                       // ★ IMPORTANT ★

  // @ts-ignore TS7006: Parameter 'card' implicitly has an 'any' type - this will be handled by explicit typing if ts-ignore is too broad, or if the specific overload error is the main issue.
  // The primary issue is likely the event signature in the .d.ts file for nfc-pcsc's Reader.on('card', ...)
  reader.on('card', async (card: CardData) => { // Explicitly type 'card', ts-ignore for the overall assignment if types are too mismatched
    try {
      // await reader.connect();             // This is likely redundant as nfc-pcsc connects when reader.aid is set

      // If the GetUIDError (wrapping "Transaction Failed") occurred during auto-SELECT,
      // this part might not be reached or will operate on a failed state.
      // The error you see is likely from that initial auto-SELECT failing.

      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await reader.transmit(GET, 256, {}); // Pass empty options object; suppress TS error due to typings
      const sw  = resp.readUInt16BE(resp.length - 2);
      if (sw !== 0x9000) throw new Error('Bad status ' + sw.toString(16));

      const phoneResponse = resp.slice(0, -2).toString();
      console.log('Phone says →', phoneResponse);
      
      // Check if the response is an Ethereum address
      if (isEthereumAddress(phoneResponse)) {
        const ethAddress = normalizeEthereumAddress(phoneResponse);
        console.log(`✓ Detected Ethereum address: ${ethAddress}`);
        
        // Check if the address can be processed
        if (!canProcessAddress(ethAddress)) {
          return;
        }
        
        // Mark the address as being processed
        startProcessing(ethAddress);
        
        try {
          // Fetch balances from Alchemy API
          await fetchAlchemyBalances(ethAddress, reader);
        } catch (balanceError) {
          console.error('Error processing address:', balanceError);
        } finally {
          // Mark the address processing as complete (even if there was an error)
          finishProcessing(ethAddress);
        }
      } else {
        console.log('Response is not an Ethereum address');
      }
      
    } catch (e) {
      console.error('reader err', e); // This will catch the GetUIDError or errors from transmit
    } finally {
      reader.close();                     // free the reader for the next tap
    }
  });

  reader.on('error', err => console.error('reader err', err));
});
