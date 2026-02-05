import { Command } from 'commander';
import { agentRegistry, AgentStatus } from '../../models/agent.js';
import { loanLedger } from '../../models/loan.js';
import { calculateCreditScore, generateCreditReport, visualizeFactors, visualizeTiers } from '../../scoring.js';
import { securityService } from '../../services/security.js';

function getTierName(level: number): string {
  const names = ['Blocked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
  return names[level] || 'Unknown';
}

export const checkCommand = new Command()
  .name('check')
  .description('Check credit score and borrowing limit')
  .argument('<name>', 'Agent name to check')
  .option('--visualize', 'Show ASCII visualization of credit score')
  .option('--factors', 'Show detailed factor breakdown')
  .option('--security', 'Show security status')
  .action(async (name: string, options: { visualize?: boolean; factors?: boolean; security?: boolean }) => {
    console.log('\n=== Credit Report ===\n');
    
    try {
      const agent = agentRegistry.get(name);
      if (!agent) {
        console.log(`Agent "${name}" is not registered.`);
        console.log(`Run: credit register ${name}\n`);
        return;
      }
      
      // Calculate fresh credit score
      const creditScore = calculateCreditScore({
        id: agent.id,
        name: agent.moltbookName,
        karma: Math.round(agent.creditScore * 10),
        is_claimed: true,
        is_active: true,
        created_at: new Date(agent.registeredAt).getTime(),
        last_active: Date.now(),
        stats: { posts: 10, comments: 10 },
        follower_count: 50,
        following_count: 30,
        owner: { x_verified: true, x_follower_count: 100 },
      });
      
      const tierName = getTierName(creditScore.tier);
      const activeLoans = loanLedger.getActiveLoans(agent.id);
      const status = agent.status === AgentStatus.ACTIVE ? 'Active' : 'Inactive';
      
      // Basic info
      console.log(`Name: @${agent.moltbookName}`);
      console.log(`Status: ${status}`);
      console.log(`Score: ${creditScore.rawScore.toFixed(0)}/100`);
      console.log(`Tier: ${tierName}`);
      console.log(`Max Borrow: ${agent.creditLimit} USDC`);
      console.log(`Outstanding: ${agent.outstandingLoan || 0} USDC`);
      console.log(`Registered: ${new Date(agent.registeredAt).toLocaleDateString()}\n`);
      
      // Visualize option
      if (options.visualize) {
        console.log(generateCreditReport(name, creditScore));
        console.log('');
      }
      
      // Factors option
      if (options.factors) {
        console.log(visualizeFactors(creditScore.factors));
        console.log('');
        console.log(visualizeTiers(creditScore.tier, creditScore.rawScore));
        console.log('');
      }
      
      // Security option
      if (options.security) {
        console.log('=== Security Status ===\n');
        
        const profile = securityService.getSecurityProfile(agent.id);
        if (profile) {
          console.log(`Risk Score: ${profile.riskScore}/100`);
          console.log(`Wallet Bound: ${profile.walletAddress ? 'Yes' : 'No'}`);
          console.log(`Total Loans: ${profile.totalLoans}`);
          console.log(`Flagged: ${profile.isFlagged ? '⚠️ YES' : '✅ No'}`);
          
          if (profile.flagReason) {
            console.log(`Flag Reason: ${profile.flagReason}`);
          }
          
          const violations = securityService.getViolations(agent.id);
          if (violations.length > 0) {
            console.log(`\nViolations (${violations.length}):`);
            violations.forEach((v, i) => {
              console.log(`  ${i + 1}. ${v.type} - ${v.details}`);
            });
          }
        } else {
          console.log('No security profile yet. Security checks run on first borrow.');
        }
        console.log('');
      }
      
      // Show wallet address if available
      if (agent.walletAddress) {
        console.log(`Wallet: ${agent.walletAddress}`);
        if (agent.walletId) {
          console.log(`Wallet ID: ${agent.walletId}`);
        }
        console.log();
      } else {
        console.log(`Wallet: Not configured (run: credit wallet:create ${name})\n`);
      }
      
      // Show active loans
      if (activeLoans.length > 0) {
        console.log('Active Loans:');
        activeLoans.forEach((loan) => {
          console.log(`  - ${loan.amount} USDC (due: ${new Date(loan.dueDate).toLocaleDateString()})`);
        });
      }
      console.log();
    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}\n`);
    }
  });
