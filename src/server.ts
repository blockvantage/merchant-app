import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express'; // Corrected import for Request and Response types
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { App } from './app.js'; // App class will be refactored
import { AlchemyService } from './services/alchemyService.js';
import { SUPPORTED_CHAINS, ChainConfig } from './config/index.js';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// Initialize Express app and HTTP server
const expressApp = express();
const server = http.createServer(expressApp);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Store connected WebSocket clients
const clients = new Set<WebSocket>();

// Main application instance (controls NFC, etc.)
const nfcApp = new App();

// Middleware to parse JSON bodies
expressApp.use(express.json());

// Serve static files from the 'src/web' directory
const webDir = path.join(__dirname, 'web');
expressApp.use(express.static(webDir));
console.log(`🌐 Serving static files from: ${webDir}`);

// Store active payment monitoring sessions
interface PaymentSession {
    amount: number;
    merchantAddress: string;
    startTime: number;
    timeout: NodeJS.Timeout;
}

// Store transaction history
interface TransactionRecord {
    id: string;
    amount: number;
    fromAddress?: string;
    toAddress: string;
    chainId: number;
    chainName: string;
    tokenSymbol?: string;
    txHash?: string;
    explorerUrl?: string;
    status: 'detected' | 'confirmed' | 'failed';
    timestamp: number;
}

const activePayments = new Map<string, PaymentSession>();
const transactionHistory: TransactionRecord[] = [];

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('🟢 Client connected to WebSocket');
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', message: 'Connected to payment terminal.' }));

    ws.on('message', (message) => {
        console.log('💻 Received WebSocket message from client:', message.toString());
    });
    ws.on('close', () => {
        console.log('🔴 Client disconnected from WebSocket');
        clients.delete(ws);
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Function to broadcast messages to all connected WebSocket clients
export function broadcast(message: object) {
    const data = JSON.stringify(message);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(data);
            } catch (error) {
                console.error('Error sending message to client:', error);
            }
        }
    });
}

// Explicitly define the async handler type for clarity
type AsyncRequestHandler = (req: Request, res: Response, next?: NextFunction) => Promise<void | Response>;

// Function to monitor transaction for a payment
async function monitorTransaction(merchantAddress: string, amount: number, chainId: number = 1, chainName: string = "Ethereum") {
    console.log(`🔍 Starting transaction monitoring for ${merchantAddress}, amount: $${amount}`);
    console.log(`💰 Waiting for payment of $${amount} USD (${amount} wei minimum) on ${chainName} (Chain ID: ${chainId})`);
    
    const startTime = Date.now();
    const timeout = setTimeout(() => {
        console.log(`⏰ Payment timeout for ${merchantAddress} - No payment of $${amount} received after 5 minutes on ${chainName}`);
        broadcast({ type: 'payment_failure', message: 'Payment timeout - no transaction detected', errorType: 'PAYMENT_TIMEOUT' });
        activePayments.delete(merchantAddress);
    }, 300000); // 5 minutes timeout

    activePayments.set(merchantAddress, {
        amount,
        merchantAddress,
        startTime,
        timeout
    });

    try {
        // Start monitoring transactions to the merchant address on the specific chain
        const unsubscribe = await AlchemyService.monitorTransactions(
            merchantAddress, 
            async (tx) => {
                // Generate block explorer URL
                const getBlockExplorerUrl = (chainId: number, txHash: string): string => {
                    const explorerMap: {[key: number]: string} = {
                        1: 'https://etherscan.io/tx/',
                        8453: 'https://basescan.org/tx/',
                        42161: 'https://arbiscan.io/tx/',
                        10: 'https://optimistic.etherscan.io/tx/',
                        137: 'https://polygonscan.com/tx/',
                        393402133025423: 'https://starkscan.co/tx/'
                    };
                    const baseUrl = explorerMap[chainId];
                    return baseUrl ? `${baseUrl}${txHash}` : `https://etherscan.io/tx/${txHash}`;
                };
                
                const explorerUrl = getBlockExplorerUrl(chainId, tx.hash);
                
                // Handle both ETH and ERC-20 token transfers
                const tokenSymbol = tx.tokenSymbol || 'ETH';
                const decimals = tx.decimals || 18;
                const formattedAmount = tx.value / Math.pow(10, decimals);
                
                console.log(`📝 ${tokenSymbol} transaction detected for ${merchantAddress} on ${chainName}:`, {
                    hash: tx.hash,
                    value: tx.value,
                    formattedAmount: `${formattedAmount} ${tokenSymbol}`,
                    from: tx.from,
                    to: tx.to,
                    chainId,
                    chainName,
                    tokenSymbol,
                    tokenAddress: tx.tokenAddress
                });
                console.log(`🔗 View transaction: ${explorerUrl}`);
                
                // Create transaction record
                const transactionRecord: TransactionRecord = {
                    id: `${tx.hash}-${Date.now()}`,
                    amount: formattedAmount,
                    fromAddress: tx.from,
                    toAddress: tx.to,
                    chainId,
                    chainName,
                    tokenSymbol: tokenSymbol,
                    txHash: tx.hash,
                    explorerUrl,
                    status: 'detected',
                    timestamp: Date.now()
                };
                
                // For payment verification, convert amount to USD
                // Note: This is a simplified check - in production you'd want to verify the exact payment amount
                const minimumPaymentValue = amount; // This is in USD
                
                if (formattedAmount > 0) {
                    console.log(`✅ ${tokenSymbol} payment confirmed! Received ${formattedAmount} ${tokenSymbol} for ${merchantAddress} on ${chainName}`);
                    console.log(`🔗 View on block explorer: ${explorerUrl}`);
                    
                    transactionRecord.status = 'confirmed';
                    transactionHistory.unshift(transactionRecord);
                    
                    // Keep only last 500 transactions
                    if (transactionHistory.length > 500) {
                        transactionHistory.splice(500);
                    }
                    
                    clearTimeout(timeout);
                    activePayments.delete(merchantAddress);
                    broadcast({ 
                        type: 'transaction_confirmed', 
                        message: `Approved`,
                        transactionHash: tx.hash,
                        amount: formattedAmount,
                        chainName,
                        chainId,
                        transaction: transactionRecord
                    });
                } else {
                    console.log(`⚠️ ${tokenSymbol} transaction detected but amount is 0: ${formattedAmount} ${tokenSymbol}`);
                    
                    transactionRecord.status = 'failed';
                    transactionHistory.unshift(transactionRecord);
                    
                    // Keep only last 500 transactions
                    if (transactionHistory.length > 500) {
                        transactionHistory.splice(500);
                    }
                    
                    broadcast({
                        type: 'transaction_detected',
                        transaction: transactionRecord
                    });
                }
            }, 
            chainId,
            amount // Pass minimum amount (simplified - would need token-specific conversion in production)
        );

        console.log(`🎯 Transaction monitoring active for ${chainName} (Chain ID: ${chainId})`);
        
        // Store unsubscribe function for cleanup
        return unsubscribe;
    } catch (error) {
        console.error(`Error setting up transaction monitoring on ${chainName}:`, error);
        clearTimeout(timeout);
        activePayments.delete(merchantAddress);
        broadcast({ 
            type: 'payment_failure', 
            message: `Failed to monitor transaction on ${chainName}: ${error instanceof Error ? error.message : 'Unknown error'}`, 
            errorType: 'MONITORING_ERROR' 
        });
        throw error;
    }
}

const initiatePaymentHandler: AsyncRequestHandler = async (req, res) => {
    const { amount, merchantAddress } = req.body;
    if (typeof amount !== 'number' || amount <= 0 || isNaN(amount)) {
        broadcast({ type: 'status', message: 'Invalid amount received from UI.', isError: true });
        res.status(400).json({ error: 'Invalid amount' });
        return;
    }

    if (!merchantAddress || !AlchemyService.isEthereumAddress(merchantAddress)) {
        broadcast({ type: 'status', message: 'Invalid merchant address.', isError: true });
        res.status(400).json({ error: 'Invalid merchant address' });
        return;
    }

    console.log(`💸 Payment initiated for $${amount.toFixed(2)} from Web UI to ${merchantAddress}`);
    broadcast({ type: 'status', message: `Preparing for $${amount.toFixed(2)} payment...` });

    try {
        // This method in App will trigger NFCService.armForPaymentAndAwaitTap
        const paymentResult = await nfcApp.processPayment(amount);
        
        if (paymentResult.success && paymentResult.paymentInfo) {
            console.log(`✅ Payment request sent successfully: ${paymentResult.message}`);
            console.log(`⛓️ Payment sent on: ${paymentResult.paymentInfo.chainName} (Chain ID: ${paymentResult.paymentInfo.chainId})`);
            
            // Start transaction monitoring for the specific chain the payment was sent on
            try {
                await monitorTransaction(
                    merchantAddress, 
                    amount, 
                    paymentResult.paymentInfo.chainId, 
                    paymentResult.paymentInfo.chainName
                );
                console.log(`🔍 Monitoring started for ${paymentResult.paymentInfo.chainName} payment of $${amount.toFixed(2)}`);
                broadcast({ 
                    type: 'monitoring_started', 
                    message: `Monitoring ${paymentResult.paymentInfo.chainName} for payment...`,
                    chainName: paymentResult.paymentInfo.chainName,
                    chainId: paymentResult.paymentInfo.chainId
                });
            } catch (monitoringError) {
                console.error(`❌ Failed to start monitoring on ${paymentResult.paymentInfo.chainName}:`, monitoringError);
                
                // Fallback: try to monitor on Ethereum mainnet
                console.log(`🔄 Falling back to Ethereum mainnet monitoring...`);
                try {
                    await monitorTransaction(merchantAddress, amount, 1, "Ethereum (fallback)");
                    broadcast({ 
                        type: 'status', 
                        message: `Payment sent on ${paymentResult.paymentInfo.chainName}. Monitoring Ethereum mainnet as fallback.`,
                        isWarning: true
                    });
                } catch (fallbackError) {
                    console.error(`❌ Fallback monitoring also failed:`, fallbackError);
                    broadcast({ 
                        type: 'payment_failure', 
                        message: 'Payment sent but monitoring failed. Please verify manually.', 
                        errorType: 'MONITORING_ERROR' 
                    });
                }
            }
            
            broadcast({ type: 'payment_success', message: paymentResult.message, amount });
            res.json({ success: true, message: paymentResult.message });
        } else if (paymentResult.success) {
            // Fallback to Ethereum monitoring if no payment info
            console.log(`✅ Payment successful: ${paymentResult.message}`);
            console.log(`🔄 No chain information available, defaulting to Ethereum monitoring`);
            
            try {
                await monitorTransaction(merchantAddress, amount, 1, "Ethereum (default)");
                broadcast({ 
                    type: 'monitoring_started', 
                    message: 'Monitoring Ethereum for payment...',
                    chainName: "Ethereum",
                    chainId: 1
                });
            } catch (monitoringError) {
                console.error(`❌ Failed to start Ethereum monitoring:`, monitoringError);
                broadcast({ 
                    type: 'payment_failure', 
                    message: 'Payment sent but monitoring failed. Please verify manually.', 
                    errorType: 'MONITORING_ERROR' 
                });
            }
            
            broadcast({ type: 'payment_success', message: paymentResult.message, amount });
            res.json({ success: true, message: paymentResult.message });
        } else {
            console.log(`❌ Payment failed: ${paymentResult.message}, Type: ${paymentResult.errorType}`);
            broadcast({ type: 'payment_failure', message: paymentResult.message, errorType: paymentResult.errorType });
            const statusCode = paymentResult.errorType === 'PHONE_MOVED_TOO_QUICKLY' ? 409 : 500;
            res.status(statusCode).json({ success: false, message: paymentResult.message, errorType: paymentResult.errorType });
        }
    } catch (error: any) {
        console.error('Error in /initiate-payment endpoint:', error);
        const errorMessage = error.message || 'Internal server error during payment processing.';
        broadcast({ type: 'payment_failure', message: `Server error: ${errorMessage}`, errorType: 'SERVER_ERROR' });
        res.status(500).json({ error: 'Internal server error' });
    }
};

// HTTP endpoint to initiate payment
expressApp.post('/initiate-payment', initiatePaymentHandler);

// Endpoint to get transaction history
expressApp.get('/transaction-history', (req, res) => {
    res.json(transactionHistory);
});

// Endpoint to scan wallet for history filtering
const scanWalletHandler: AsyncRequestHandler = async (req, res) => {
    try {
        console.log('📱 Starting wallet scan for transaction history...');
        broadcast({ type: 'status', message: 'Tap wallet to view history...' });
        
        // Use NFC to scan for wallet address
        const scanResult = await nfcApp.scanWalletAddress();
        
        if (scanResult.success && scanResult.address) {
            console.log(`✅ Wallet scanned successfully: ${scanResult.address}`);
            broadcast({ 
                type: 'wallet_scanned', 
                address: scanResult.address,
                message: `Wallet found: ${scanResult.address.slice(0, 6)}...${scanResult.address.slice(-4)}`
            });
            res.json({ success: true, address: scanResult.address });
        } else {
            console.log(`❌ Wallet scan failed: ${scanResult.message}`);
            broadcast({ 
                type: 'status', 
                message: scanResult.message || 'Failed to scan wallet', 
                isError: true 
            });
            res.status(400).json({ success: false, message: scanResult.message });
        }
    } catch (error: any) {
        console.error('Error in wallet scan:', error);
        const errorMessage = error.message || 'Failed to scan wallet';
        broadcast({ type: 'status', message: errorMessage, isError: true });
        res.status(500).json({ success: false, message: errorMessage });
    }
};

expressApp.post('/scan-wallet', scanWalletHandler);

// Debug endpoint to check supported chains and active subscriptions
expressApp.get('/debug/chains', (req, res) => {
    const supportedChains = SUPPORTED_CHAINS.map(chain => ({
        id: chain.id,
        name: chain.name,
        displayName: chain.displayName,
        nativeToken: chain.nativeToken
    }));
    
    const activeSubscriptions = AlchemyService.getActiveSubscriptions();
    
    res.json({
        supportedChains,
        activeSubscriptions,
        totalChains: supportedChains.length,
        totalSubscriptions: activeSubscriptions.length
    });
});

// Add global error handlers
process.on('uncaughtException', (error) => {
    if (error.message.includes('Cannot process ISO 14443-4 tag')) {
        console.log('💳 Payment card detected - ignoring');
        return;
    }
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the main application logic (NFC, Price Cache)
async function startServerAndApp() {
    try {
        // Initialize AlchemyService first
        try {
            AlchemyService.initialize();
            console.log('✅ AlchemyService initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize AlchemyService:', error);
            throw error;
        }

        // Initialize PriceCacheService and start NFC listeners via App class
        await nfcApp.initializeServices(); 
        console.log('🔌 NFC Application services (including Price Cache) initialized.');

        // Start the HTTP server
        server.listen(PORT, () => {
            console.log(`📡 HTTP & WebSocket Server running at http://localhost:${PORT}`);
            console.log(`✅ NFC Payment Terminal is READY. Open http://localhost:${PORT} in your browser.`);
        });

    } catch (error) {
        console.error('❌ Failed to start main application:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown for the server and app services
function shutdown(signal: string) {
    console.log(`\n👋 Received ${signal}. Shutting down gracefully...`);
    
    // Clear all payment monitoring timeouts
    activePayments.forEach((session) => {
        clearTimeout(session.timeout);
    });
    activePayments.clear();
    
    // Cleanup all active Alchemy subscriptions
    try {
        AlchemyService.cleanup();
    } catch (error) {
        console.error('Error cleaning up Alchemy subscriptions:', error);
    }
    
    // Close WebSocket clients first
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.terminate();
        }
    });
    wss.close(() => {
        console.log('🔌 WebSocket server closed.');
    });

    server.close((err) => {
        if (err) {
            console.error('Error closing HTTP server:', err);
        }
        console.log('🛑 HTTP server closed.');
        nfcApp.stopServices();
        process.exit(err ? 1 : 0);
    });

    setTimeout(() => {
        console.error('Timeout: Could not close connections gracefully. Forcefully shutting down.');
        process.exit(1);
    }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServerAndApp(); 