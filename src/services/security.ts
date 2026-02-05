/**
 * Security Service - Address JasperEXO's Feedback
 * 
 * Implements security measures to prevent:
 * 1. Sybil attacks (fake accounts)
 * 2. Loan flipping (gaming the system)
 * 3. Reputation fraud
 */

import {
  AgentProfile,
  SecurityConfig,
  SecurityCheckResult,
  AgentSecurityProfile,
  SecurityViolation,
  SecurityViolationRecord,
  WalletBinding,
} from '../types';

/**
 * Default security configuration
 */
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  minAccountAgeDays: 7,
  minKarmaVelocity: 1,
  maxLoansPerDay: 3,
  loanCooldownHours: 24,
  maxLoansPerWeek: 10,
  minActivityDays: 3,
  maxReferralsPerAgent: 5,
};

/**
 * Security Service class
 */
export class SecurityService {
  private config: SecurityConfig;
  private violations: Map<string, SecurityViolationRecord[]>;
  private walletBindings: Map<string, WalletBinding>;
  private securityProfiles: Map<string, AgentSecurityProfile>;

  constructor(config: SecurityConfig = DEFAULT_SECURITY_CONFIG) {
    this.config = config;
    this.violations = new Map();
    this.walletBindings = new Map();
    this.securityProfiles = new Map();
  }

  /**
   * Check if an agent can borrow (security validation)
   * 
   * @param profile - Agent profile from Moltbook
   * @param agentId - Agent ID in our system
   * @param lastLoanAt - Timestamp of last loan (if any)
   * @returns Security check result
   */
  canBorrow(
    profile: AgentProfile,
    agentId: string,
    lastLoanAt?: number
  ): SecurityCheckResult {
    const recommendations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let passed = true;

    // Check 1: Account age
    const accountAgeDays = (Date.now() - profile.created_at) / (1000 * 60 * 60 * 24);
    if (accountAgeDays < this.config.minAccountAgeDays) {
      passed = false;
      recommendations.push(
        `Account must be at least ${this.config.minAccountAgeDays} days old. ` +
        `Current age: ${accountAgeDays.toFixed(1)} days.`
      );
      riskLevel = 'high';
    }

    // Check 2: Karma velocity (prevent sudden karma spikes)
    const karmaVelocity = this.calculateKarmaVelocity(profile);
    if (karmaVelocity > 0 && karmaVelocity < this.config.minKarmaVelocity) {
      passed = false;
      recommendations.push(
        `Karma velocity too low (${karmaVelocity.toFixed(2)}/day). ` +
        `Minimum: ${this.config.minKarmaVelocity}/day.`
      );
      riskLevel = 'medium';
    }

    // Check 3: Loan cool-down (prevent loan flipping)
    if (lastLoanAt) {
      const hoursSinceLastLoan = (Date.now() - lastLoanAt) / (1000 * 60 * 60);
      if (hoursSinceLastLoan < this.config.loanCooldownHours) {
        passed = false;
        recommendations.push(
          `Loan cool-down active. Wait ${this.config.loanCooldownHours - Math.floor(hoursSinceLastLoan)} more hours.`
        );
        riskLevel = 'medium';
      }
    }

    // Check 4: Activity diversity (prevent fake engagement)
    const activityScore = this.calculateActivityScore(profile);
    if (activityScore < this.config.minActivityDays) {
      recommendations.push(
        `Low activity diversity. More varied engagement improves trust.`
      );
      if (riskLevel === 'low') riskLevel = 'medium';
    }

    // Update security profile
    this.updateSecurityProfile(agentId, profile, lastLoanAt);

    return {
      passed,
      riskLevel,
      recommendations,
    };
  }

  /**
   * Check for sybil attack patterns
   * 
   * @param agentId - Agent ID
   * @param walletAddress - Wallet address to check
   * @returns Security check result
   */
  checkSybil(agentId: string, walletAddress: string): SecurityCheckResult {
    const recommendations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let passed = true;

    // Check if wallet is already bound to another agent
    const existingBinding = this.getBindingByWallet(walletAddress);
    if (existingBinding && existingBinding.agentId !== agentId) {
      passed = false;
      recommendations.push(
        'Wallet is already bound to another agent. One wallet per agent.'
      );
      this.recordViolation(agentId, SecurityViolation.SYBIL_DETECTED, 
        `Wallet ${walletAddress.substring(0, 8)}... bound to another agent`);
      riskLevel = 'critical';
    }

    // Check for rapid wallet changes
    const profile = this.securityProfiles.get(agentId);
    if (profile?.walletAddress && profile.walletAddress !== walletAddress) {
      passed = false;
      recommendations.push(
        'Wallet address changed. This may indicate account takeover attempt.'
      );
      this.recordViolation(agentId, SecurityViolation.WALLET_MISMATCH,
        `Wallet changed from ${profile.walletAddress} to ${walletAddress}`);
      riskLevel = 'high';
    }

    return {
      passed,
      riskLevel,
      recommendations,
    };
  }

  /**
   * Bind wallet to agent (prevents sybil)
   * 
   * @param agentId - Agent ID
   * @param walletAddress - Wallet address
   * @param chainId - Chain ID
   * @returns Whether binding was successful
   */
  bindWallet(agentId: string, walletAddress: string, chainId: string = '1'): boolean {
    // Check if wallet is already bound
    const existingBinding = this.getBindingByWallet(walletAddress);
    if (existingBinding) {
      return false;
    }

    const binding: WalletBinding = {
      agentId,
      walletAddress,
      chainId,
      boundAt: Date.now(),
      isVerified: false,
    };

    this.walletBindings.set(`${agentId}:${walletAddress}`, binding);
    
    // Update security profile
    const profile = this.securityProfiles.get(agentId);
    if (profile) {
      profile.walletAddress = walletAddress;
    }

    return true;
  }

  /**
   * Calculate karma velocity (karma per day)
   * 
   * @param profile - Agent profile
   * @returns Karma velocity
   */
  private calculateKarmaVelocity(profile: AgentProfile): number {
    const daysSinceCreation = (Date.now() - profile.created_at) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation <= 0) return 0;
    return profile.karma / daysSinceCreation;
  }

  /**
   * Calculate activity diversity score
   * 
   * @param profile - Agent profile
   * @returns Activity score (0-7)
   */
  private calculateActivityScore(profile: AgentProfile): number {
    let score = 0;
    
    // Posts contribute
    if (profile.stats.posts > 0) score += 1;
    if (profile.stats.posts > 10) score += 1;
    if (profile.stats.posts > 50) score += 1;
    
    // Comments contribute
    if (profile.stats.comments > 0) score += 1;
    if (profile.stats.comments > 10) score += 1;
    if (profile.stats.comments > 50) score += 1;
    
    // Followers (organic growth indicator)
    if (profile.follower_count > 0) score += 1;
    if (profile.follower_count > profile.following_count) score += 1;
    
    return Math.min(score, 7);
  }

  /**
   * Update security profile for an agent
   */
  private updateSecurityProfile(
    agentId: string,
    profile: AgentProfile,
    lastLoanAt?: number
  ): void {
    const existing = this.securityProfiles.get(agentId);
    
    const profileData: AgentSecurityProfile = {
      agentId,
      walletAddress: existing?.walletAddress,
      accountCreatedAt: profile.created_at,
      firstActivityAt: existing?.firstActivityAt || profile.last_active,
      karmaVelocity: this.calculateKarmaVelocity(profile),
      totalLoans: (existing?.totalLoans || 0) + 1,
      loansLast24h: lastLoanAt ? 1 : 0,
      loansLast7Days: (existing?.loansLast7Days || 0) + 1,
      lastLoanAt,
      referralsMade: existing?.referralsMade || 0,
      riskScore: this.calculateRiskScore(profile),
      isFlagged: false,
    };

    this.securityProfiles.set(agentId, profileData);
  }

  /**
   * Calculate risk score for an agent
   */
  private calculateRiskScore(profile: AgentProfile): number {
    let score = 0;
    
    // New accounts are higher risk
    const ageDays = (Date.now() - profile.created_at) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) score += 30;
    else if (ageDays < 14) score += 20;
    else if (ageDays < 30) score += 10;
    
    // Low karma is higher risk
    if (profile.karma < 10) score += 25;
    else if (profile.karma < 50) score += 15;
    else if (profile.karma < 100) score += 5;
    
    // Verified owner reduces risk
    if (profile.owner?.x_verified) score -= 15;
    
    // Activity diversity reduces risk
    const activityScore = this.calculateActivityScore(profile);
    if (activityScore >= 5) score -= 10;
    else if (activityScore >= 3) score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get binding by wallet address
   */
  private getBindingByWallet(walletAddress: string): WalletBinding | undefined {
    for (const binding of this.walletBindings.values()) {
      if (binding.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
        return binding;
      }
    }
    return undefined;
  }

  /**
   * Record a security violation
   */
  private recordViolation(
    agentId: string,
    type: SecurityViolation,
    details: string
  ): void {
    const violation: SecurityViolationRecord = {
      id: `${agentId}-${Date.now()}`,
      agentId,
      type,
      timestamp: Date.now(),
      details,
      resolved: false,
    };

    const existing = this.violations.get(agentId) || [];
    existing.push(violation);
    this.violations.set(agentId, existing);

    // Flag agent if too many violations
    if (existing.length >= 3) {
      const profile = this.securityProfiles.get(agentId);
      if (profile) {
        profile.isFlagged = true;
        profile.flagReason = `Multiple violations: ${existing.length}`;
      }
    }
  }

  /**
   * Get security profile for an agent
   */
  getSecurityProfile(agentId: string): AgentSecurityProfile | undefined {
    return this.securityProfiles.get(agentId);
  }

  /**
   * Get all violations for an agent
   */
  getViolations(agentId: string): SecurityViolationRecord[] {
    return this.violations.get(agentId) || [];
  }

  /**
   * Check if agent is flagged
   */
  isFlagged(agentId: string): boolean {
    return this.securityProfiles.get(agentId)?.isFlagged || false;
  }

  /**
   * Get wallet binding for an agent
   */
  getWalletBinding(agentId: string): WalletBinding | undefined {
    for (const binding of this.walletBindings.values()) {
      if (binding.agentId === agentId) {
        return binding;
      }
    }
    return undefined;
  }
}

/**
 * Singleton instance
 */
export const securityService = new SecurityService();
