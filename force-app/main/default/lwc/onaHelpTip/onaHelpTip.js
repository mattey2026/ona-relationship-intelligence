/**
 * onaHelpTip — contextual help icon with fixed-position tooltip
 * Renders the tooltip as position:fixed so it escapes all
 * overflow:hidden parent containers in onaRelationshipMap.
 *
 * Usage:
 *   <c-ona-help-tip term="decay-score"></c-ona-help-tip>
 */
import { LightningElement, api, track } from 'lwc';

const TIPS = {
    'contacts': {
        title: 'What are Contacts?',
        body:  'People at this account your team has emailed, met, or logged activity with in Salesforce.',
        tip:   'Log your meetings and emails to improve coverage. ONA is only as good as your CRM data.'
    },
    'relationships': {
        title: 'What are Relationships?',
        body:  'Connections between two contacts who have appeared together in meetings, emails, or on the same deal. The thicker the line, the stronger the connection.',
        tip:   'Focus outreach on contacts with thick connections to your champions — they are the easiest path to new stakeholders.'
    },
    'hubs': {
        title: 'What are Hubs?',
        body:  'Contacts connected to many others at this account. They sit at the centre of the network. Losing a Hub cuts your visibility across multiple departments at once.',
        tip:   'Protect your Hubs. If a Hub contact is going cold, re-engage immediately — they matter more than their title suggests.'
    },
    'clusters': {
        title: 'What are Clusters?',
        body:  'Groups of contacts who mainly talk to each other but have few links to other groups. Think of them as islands — IT might be one cluster, Finance another.',
        tip:   'A contact strong in one cluster rarely helps you in another. Each cluster needs its own relationship-building approach.'
    },
    'influence': {
        title: 'What is Influence Score?',
        body:  'A 0–100 score combining seniority, number of connections, and how recently your team engaged this person. High score means they matter right now — not just on paper.',
        tip:   'High score + Active = your top priority this week. High score + Cooling = your top risk. Check both together.'
    },
    'centrality': {
        title: 'What is Centrality?',
        body:  'How central someone is to the communication network — not just their title, but how many others connect through them at this account.',
        tip:   'A Director with high centrality can matter more than a VP with low centrality. Use this to find the real connectors, not just the title-holders.'
    },
    'decay-score': {
        title: 'What is Decay Score?',
        body:  'A 0–100 freshness score for each relationship. Recent activity counts more than old activity — a contact you met last month scores higher than one you met six months ago, even if total interactions are the same.',
        tip:   '70 and above is Warm (active). 40 to 69 is Cooling (act soon). Below 40 is Cold — time to re-engage before the relationship goes dark.'
    },
    'betweenness': {
        title: 'What is Betweenness?',
        body:  'Identifies contacts who act as bridges between otherwise-separate groups. A Gatekeeper does not need a senior title — they control the flow of information between departments.',
        tip:   'A Gatekeeper going cold is often a higher risk than a VP going cold. Nurture them even if their title looks junior.'
    },
    'velocity': {
        title: 'What is Velocity Trend?',
        body:  'Whether engagement with this contact is speeding up, slowing down, or staying the same — comparing the last 90 days of activity to the 90 days before that.',
        tip:   'Growing arrow means good momentum. Cooling arrow means act now — a contact can still look Warm overall but have a Cooling trend, and that is your earliest warning sign.'
    },
    'coverage-score': {
        title: 'What is Coverage Score?',
        body:  'A 0–100 score showing how broadly your team knows this account — across departments and seniority levels. Are you only talking to Finance? Only to Managers?',
        tip:   'Below 40 means surprises are likely from Legal, IT, or Procurement. Aim to have at least one engaged contact in every major department.'
    },
    'multi-thread': {
        title: 'What is Multi-Thread Risk?',
        body:  'Measures how spread out your relationships are. A score near zero means almost all your activity goes through one person. If they leave, you lose the account relationship overnight.',
        tip:   'If this shows High Risk, deliberately build two or three more relationships now — even if your main contact is happy today.'
    },
    'whitespace': {
        title: 'What are Whitespace Gaps?',
        body:  'Departments at this account where your team has had fewer than three meaningful interactions — blind spots where you have no relationship built yet.',
        tip:   'Whitespace departments are where renewals get blocked and expansions get missed. Use Warm Intro Paths to reach into them through contacts you already know.'
    },
    'warm-intro': {
        title: 'What is a Warm Intro Path?',
        body:  'A suggested route to reach someone you do not know — through people you already have a relationship with. For example: You, then Lena, then Marcus, where Lena knows both.',
        tip:   'Always check for a warm path before sending a cold LinkedIn message. Ask the bridge contact directly — a warm intro has three to five times higher response rates.'
    },
    'relationship-strength': {
        title: 'What is Relationship Strength?',
        body:  'A 0–100 score showing how broadly and actively your team is engaged across this account — measured across departments, seniority levels, and CRM interaction frequency.',
        tip:   'Below 40 means you are exposed — surprises from Procurement, Legal, or IT are likely. Above 70 means you have solid multi-department presence and can move to expansion plays.'
    },
    'annual-revenue': {
        title: 'Annual Revenue',
        body:  'The account\'s reported annual revenue from the Salesforce Account record. Used to size the opportunity and prioritise ABM investment — higher revenue accounts with low relationship strength are your highest-priority targets.',
        tip:   'Focus ABM spend on the top-left quadrant of the bubble chart: high revenue, low relationship strength. These accounts have the most to gain from a targeted relationship-building play.'
    },
    'open-pipeline': {
        title: 'Open Pipeline',
        body:  'The total value of all open (non-closed) Opportunities linked to this account in Salesforce. Accounts with open pipeline and low relationship strength are at the highest risk of losing the deal due to poor stakeholder coverage.',
        tip:   'If an account has open pipeline but a Coverage Score below 50, that deal is at risk. Use the relationship map to identify who else in the buying committee you should be engaging right now.'
    }
};

const TIP_W = 270;
const TIP_H = 180; // estimated max height
const PAD   = 10;  // gap between button and tooltip

export default class OnaHelpTip extends LightningElement {
    @api term = '';
    @track visible  = false;
    @track portalStyle = '';

    _hideTimer = null;

    get title()     { return TIPS[this.term]?.title || this.term; }
    get body()      { return TIPS[this.term]?.body  || ''; }
    get sellerTip() { return TIPS[this.term]?.tip   || ''; }
    get ariaLabel() { return `Help: ${this.title}`; }

    handleShow() {
        clearTimeout(this._hideTimer);
        this._calcPosition();
        this.visible = true;
    }

    handleHide() {
        // Small delay so moving mouse to tooltip itself keeps it open
        this._hideTimer = setTimeout(() => { this.visible = false; }, 120);
    }

    _calcPosition() {
        const btn = this.refs.btn;
        if (!btn) return;

        const r   = btn.getBoundingClientRect();
        const vw  = window.innerWidth;
        const vh  = window.innerHeight;

        // Prefer right; flip left if not enough room
        let left = r.right + PAD;
        if (left + TIP_W > vw - PAD) {
            left = r.left - TIP_W - PAD;
        }
        if (left < PAD) left = PAD;

        // Vertically centre on the button; nudge up if it would overflow
        let top = r.top + (r.height / 2) - (TIP_H / 2);
        if (top + TIP_H > vh - PAD) top = vh - TIP_H - PAD;
        if (top < PAD) top = PAD;

        this.portalStyle =
            `position:fixed;` +
            `left:${Math.round(left)}px;` +
            `top:${Math.round(top)}px;` +
            `width:${TIP_W}px;` +
            `z-index:9999;`;
    }
}
