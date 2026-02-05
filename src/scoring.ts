/**
 * Credit Scoring Engine for the Agent Credit System
 * 
 * Implements a multi-factor credit scoring algorithm based on Moltbook reputation metrics.
 * 
 * Scoring Formula:
 * 1. Base Score = log(karma + 1) / log(max_karma) * karmaWeight
 * 2. Apply Trust Modifiers (claimed, age, activity, diversity, followers, owner)
 * 3. Apply Volatility Penalty (anti-manipulation)
 * 4. Apply EMA Smoothing for stability
 * 5. Map to Credit Tiers
 */

import {
  AgentProfile,
  CreditScore,
  CreditTier,
  ScoreFactors,
  ScoringConfig,
  DEFAULT_SCORING_CONFIG,
  LoanStatus,
} from './types';

/**
 * Credit tier definitions with borrowing limits
 * Tier 1: New/unverified (blocked)
 * Tier 2: Basic (low limit)
 * Tier 3: Standard (medium limit)
 * Tier 4: Premium (high limit)
 * Tier 5: Elite (maximum limit)
 */
export const CREDIT_TIERS: CreditTier[] = [
  {
    level: 0,
    minScore: 0,
    maxScore: 0,
    maxBorrow: 0,
    interestRate: 0,
    termDays: 14,
    name: 'Blocked',
  },
  {
    level: 1,
    minScore: 1,
    maxScore: 20,
    maxBorrow: 50,
    interestRate: 0,
    termDays: 14,
    name: 'Bronze',
  },
  {
    level: 2,
    minScore: 21,
    maxScore: 40,
    maxBorrow: 150,
    interestRate: 0,
    termDays: 14,
    name: 'Silver',
  },
  {
    level: 3,
    minScore: 41,
    maxScore: 60,
    maxBorrow: 300,
    interestRate: 0,
    termDays: 14,
    name: 'Gold',
  },
  {
    level: 4,
    minScore: 61,
    maxScore: 80,
    maxBorrow: 600,
    interestRate: 0,
    termDays: 14,
    name: 'Platinum',
  },
  {
    level: 5,
    minScore: 81,
    maxScore: 100,
    maxBorrow: 1000,
    interestRate: 0,
    termDays: 14,
    name: 'Diamond',
  },
];

/**
 * Maximum expected karma for normalization
 * Adjust based on actual Moltbook data distribution
 */
const MAX_EXPECTED_KARMA = 10000;

/**
 * Calculate account age in days
 * @param createdAt - Unix timestamp of account creation
 * @returns Number of days since account creation
 */
export function calculateAccountAge(createdAt: number): number {
  const now = Date.now();
  const ageMs = now - createdAt;
  return Math.max(0, ageMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate days since last activity
 * @param lastActive - Unix timestamp of last activity
 * @returns Number of days since last activity
 */
export function calculateDaysSinceActivity(lastActive: number): number {
  const now = Date.now();
  const inactiveMs = now - lastActive;
  return Math.max(0, inactiveMs / (1000 * 60 * 60 * 24));
}

/**
 * Normalize karma using log transform for diminishing returns
 * Higher karma gives diminishing returns to prevent karma monopolization
 * 
 * @param karma - Raw karma value
 * @param maxKarma - Maximum expected karma for normalization
 * @returns Normalized score (0-1 scale)
 */
export function normalizeKarma(karma: number, maxKarma: number = MAX_EXPECTED_KARMA): number {
  // Clamp to 0 to avoid log on negative values
  const safeKarma = Math.max(0, karma);
  // Add 1 to handle log(0)
  const logKarma = Math.log(safeKarma + 1);
  const logMaxKarma = Math.log(maxKarma + 1);
  return Math.min(1, logKarma / logMaxKarma);
}

/**
 * Calculate activity recency score
 * Recent activity is rewarded, stale accounts are penalized
 * 
 * @param lastActive - Unix timestamp of last activity
 * @param maxBonus - Maximum bonus points
 * @returns Activity score (0 to maxBonus)
 */
export function calculateActivityScore(lastActive: number, maxBonus: number = 10): number {
  const daysSinceActive = calculateDaysSinceActivity(lastActive);
  
  // Activity decay: lose 1 point per day, capped at 0
  const activityScore = Math.max(0, maxBonus - daysSinceActive);
  return activityScore;
}

/**
 * Calculate account age bonus
 * Older accounts are more trustworthy
 * 
 * @param createdAt - Unix timestamp of account creation
 * @param maxBonus - Maximum bonus points
 * @returns Age score (0 to maxBonus)
 */
export function calculateAgeScore(createdAt: number, maxBonus: number = 10): number {
  const ageDays = calculateAccountAge(createdAt);
  
  // Cap at 365 days (1 year) for maximum bonus
  const normalizedAge = Math.min(1, ageDays / 365);
  return normalizedAge * maxBonus;
}

/**
 * Calculate engagement diversity bonus
 * Accounts with balanced posts and comments are more trusted
 * 
 * @param posts - Number of posts
 * @param comments - Number of comments
 * @param maxBonus - Maximum bonus points
 * @returns Diversity score (0 to maxBonus)
 */
export function calculateDiversityScore(
  posts: number,
  comments: number,
  maxBonus: number = 5
): number {
  const total = posts + comments;
  
  if (total === 0) {
    return 0;
  }
  
  // Perfect balance: 50% posts, 50% comments
  const postRatio = posts / total;
  const idealRatio = 0.5;
  const deviation = Math.abs(postRatio - idealRatio);
  
  // Score is higher when closer to ideal balance
  const diversityScore = (1 - deviation) * maxBonus;
  return diversityScore;
}

/**
 * Calculate follower bonus
 * More followers indicates broader trust
 * 
 * @param followerCount - Number of followers
 * @param maxBonus - Maximum bonus points
 * @returns Follower score (0 to maxBonus)
 */
export function calculateFollowerScore(followerCount: number, maxBonus: number = 10): number {
  // Use log scale for followers (diminishing returns)
  const logFollowers = Math.log(followerCount + 1);
  const logMaxFollowers = Math.log(1000 + 1); // Cap at 1000 followers for max bonus
  
  const normalizedFollowers = Math.min(1, logFollowers / logMaxFollowers);
  return normalizedFollowers * maxBonus;
}

/**
 * Calculate owner credibility bonus
 * Verified human owners add trust
 * 
 * @param xVerified - Whether owner is X verified
 * @param xFollowerCount - Owner's X follower count
 * @param maxBonus - Maximum bonus points
 * @returns Owner credibility score (0 to maxBonus)
 */
export function calculateOwnerScore(
  xVerified: boolean,
  xFollowerCount: number,
  maxBonus: number = 10
): number {
  let score = 0;
  
  // Base score for verified owner
  if (xVerified) {
    score += maxBonus * 0.5;
  }
  
  // Bonus based on owner's follower count (log scale)
  const logFollowers = Math.log(xFollowerCount + 1);
  const logMaxFollowers = Math.log(10000 + 1); // Cap at 10k followers
  const followerBonus = Math.min(1, logFollowers / logMaxFollowers) * (maxBonus * 0.5);
  
  return score + followerBonus;
}

/**
 * Calculate volatility penalty
 * Sudden karma changes indicate potential manipulation
 * 
 * @param currentKarma - Current karma value
 * @param previousKarma - Previous karma value (from history)
 * @param penaltyMultiplier - Multiplier for penalty severity
 * @returns Volatility penalty (0 or negative)
 */
export function calculateVolatilityPenalty(
  currentKarma: number,
  previousKarma: number,
  penaltyMultiplier: number = 2
): number {
  if (previousKarma === 0) {
    return 0; // No history to compare
  }
  
  const changePercent = Math.abs(currentKarma - previousKarma) / previousKarma;
  
  // Penalize if karma changed by more than 50% in a short period
  if (changePercent > 0.5) {
    const excess = changePercent - 0.5;
    const penalty = excess * penaltyMultiplier * 10; // Scale the penalty
    return -Math.min(penalty, 20); // Cap penalty at -20
  }
  
  return 0;
}

/**
 * Apply Exponential Moving Average for score smoothing
 * Prevents dramatic score swings
 * 
 * @param newScore - Newly calculated raw score
 * @param previousScore - Previous EMA score
 * @param alpha - EMA smoothing factor (0-1)
 * @returns Smoothed score
 */
export function applyEMASmoothing(
  newScore: number,
  previousScore: number,
  alpha: number = 0.3
): number {
  // If no previous score, treat as 0 baseline and still apply alpha
  // EMA formula: EMA_t = alpha * new + (1 - alpha) * old
  const smoothedScore = alpha * newScore + (1 - alpha) * previousScore;
  return smoothedScore;
}

/**
 * Get credit tier for a given score
 * 
 * @param score - Raw credit score
 * @returns Matching credit tier
 */
export function getTier(score: number): CreditTier {
  // Handle blocked state
  if (score <= 0) {
    return CREDIT_TIERS[0];
  }
  
  // Find matching tier
  for (const tier of CREDIT_TIERS) {
    if (score >= tier.minScore && score <= tier.maxScore) {
      return tier;
    }
  }
  
  // Score exceeds all tiers, return highest
  return CREDIT_TIERS[CREDIT_TIERS.length - 1];
}

/**
 * Get maximum borrow limit for a given score
 * 
 * @param score - Raw credit score
 * @returns Maximum borrowable USDC amount
 */
export function getCreditLimit(score: number): number {
  const tier = getTier(score);
  return tier.maxBorrow;
}

/**
 * Calculate complete credit score for an agent profile
 * 
 * @param profile - Agent profile from Moltbook API
 * @param config - Scoring configuration (optional, uses defaults)
 * @param previousScore - Previous EMA score for smoothing (optional)
 * @param previousKarma - Previous karma for volatility calculation (optional)
 * @returns Complete credit score result
 */
export function calculateCreditScore(
  profile: AgentProfile,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  previousScore: number = 0,
  previousKarma: number = 0
): CreditScore {
  const factors: ScoreFactors = {
    karmaScore: 0,
    claimedBonus: 0,
    ageBonus: 0,
    activityBonus: 0,
    diversityBonus: 0,
    followerBonus: 0,
    ownerBonus: 0,
    volatilityPenalty: 0,
    adjustedScore: 0,
  };
  
  // Block unclaimed agents (required: is_claimed = true)
  if (!profile.is_claimed) {
    const now = Date.now();
    const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours cache
    
    return {
      rawScore: 0,
      tier: 0,
      maxBorrow: 0,
      factors,
      calculatedAt: now,
      expiresAt,
    };
  }
  
  // 1. Calculate base karma score
  const normalizedKarma = normalizeKarma(profile.karma);
  const karmaScore = normalizedKarma * config.karmaWeight;
  factors.karmaScore = karmaScore;
  
  // 2. Calculate trust modifiers
  const claimedBonus = profile.is_claimed ? config.claimedBonus : 0;
  factors.claimedBonus = claimedBonus;
  
  const ageScore = calculateAgeScore(profile.created_at, config.maxAgeBonus);
  const ageBonus = ageScore * config.ageWeight;
  factors.ageBonus = ageBonus;
  
  const activityScore = calculateActivityScore(profile.last_active, config.maxActivityBonus);
  const activityBonus = activityScore * config.activityWeight;
  factors.activityBonus = activityBonus;
  
  const diversityScore = calculateDiversityScore(
    profile.stats.posts,
    profile.stats.comments,
    config.maxDiversityBonus
  );
  const diversityBonus = diversityScore * config.diversityWeight;
  factors.diversityBonus = diversityBonus;
  
  const followerScore = calculateFollowerScore(profile.follower_count, config.maxFollowerBonus);
  const followerBonus = followerScore * config.followerWeight;
  factors.followerBonus = followerBonus;
  
  const ownerScore = calculateOwnerScore(
    profile.owner.x_verified,
    profile.owner.x_follower_count,
    config.maxOwnerBonus
  );
  const ownerBonus = ownerScore * config.ownerWeight;
  factors.ownerBonus = ownerBonus;
  
  // 3. Calculate volatility penalty
  const volatilityPenalty = calculateVolatilityPenalty(
    profile.karma,
    previousKarma,
    config.volatilityPenaltyMultiplier
  );
  factors.volatilityPenalty = volatilityPenalty;
  
  // 4. Calculate raw adjusted score
  const rawScore = 
    karmaScore +
    claimedBonus +
    ageBonus +
    activityBonus +
    diversityBonus +
    followerBonus +
    ownerBonus +
    volatilityPenalty;
  
  // Clamp score to valid range
  const clampedScore = Math.max(0, Math.min(100, rawScore));
  factors.adjustedScore = clampedScore;
  
  // 5. Apply EMA smoothing for stability
  // If caller provides no previous score, default to current to avoid artificially deflating first score.
  const emaBaseline = previousScore === 0 ? clampedScore : previousScore;
  const smoothedScore = applyEMASmoothing(
    clampedScore,
    emaBaseline,
    config.emaAlpha
  );
  
  // Clamp smoothed score
  const finalScore = Math.max(0, Math.min(100, smoothedScore));
  
  // 6. Map to credit tier
  const tier = getTier(finalScore);
  
  const now = Date.now();
  const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours cache
  
  return {
    rawScore: Math.round(finalScore * 100) / 100,
    tier: tier.level,
    maxBorrow: tier.maxBorrow,
    factors,
    calculatedAt: now,
    expiresAt,
  };
}

/**
 * Create a mock agent profile for testing
 * 
 * @param overrides - Partial profile data to override defaults
 * @returns Complete mock agent profile
 */
export function createMockProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
  
  const defaults: AgentProfile = {
    id: 'agent-001',
    name: 'TestAgent',
    karma: 100,
    is_claimed: true,
    is_active: true,
    created_at: ninetyDaysAgo,
    last_active: thirtyDaysAgo,
    stats: {
      posts: 10,
      comments: 20,
    },
    follower_count: 50,
    following_count: 30,
    owner: {
      x_verified: true,
      x_follower_count: 500,
    },
  };
  
  return { ...defaults, ...overrides };
}

/**
 * Validate that a loan can be issued based on credit score
 * 
 * @param creditScore - Current credit score
 * @param requestedAmount - Amount requested for borrowing
 * @returns Object with isValid flag and reason if invalid
 */
export function validateLoanRequest(
  creditScore: CreditScore,
  requestedAmount: number
): { isValid: boolean; reason?: string } {
  // Check if agent is blocked
  if (creditScore.tier === 0) {
    return {
      isValid: false,
      reason: 'Agent is not eligible for credit (unclaimed or blocked)',
    };
  }
  
  // Check requested amount against max borrow
  if (requestedAmount > creditScore.maxBorrow) {
    return {
      isValid: false,
      reason: `Requested amount (${requestedAmount} USDC) exceeds maximum borrow limit (${creditScore.maxBorrow} USDC)`,
    };
  }
  
  // Check minimum borrow amount
  if (requestedAmount < 1) {
    return {
      isValid: false,
      reason: 'Minimum borrow amount is 1 USDC',
    };
  }
  
  return { isValid: true };
}

/**
 * Calculate loan details including due date
 * 
 * @param amount - Loan amount in USDC
 * @param creditScore - Credit score for tier info
 * @returns Complete loan object
 */
export function createLoan(
  amount: number,
  creditScore: CreditScore,
  loanId: string
): {
  amount: number;
  interestRate: number;
  termDays: number;
  issuedAt: number;
  dueAt: number;
  status: LoanStatus;
} {
  const now = Date.now();
  const tier = getTier(creditScore.rawScore);
  
  return {
    amount,
    interestRate: tier.interestRate,
    termDays: tier.termDays,
    issuedAt: now,
    dueAt: now + (tier.termDays * 24 * 60 * 60 * 1000),
    status: LoanStatus.ACTIVE,
  };
}

/**
 * Default penalty for loan default
 * Reduces credit score when agent defaults on a loan
 * 
 * @param currentScore - Current credit score
 * @param defaultCount - Number of defaults
 * @param loanAmount - Amount of defaulted loan
 * @returns New score after penalty
 */
export function applyDefaultPenalty(
  currentScore: number,
  defaultCount: number,
  loanAmount: number
): number {
  // Base penalty for first default
  let penalty = 10;
  
  // Additional penalty based on default count
  penalty += defaultCount * 5;
  
  // Additional penalty based on loan amount (capped)
  const amountPenalty = Math.min(10, loanAmount / 100);
  penalty += amountPenalty;
  
  // Apply penalty
  const newScore = currentScore - penalty;
  
  // Clamp to minimum (0)
  return Math.max(0, newScore);
}

/**
 * Calculate recovery score after default
 * Gradual recovery over time with good behavior
 * 
 * @param monthsSinceDefault - Months since the default
 * @param repaidAmount - Amount that was repaid (percentage of original)
 * @returns Recovery points to add
 */
export function calculateRecoveryScore(
  monthsSinceDefault: number,
  repaidAmount: number
): number {
  // Base recovery per month
  let recovery = monthsSinceDefault * 2;
  
  // Bonus for full repayment
  if (repaidAmount >= 100) {
    recovery += 10;
  }
  
  return recovery;
}

/**
 * Check if agent is blacklisted
 * 
 * @param defaultCount - Number of defaults
 * @param lastDefaultDate - Date of last default
 * @returns Whether agent is blacklisted
 */
export function isBlacklisted(defaultCount: number, lastDefaultDate?: number): boolean {
  // More than 3 defaults = blacklist
  if (defaultCount > 3) {
    return true;
  }
  
  // Default within last 30 days
  if (lastDefaultDate) {
    const daysSince = (Date.now() - lastDefaultDate) / (1000 * 60 * 60 * 24);
    if (daysSince < 30 && defaultCount > 0) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get default warning message
 * 
 * @param daysUntilDue - Days until loan is due
 * @returns Warning message
 */
export function getDefaultWarning(daysUntilDue: number): string | null {
  if (daysUntilDue <= 0) {
    return '⚠️ LOAN IS OVERDUE! Repay immediately to avoid default.';
  }
  
  if (daysUntilDue <= 3) {
    return `⚠️ WARNING: ${daysUntilDue} days until due date!`;
  }
  
  if (daysUntilDue <= 7) {
    return `ℹ️ Reminder: ${daysUntilDue} days until loan is due.`;
  }
  
  return null;
}

// Re-export types for convenience
export * from './types';

/**
 * Generate ASCII progress bar for credit score
 * 
 * @param score - Credit score (0-100)
 * @param width - Width of the bar (default 30)
 * @returns ASCII progress bar string
 */
export function generateScoreBar(score: number, width: number = 30): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  
  // Choose color based on tier
  let bar = '';
  for (let i = 0; i < filled; i++) {
    if (i < width * 0.2) bar += '█'; // Bronze
    else if (i < width * 0.4) bar += '█'; // Silver
    else if (i < width * 0.6) bar += '█'; // Gold
    else if (i < width * 0.8) bar += '█'; // Platinum
    else bar += '█'; // Diamond
  }
  
  return `[${bar}${'░'.repeat(empty)}] ${score.toFixed(0)}`;
}

/**
 * Generate factor breakdown visualization
 * 
 * @param factors - Score factors object
 * @returns ASCII bar chart of factors
 */
export function visualizeFactors(factors: ScoreFactors): string {
  const maxWidth = 20;
  const result: string[] = [];
  
  result.push('\n┌─────────────────────────────┐');
  result.push('│     Score Factor Breakdown   │');
  result.push('├─────────────────────────────┤');
  
  // Helper to add factor bar
  const addFactor = (name: string, value: number, max: number) => {
    const barLen = Math.round((value / max) * maxWidth);
    const bar = '█'.repeat(barLen);
    const padded = name.padEnd(14);
    result.push(`│ ${padded} │${bar.padEnd(maxWidth)}│ ${value.toFixed(1)}`);
  };
  
  addFactor('Karma', factors.karmaScore, 40);
  addFactor('Claimed', factors.claimedBonus, 15);
  addFactor('Age', factors.ageBonus, 10);
  addFactor('Activity', factors.activityBonus, 10);
  addFactor('Diversity', factors.diversityBonus, 5);
  addFactor('Followers', factors.followerBonus, 10);
  addFactor('Owner', factors.ownerBonus, 10);
  
  if (factors.volatilityPenalty < 0) {
    addFactor('Penalty', Math.abs(factors.volatilityPenalty), 20);
  }
  
  result.push('└─────────────────────────────┘');
  
  return result.join('\n');
}

/**
 * Generate tier progress visualization
 * 
 * @param currentTier - Current tier level (0-5)
 * @param score - Current score
 * @returns ASCII tier progression chart
 */
export function visualizeTiers(currentTier: number, score: number): string {
  const tiers = ['Blocked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
  const limits = [0, 50, 150, 300, 600, 1000];
  const result: string[] = [];
  
  result.push('\n┌─────────────────────────────────────────────┐');
  result.push('│              Credit Tier Progress            │');
  result.push('├───────┬───────────┬────────────┬────────────┤');
  result.push('│ Tier  │  Score    │  Max Borrow│   Status   │');
  result.push('├───────┼───────────┼────────────┼────────────┤');
  
  for (let i = 0; i < tiers.length; i++) {
    const isCurrent = i === currentTier;
    const status = isCurrent ? '◀ CURRENT' : '';
    const tierName = isCurrent ? `★${tiers[i]}` : ` ${tiers[i]}`;
    const scoreRange = i === 0 ? '-' : `${i === 1 ? 1 : limits[i]}↑`;
    const maxBorrow = limits[i];
    
    result.push(`│ ${tierName.padEnd(5)} │ ${String(limits[i]).padStart(3)}-100  │ $${String(maxBorrow).padEnd(10)} │ ${status.padEnd(10)}│`);
  }
  
  result.push('└───────┴───────────┴────────────┴────────────┘');
  
  return result.join('\n');
}

/**
 * Generate complete credit report visualization
 * 
 * @param name - Agent name
 * @param creditScore - Credit score result
 * @returns Formatted ASCII credit report
 */
export function generateCreditReport(name: string, creditScore: CreditScore): string {
  const tierNames = ['Blocked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
  const tier = tierNames[creditScore.tier];
  
  const report: string[] = [];
  
  // Header
  report.push('');
  report.push('╔═══════════════════════════════════════════╗');
  report.push('║         💰 KARMA BANK CREDIT REPORT 💰     ║');
  report.push('╠═══════════════════════════════════════════╣');
  report.push(`║ Agent: ${name.padEnd(35)}║`);
  report.push(`║ Score: ${creditScore.rawScore.toFixed(0).padEnd(36)}║`);
  report.push(`║ Tier:  ${tier.padEnd(36)}║`);
  report.push(`║ Max Borrow: $${creditScore.maxBorrow.toString().padEnd(32)}║`);
  report.push('╠═══════════════════════════════════════════╣');
  
  // Score bar
  report.push('║ Credit Score:                                   ║');
  report.push(`║   ${generateScoreBar(creditScore.rawScore).padEnd(37)}║`);
  
  // Factors
  report.push(visualizeFactors(creditScore.factors).replace(/^[┌┐]/g, '║').replace(/[└┘]/g, '║').replace(/├┤/g, '║║').replace(/─/g, ' '));
  
  // Footer
  report.push(`║ Valid until: ${new Date(creditScore.expiresAt).toLocaleDateString().padEnd(29)}║`);
  report.push('╚═══════════════════════════════════════════╝');
  
  return report.join('\n');
}
