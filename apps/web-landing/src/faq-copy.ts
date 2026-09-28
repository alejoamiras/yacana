// The FAQ: four sections of question rows, the six panels of the upgrade between them, and the
// rules the portal enforces as one line each with a picture and the reasons behind a disclosure.
// The questions the other pages link to keep their words (`copy.faq.questions`). A withdrawal is
// claimed by its holder, a deposit is one transaction, a claim is a tap, a held send can be
// redeemed any time.
import { policyFor } from '@yacana/bridge/policy';
import { PARAMS } from '@yacana/miner-core/generated/params';
import { amount } from '@yacana/web-kit/browser/format';
import { copy } from './copy';
import type { DiagramId } from './features/RuleDiagrams';

export interface FaqQuestion {
  q: string;
  a: string;
}

/** A rule in one line, with the picture and the reasons that open under it. */
export interface FaqRule {
  q: string;
  line: string;
  diagram: DiagramId;
  more: string;
}

export interface FaqSection {
  id: string;
  title: string;
  /** A line under the title; the upgrade section carries the six panels after it. */
  lede?: string;
  panels?: boolean;
  /** The rules section: these rows come before its questions. */
  rules?: FaqRule[];
  questions: FaqQuestion[];
}

const symbol = PARAMS.TOKEN_SYMBOL;
const policy = policyFor();
const whole = (raw: bigint) => amount(raw, PARAMS.DECIMALS, 0);
const days = (seconds: bigint) => Number(seconds / 86_400n);

/** One of the questions the pages link to, by its words. */
const linked = (q: string): FaqQuestion => {
  const found = copy.faq.questions.find((x) => x.q === q);
  if (!found) throw new Error(`no FAQ question ${JSON.stringify(q)}`);
  return found;
};

export const faq = {
  eyebrow: 'questions',
  title: 'What happens to your coins, in plain words.',
  sections: [
    {
      id: 'mining',
      title: 'Mining',
      questions: [
        linked('How is it mined?'),
        {
          q: 'Why is the work a proof?',
          a: 'Because the race to prove faster is worth having. Mining runs Barretenberg, the prover behind every Aztec transaction. Miners earn more by proving faster, and speedups that land in Barretenberg make private transactions faster and cheaper for everyone. The difficulty adjusts, so faster proving never mints more than the schedule.',
        },
        {
          q: 'What does the chain see?',
          a: 'A claim writes a nullifier, a note hash and a counter. Not who claimed, not how much they hold, not how many proofs it took.',
        },
        {
          q: 'Can the rules change?',
          a: 'The contracts are immutable. What can change is Aztec itself: a new version of the rollup replaces the old one, and that is what the next section is about.',
        },
      ],
    },
    {
      id: 'upgrade',
      title: 'When Aztec upgrades',
      lede: 'Aztec’s Alpha rollups do not carry balances to the next version. Yacana moves yours through Ethereum in six steps; you act at step 2 and step 6.',
      panels: true,
      questions: [
        {
          q: 'What do I do?',
          a: 'When an upgrade is announced, Yacana shows one button: Send ahead. Press it before the upgrade, and again for what you mine after that. Then, once the next version is live, sign in with the same passkey or words; the arrival card offers a Claim, one tap, and your balance lands there.',
        },
        {
          q: 'What if I miss it?',
          a: `After the upgrade, mining on the old version ends: its contract refuses every mining claim from then on. But it keeps proving epochs for hours or days, without notice of when it stops, and while it does the old app still lets you send ahead what you hold: a bet that it proves one more epoch, against the sure loss of leaving it. A send it never proves is undone back onto it.`,
        },
        {
          q: 'What if Yacana never opens the next version?',
          a: 'Your send is proven and held on Ethereum, not on any Yacana contract. A send that could not be forwarded can be redeemed on Ethereum as YACA any time before the version’s last day, by the account that made it.',
        },
        {
          q: 'Is it the same account on the next version?',
          a: 'Same passkey or words, same secrets; a new address, because Aztec derives addresses from the account contract of each version. What you sent ahead lands under the new address; nothing on the old version knows it.',
        },
        linked('Who may forward a held send, and why the rule?'),
        linked('What is public?'),
        linked('What can go wrong?'),
      ],
    },
    {
      id: 'ethereum',
      title: 'To Ethereum and back',
      questions: [
        {
          q: 'Can I hold it on Ethereum?',
          a: `Yes: Bridge to Ethereum in the wallet burns ${symbol} here; once the epoch is proven, usually within the hour, you claim YACA, an ERC-20, on Ethereum at the address you chose, one transaction with a wallet. The amount and the address are public there.`,
        },
        {
          q: 'Can I bring it back?',
          a: `Yes: Bridge from Ethereum burns YACA there in one transaction and the portal sends it across; a tap on the arrival card mints it privately here, to your account.`,
        },
        linked('How does the everyday bridge work?'),
      ],
    },
    {
      id: 'rules',
      title: 'The rules',
      lede: 'What the portal on Ethereum enforces, one line each; open a row for the picture and the reasons. The contract is immutable: the governance multisig acts only within it.',
      rules: [
        {
          q: 'How much can leave a version?',
          line: `A limit that grows with the mining schedule: ${whole(policy.perHour)} ${symbol} an hour from ${whole(policy.allowance)} at launch, frozen at the upgrade.`,
          diagram: 'exit-limit',
          more: 'Withdrawals below the limit leave now; above it they wait for it to grow. After the upgrade nothing beyond the frozen limit leaves. The limit exists to slow a drain long enough for the multisig to pause.',
        },
        {
          q: 'Who can pause the bridge, and for how long?',
          line: `The governance multisig, within a bound the contract fixes: ${days(policy.pauseMax)} days a call, ${days(policy.pauseBudget)} days per version in all.`,
          diagram: 'pause-budget',
          more: 'A pause holds withdrawals, deposits and forwards; it cannot keep a withdrawal from landing once it lifts, and it takes nothing back. The bound is the trust limit: there is no timelock, so the contract itself caps how long the multisig can hold your coins. Every paused day pushes the version’s last day by a day.',
        },
        {
          q: 'How long after the upgrade can I still claim what left the old version?',
          line: `At least ${days(policy.exitFloor)} days, and always until the next upgrade after that one; every paused day adds a day. Only what the old version proved in time counts.`,
          diagram: 'version-life',
          more: `The ${days(policy.exitFloor)}-day floor is the contract’s guarantee. The next-upgrade condition gives you a whole version’s time when upgrades come fast; in the picture it came later than the floor and sets the day. A withdrawal the old version never proved was undone back onto it, and is lost if it never proves again; a proven one sits on Ethereum and can be claimed until the last day.`,
        },
        {
          q: 'Who may do what?',
          line: 'The governance multisig registers a version once and may pause; anyone claims a withdrawal on Ethereum; a send-ahead is forwarded by its holder or an authorized relayer.',
          diagram: 'who-may',
          more: 'The governance multisig is the Safe named in the deployment record; an authorized relayer is an address it lists. Nothing here lets anyone move a balance that is not theirs.',
        },
        {
          q: 'Why can’t just anyone forward my send-ahead?',
          line: 'Forwarding is one-way and gives up your right to redeem it; only you, or a relayer the multisig authorized, may take that step.',
          diagram: 'forward-rule',
          more: 'The portal always forwards into the live version; your signature names the version you meant, so it cannot be used later for another one. A stranger cannot forward it at all. You can do it yourself from the wallet page, or redeem it on Ethereum instead.',
        },
        {
          q: 'Which bridges are there?',
          line: 'Three: to Ethereum, from Ethereum, and ahead to the next version.',
          diagram: 'three-bridges',
          more: 'A withdrawal is burned privately here and claimed on Ethereum as YACA, public. A deposit is public on Ethereum and claimed privately here with a tap. A send-ahead is burned on the old version, held on Ethereum, forwarded to the new one and claimed there.',
        },
      ],
      questions: [linked('What does Yacana hold?')],
    },
  ] as FaqSection[],
} as const;
