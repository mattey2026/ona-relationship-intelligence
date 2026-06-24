/**
 * ============================================================
 * ONA Relationship Intelligence — Version 4.1
 * ============================================================
 * Author      : Sumit Mattey
 * Organisation: Genpact — Salesforce Practice
 * GitHub      : https://github.com/mattey2026/ona-relationship-intelligence
 * Updated     : 04 June 2026
 * ------------------------------------------------------------
 * LWC Component: onaRelationshipMap
 * Description :
 *   Lightning Web Component powering the full ONA UI —
 *   D3 force-directed graph, Analytics pane (Timeline, Power
 *   Map, Impact Simulator, Risk Radar), Portfolio View,
 *   Relationship Summary Bell Popup, Contact Insight Panel,
 *   and 14-step guided tour.
 * ============================================================
 */
import { LightningElement, track, api } from 'lwc';
import { loadScript }      from 'lightning/platformResourceLoader';
import { ShowToastEvent }  from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import D3 from '@salesforce/resourceUrl/d3';

import getAccountGraph      from '@salesforce/apex/ONAController.getAccountGraph';
import getScoreTrend        from '@salesforce/apex/ONAScoreHistoryController.getTrend';
import getCrossAccountGraph from '@salesforce/apex/ONAController.getCrossAccountGraph';
import getContactInsight    from '@salesforce/apex/ONAController.getContactInsight';
import getAccountNews       from '@salesforce/apex/ONAController.getAccountNews';
import getABMBubbleData    from '@salesforce/apex/ONAController.getABMBubbleData';
import searchAccounts               from '@salesforce/apex/ONAController.searchAccounts';
import searchAccountsAndContacts   from '@salesforce/apex/ONAController.searchAccountsAndContacts';

import getRecentCampaigns    from '@salesforce/apex/ONACampaignController.getRecentCampaigns';
import createCampaign        from '@salesforce/apex/ONACampaignController.createCampaign';
import addContactsToCampaign from '@salesforce/apex/ONACampaignController.addContactsToCampaign';

const PAL = {
    light: { hub:'#b45309', connector:'#0369a1', bridge:'#4338ca', low:'#94a3b8', hl:'#b45309', lbl:'rgba(15,23,42,.70)' },
    dark:  { hub:'#f0b429', connector:'#38bdf8', bridge:'#818cf8', low:'#64748b', hl:'#f0b429', lbl:'rgba(200,215,235,.80)' }
};
const VEL_COLORS = {
    Growing: { color:'#059669', bg:'#dcfce7' },
    Cooling:  { color:'#dc2626', bg:'#fee2e2' },
    Stable:   { color:'#94a3b8', bg:'#f1f5f9' }
};
const COUNTRY_NAMES = {
    US:'United States',UK:'United Kingdom',IN:'India',SG:'Singapore',
    AU:'Australia',DE:'Germany',AE:'UAE',CA:'Canada',JP:'Japan',
    CN:'China',HK:'Hong Kong',FR:'France',NL:'Netherlands'
};

const GUIDE_STEPS = [
    {
        title: 'Welcome to ONA Relationship Intelligence',
        body:  'ONA maps the real communication network inside your Salesforce accounts using 11 graph algorithms. See who knows whom, which relationships are cooling, where your coverage gaps are — and which champions are going quiet before it becomes a deal risk. All from CRM data already in your org.',
        tip:   'This tour covers every view and feature built to date. Use the arrow buttons or keyboard to navigate.',
        zone:  null
    },
    {
        title: 'Five Ways to Explore',
        body:  'The view selector switches between: Network Map (single account graph), Cross-Account (multiple accounts with bridge contacts), Portfolio View (health scores across your territory), Analytics (four advanced sub-views: Timeline, Power Map, Impact Simulator, Risk Radar), and Compare (side-by-side account intelligence).',
        tip:   'Start with Network Map for any account, then use Portfolio View to spot which accounts need the most attention this week.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Search — Accounts and Contacts Together',
        body:  'One search box finds both accounts and contacts simultaneously. Selecting an account loads its full relationship network. Selecting a contact loads their account graph and automatically zooms in to spotlight that person — fading all others so you can instantly see their scores, connections and team interactions.',
        tip:   'Contact rows show a blue left border in the dropdown to distinguish them from accounts.',
        isNew: 'Search now covers both accounts and contacts — one box, two result types.',
        zone:  '.ona-search-wrap'
    },
    {
        title: 'Smart Filters — Dynamic and Combinable',
        body:  'Filter chips populate automatically from the loaded account data. Only countries, regions and departments that actually exist appear. Filters combine — select India + Engineering to isolate just that segment. Clears automatically on every new account load.',
        isNew: 'Filters update the graph instantly without an Apex callout.',
        zone:  '.ona-filter-chips'
    },
    {
        title: 'Network Metrics',
        body:  'Four live counts: Contacts mapped, Relationship edges (shared CRM activity), Hub nodes (centrality above 70), and Clusters (separate buying groups detected by the Union-Find algorithm). Hover the ? icon next to each term for a plain-English explanation of what it means and what action to take.',
        isNew: 'Help tips: every technical term now has a ? icon. Hover it to see a seller-friendly explanation plus a specific action tip.',
        zone:  '.ona-kgrid'
    },
    {
        title: 'Account Intelligence — Coverage, Multi-Thread and Whitespace',
        body:  'Coverage Score measures how broadly your team is engaged across departments and seniority levels. Multi-Thread Risk shows how concentrated your activity is — low score means one contact controls everything. Whitespace lists departments with fewer than three meaningful interactions. Trend lines under each score show how they have changed over recent weeks.',
        isNew: 'Score History Trending: Coverage and Multi-Thread now show a trend line (e.g. ↑ +13% vs 3 months ago) powered by a nightly snapshot job. Green = improving, red = declining.',
        zone:  '.ona-lps'
    },
    {
        title: 'Q1–Q5 Insight Filters',
        body:  'Five one-click highlight modes that fade irrelevant contacts. Q1 shows all connections. Q2 highlights the most influential. Q3 highlights communication hubs. Q4 surfaces high-value contacts not yet reached. Q5 — the most powerful — highlights only contacts with growing engagement momentum right now.',
        tip:   'Use Q5 at the start of every account review to immediately see who is gaining momentum and who is fading.',
        isNew: 'Q5 Velocity: compares last 90 days vs prior 90 days of CRM activity. Green = growing.',
        zone:  '.ona-lps'
    },
    {
        title: 'The Relationship Graph',
        body:  'Gold nodes with a glow ring are Hubs — the information brokers who connect otherwise separate groups. Blue are Connectors. Grey are Low Engagement contacts. The arrow below each name shows velocity. Edge thickness shows relationship strength. Drag nodes to reposition, scroll to zoom, click canvas to reset highlights.',
        tip:   'Thick gold edge = Strong (15+ shared interactions). Dashed edge = Weak connection.',
        zone:  '.ona-garea'
    },
    {
        title: '⚠ Champion Risk — Early Warning on Nodes',
        body:  'A pulsing red ring and small ⚠ badge on a contact node means that person is a Champion Risk — they are in the top tier of influence for this account but their engagement is now cooling. This signal typically appears 60–90 days before it shows up as a visible pipeline problem.',
        tip:   'Hover a flagged node to see the exact reason in the tooltip. No Task is created — this signal lives only inside ONA so your activity log stays clean.',
        isNew: 'Champion Risk is computed live on every graph load using relative influence ranking (top 40% per account), so it self-calibrates regardless of account size.',
        zone:  '.ona-garea'
    },
    {
        title: 'Data Completeness Badges',
        body:  'A small badge appears on the top-right corner of each node. Green ✓ means Phone or Mobile, Email, and Title are all on file. Amber ! means some details are missing. No badge means the contact record has none of these fields. Contacts with incomplete data produce less reliable ONA scores — the badge is a quick trust signal.',
        tip:   'Click any node to see exactly which fields are present or missing in the Contact Details section of the insight panel.',
        isNew: 'Completeness is checked live against the Salesforce contact record each time the graph loads.',
        zone:  '.ona-garea'
    },
    {
        title: 'Contact Insight Panel — Full Details on Click',
        body:  'Clicking any node opens the right panel. Contact Details at the top shows Phone, Mobile, Email and Title — click any card to copy the value to clipboard instantly. Below that: four ONA score cards (Influence, Centrality, Decay Score, Betweenness), Velocity Trend, Warm Introduction Paths, Activity Timeline, and Next Engagement Recommendations.',
        tip:   'The colour-coded strip above the contact cards shows data quality at a glance: green = complete, amber = partial, grey = nothing on file.',
        isNew: 'Contact Details redesigned as icon cards (📞 📱 📧 💼) with click-to-copy. Values come directly from the live Salesforce contact record.',
        zone:  '.ona-rpanel'
    },
    {
        title: 'Team Interactions on Nodes',
        body:  'Hover any node to see a tooltip showing ONA scores plus Team Interactions — which sellers from your org have contacted this person, how many times, and when their last interaction was. Colour-coded dots show recency: green = within 30 days, amber = 31–90 days, red = over 90 days.',
        tip:   'If multiple sellers are engaging the same contact without knowing it, Team Interactions makes that visible immediately.',
        isNew: 'Powered by Task and Event OwnerId data already in Salesforce — pre-loaded with the graph, zero extra callouts.',
        zone:  '.ona-garea'
    },
    {
        title: 'Add to Campaign — From the Header',
        body:  'Click the 📢 icon next to the Bell in the header to open the Campaign panel. It slides in from the right without covering the graph. Cooling, Cold and Dark contacts are auto-selected instantly. Use the filter chips to refine, then add directly to an existing Salesforce Campaign or create a new one inline.',
        tip:   'The Add button shows the live contact count so you always know exactly how many people you are targeting before committing.',
        isNew: 'Campaign Creator v2: moved from the Analytics tab to a header icon — the network map stays visible behind the panel the whole time.',
        zone:  '.ona-garea'
    },
    {
        title: 'Analytics — Timeline Slider',
        body:  'The Timeline view in Analytics replays how the account network evolved over the past 6 months. Drag the slider left to see the network as it was months ago. Coverage Score and edge count update live so you can see when engagement started growing or declining.',
        isNew: 'The slider simulates historical network state using activity timestamps already in your CRM data.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Analytics — Power Map',
        body:  'Power Map positions contacts by seniority — C-Level at top, VP/Director below, Manager, then Individual Contributors. Node size reflects the metric you choose (Influence, Centrality or Betweenness). Colour shows Velocity, node type or seniority.',
        tip:   'Set Size to Influence and Colour to Velocity to instantly see your most influential growing contacts.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Analytics — Impact Simulator',
        body:  'Select any contact and simulate what happens when they leave or go unresponsive. The graph redraws without them. The panel shows before-and-after: Coverage Score, Multi-Thread Risk, edges removed, and which contacts become isolated. Hub nodes trigger a high-risk warning.',
        tip:   'Use this before renewals or QBRs to answer: if my champion leaves, what breaks?',
        isNew: 'This answers the question your leadership will ask six months after the churn — ask it now instead.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Analytics — Risk Radar',
        body:  'Risk Radar overlays risk signals on the network graph. At-risk contacts glow with a coloured ring at full opacity while others fade. Filter by: Single-point-of-failure (controls 35%+ of activity), Relationship Decay (score below 35), or Dark contacts (zero logged CRM interactions).',
        tip:   'Click any highlighted node to jump to its entry in the risk list on the right.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Portfolio View — Territory Health at a Glance',
        body:  'Portfolio View ranks all your accounts by Coverage Score with dual progress bars per row. Click any account to see full health detail, top contacts by influence, and live external news signals — partnerships, acquisitions, leadership changes fetched from GNews.',
        tip:   'Use Portfolio View at the start of every weekly review to instantly spot which accounts have the lowest coverage and the highest risk.',
        isNew: 'The Relationship Summary bell icon gives a consolidated popup of any loaded account without leaving the current view.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Compare View — Side-by-Side Account Intelligence',
        body:  'Compare lets you select any two accounts and see their relationship health side by side. Six sections run in parallel: Network Size, Relationship Scores (Coverage and Multi-Thread with a Winner badge), Engagement Velocity breakdown, Top Influencers, and Risk Signals. The healthier account gets a gold border.',
        tip:   'Use Compare before a QBR to show which accounts need the most relationship investment this quarter.',
        isNew: 'Loads live data from both accounts simultaneously — no pre-configuration needed.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Score History — Trends Build Nightly',
        body:  'ONA runs a nightly snapshot job that records each account\'s Coverage Score, Multi-Thread Risk, contact count, average Decay Score, whitespace gaps and cooling contact count. These snapshots power the trend lines under Account Intelligence. The longer ONA runs, the more meaningful the trends become.',
        tip:   'Check back after a few weeks — you will start seeing which accounts are quietly improving their relationship health and which are silently declining.',
        isNew: 'All snapshots stored in the ONA Score History custom object. Nightly scheduler runs at 2 AM and is already active in your org.',
        zone:  null
    },
];


export default class OnaRelationshipMap extends NavigationMixin(LightningElement) {

    @api recordId;

    // UI state
    @track isDark         = false;
    @track isLoading      = false;
    @track showEmpty      = true;
    @track hasError       = false;
    @track errorMsg       = '';
    @track loadingInsight = false;

    // Mode: 'account' | 'global' | 'portfolio'
    @track mode     = 'account';
    @track industry = '';
    @track hlMode   = 'connections';

    // Search
    @track searchTerm          = '';
    @track searchResults       = [];   // unified account+contact results
    _contactToHighlight        = null; // contactId to focus after account loads
    @track accountResults = [];
    @track showDropdown   = false;
    @track selectedAcctId;

    // Stats
    @track stats = { totalContacts:0, totalEdges:0, hubCount:0, clusterCount:0 };

    // Account Intelligence
    @track accountIntel  = null;
    @track whitespace    = [];

    // Filters
    @track filterCountry   = '';
    @track filterRegion    = '';
    @track filterDept      = '';
    @track filterSeniority = '';
    @track filterStrength  = '';
    @track filterCountries = [];
    @track filterRegions   = [];
    @track filterDepts     = [];
    @track filterCountLabel = '';

    // Tooltip
    @track tipVisible = false;
    @track tip = { name:'', role:'', acct:'', inf:0, cen:0, btw:0, con:0, velArrow:'→', velLabel:'Stable', velStyle:'' };

    // Connection sidebar
    @track connNodeName = '';
    @track connList     = [];

    // Right panel
    @track panelOpen    = false;
    @track contact      = {};
    @track timeline     = [];
    @track recos        = [];
    @track introPaths   = [];

    // Portfolio view
    @track portfolioAccounts  = [];
    @track portSubTab         = 'list'; // 'list' | 'abm'
    @track portfolioStats     = { total:0, atRisk:0, healthy:0 };
    @track selectedAccount    = null;
    @track hasPortfolioSelected = false;

    // News signals
    @track accountNews  = [];
    @track newsLoading  = false;

    // Account Comparison
    @track compareSearchA  = '';
    @track compareSearchB  = '';
    @track cmpDropA        = [];
    @track cmpDropB        = [];
    @track hasCmpResults   = false;
    @track cmpResults      = {};
    _cmpDataA = null;
    _cmpDataB = null;

    // Last Activity Badge (v4.1)
    @track showLastActivity = false;

    // Summary popup
    @track summaryOpen   = false;
    @track summaryHasData= false;
    @track summaryData   = {};
    @track bellDot       = false;

    // Analytics
    @track analyticsTab    = 'timeline';
    @track timelineValue   = 5;
    @track timelineLabel   = 'Today';
    @track timelineStats   = { contacts:0, edges:0, cov:0, covStyle:'' };
    @track pmSizeBy        = 'influence';
    @track pmColourBy      = 'velocity';
    @track cascadeHint      = 'Select a contact above to simulate what happens when they leave or become unresponsive.';
    @track cascadeSelected  = false;
    @track cascadeBefore    = { cov:0, mt:0, contacts:0, edges:0 };
    @track cascadeAfter     = { cov:0, mt:0, contacts:0, edges:0 };
    @track cascadeCovDelta  = 0;
    @track cascadeMtDelta   = 0;
    @track cascadeEdgeDelta = 0;
    @track cascadeIsolated  = [];
    @track cascadeImpact    = '';
    @track cascadeIsHub     = false;
    @track hasCascadeIsolated = false;
    @track riskType        = 'all';
    @track riskItems       = [];
    @track riskSummary     = '';

    // Guide
    @track guideOpen = false;
    @track guideStep = 0;


    // Score History Trend
    @track trendComparison = null;
    @track trendPoints     = [];

    // ABM Intelligence (v4.7)
    @track abmLoading       = false;
    @track abmAccounts      = [];
    @track abmSelected      = null;
    @track abmStats         = { total:0, ready:0, warming:0, atRisk:0, champRisk:0 };
    @track abmTipVisible    = false;
    @track abmTip           = {};
    _abmRendered            = false;

    // Campaign Creator
    @track campPanelOpen        = false;
    @track campMode             = 'existing';
    @track campSelectedIds      = [];
    @track campSelectedContacts = [];
    @track existingCampaigns    = [];
    @track campLoading          = false;
    @track campPickedId         = '';
    @track campPickedName       = '';
    @track newCampName          = '';
    @track newCampType          = 'Email';
    @track newCampStart         = '';
    @track newCampEnd           = '';
    @track campMemberStatus     = 'Sent';
    @track campLastAdded        = '';
    @track campLastId           = '';
    @track campDot              = false;
    @track campAutoLabel        = '';
    @track campActiveChips      = [];
    _campNodeSel                = null;

    // Private D3 refs
    _d3Loaded    = false;
    _sim         = null;
    _zoom        = null;
    _portZoom    = null;
    _gMain       = null;
    _edgeSel     = null;
    _nodeSel     = null;
    _nodeData    = [];
    _linkData    = [];
    _nodes       = [];
    _edges       = [];
    _graphJson   = null;
    _searchTimer = null;
    _allNodes    = []; // unfiltered
    _allEdges    = []; // unfiltered

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    connectedCallback() {
        loadScript(this, D3)
            .then(() => {
                this._d3Loaded = true;
                if (this.recordId) { this.selectedAcctId = this.recordId; this._load(); }
            })
            .catch(e => this._err('D3 failed to load: ' + e.message));
    }
    disconnectedCallback() { if (this._sim) this._sim.stop(); }

    // ── Computed getters ──────────────────────────────────────────────────────
    get appClass()        { return 'ona-app' + (this.isDark ? ' dark' : ''); }
    get themeIcon()       { return this.isDark ? '☀' : '☾'; }
    get isGlobal()        { return this.mode === 'global'; }
    get isNetworkMode()   { return this.mode === 'account' || this.mode === 'global'; }
    // Compare mode is handled separately via isCompareMode getter
    get hasAccountLoaded() { return !!(this._allNodes && this._allNodes.length > 0); }
    get isPortfolioMode() { return this.mode === 'portfolio'; }
    get hasResults()      { return this.accountResults.length > 0; }
    get hasConnections()  { return this.connList.length > 0; }
    get hasTimeline()     { return this.timeline.length > 0; }
    get hasRecos()        { return this.recos.length > 0; }
    get hasIntroPaths()   { return this.introPaths.length > 0; }
    get hasAccountIntel() { return this.accountIntel !== null; }
    get hasActiveFilters(){ return !!(this.filterCountry||this.filterRegion||this.filterDept||this.filterSeniority||this.filterStrength); }

    get accCardClass() { return 'ona-vc-btn' + (this.mode==='account'?' on':''); }
    get glbCardClass() { return 'ona-vc-btn' + (this.mode==='global' ?' on':''); }
    get portCardClass()       { return 'ona-vc-btn' + (this.mode==='portfolio'?' on':''); }
    get analyticsCardClass()  { return 'ona-vc-btn' + (this.mode==='analytics'?' on':''); }
    get compareCardClass()    { return 'ona-vc-btn' + (this.mode==='compare' ?' on':''); }
    get portTabListClass()    { return 'ona-port-tab' + (this.portSubTab==='list'?' on':''); }
    get portTabABMClass()     { return 'ona-port-tab' + (this.portSubTab==='abm'?' on':''); }
    get portTabIslist()       { return this.portSubTab === 'list'; }
    get portTabIsABM()        { return this.portSubTab === 'abm'; }
    get abmTipClass()         { return 'ona-abm-tip' + (this.abmTipVisible?' v':''); }

    get isCompareMode()       { return this.mode === 'compare'; }
    get hasCmpDropA()         { return this.cmpDropA.length > 0; }
    get hasCmpDropB()         { return this.cmpDropB.length > 0; }
    get isAnalyticsMode()     { return this.mode === 'analytics'; }
    get analyticsAcctLabel()  { return this._allNodes.length ? `Account: ${this.searchTerm||'Loaded'}` : 'Load an account in Network Map first'; }
    get anIsTimeline()  { return this.analyticsTab==='timeline'; }
    get anIsPowermap()  { return this.analyticsTab==='powermap'; }
    get anIsCascade()   { return this.analyticsTab==='cascade'; }
    get anIsRisk()      { return this.analyticsTab==='risk'; }
    get hasRiskItems()  { return this.riskItems.length > 0; }
    get cascadeCovDeltaStyle()  { return this.cascadeCovDelta<0?'background:#fee2e2;color:#991b1b;font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px':this.cascadeCovDelta>0?'background:#dcfce7;color:#15803d;font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px':'display:none'; }
    get cascadeMtDeltaStyle()   { return this.cascadeMtDelta<0?'background:#fee2e2;color:#991b1b;font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px':this.cascadeMtDelta>0?'background:#dcfce7;color:#15803d;font-size:9px;font-weight:600;padding:1px 5px;border-radius:4px':'display:none'; }
    get cascadeCovDeltaLabel()  { return (this.cascadeCovDelta>0?'+':'')+this.cascadeCovDelta+'%'; }
    get cascadeMtDeltaLabel()   { return (this.cascadeMtDelta>0?'+':'')+this.cascadeMtDelta+'%'; }
    get cascadeEdgeDeltaLabel() { return (this.cascadeEdgeDelta>0?'+':'')+this.cascadeEdgeDelta; }
    get cascadeImpactStyle()    { return this.cascadeIsHub?'color:#dc2626;font-weight:600':'color:var(--t2)'; }
    get anTabTimeline() { return 'ona-an-navbtn'+(this.analyticsTab==='timeline'?' on':''); }
    get anTabPowermap() { return 'ona-an-navbtn'+(this.analyticsTab==='powermap'?' on':''); }
    get anTabCascade()  { return 'ona-an-navbtn'+(this.analyticsTab==='cascade' ?' on':''); }
    get anTabRisk()     { return 'ona-an-navbtn'+(this.analyticsTab==='risk'    ?' on':''); }
    get anTabCampaign() { return 'ona-an-navbtn'+(this.analyticsTab==='campaign'?' on':''); }
    get anIsCampaign()       { return this.analyticsTab==='campaign'; }
    get hasCampaignGraphData(){ return !!(this._allNodes && this._allNodes.length > 0); }
    get hasCampSelected()      { return this.campSelectedContacts.length > 0; }

    // Score History Trend getters
    get trendHasHistory() { return !!(this.trendComparison && this.trendComparison.hasHistory); }

    get covTrendLabel() {
        if (!this.trendHasHistory) return '';
        const d = this.trendComparison.coverageDelta;
        const sign = d > 0 ? '+' : '';
        const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
        return `${arrow} ${sign}${d}% vs ${this.trendComparison.comparisonLabel}`;
    }
    get covTrendClass() {
        if (!this.trendHasHistory) return 'ona-trend-line';
        const d = this.trendComparison.coverageDelta;
        return 'ona-trend-line ' + (d > 0 ? 'ona-trend-up' : d < 0 ? 'ona-trend-down' : 'ona-trend-flat');
    }

    get mtTrendLabel() {
        if (!this.trendHasHistory) return '';
        const d = this.trendComparison.multiThreadDelta;
        const sign = d > 0 ? '+' : '';
        const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
        return `${arrow} ${sign}${d}% vs ${this.trendComparison.comparisonLabel}`;
    }
    get mtTrendClass() {
        if (!this.trendHasHistory) return 'ona-trend-line';
        const d = this.trendComparison.multiThreadDelta;
        return 'ona-trend-line ' + (d > 0 ? 'ona-trend-up' : d < 0 ? 'ona-trend-down' : 'ona-trend-flat');
    }
    get campModeIsExisting()   { return this.campMode==='existing'; }
    get campModeIsNew()        { return this.campMode==='new'; }
    get campModeExistingClass(){ return 'ona-camp-mode-btn'+(this.campMode==='existing'?' on':''); }
    get campModeNewClass()     { return 'ona-camp-mode-btn'+(this.campMode==='new'?' on':''); }
    get campAddDisabled()      { if(!this.hasCampSelected) return true; if(this.campMode==='existing'&&!this.campPickedId) return true; if(this.campMode==='new'&&!this.newCampName.trim()) return true; return false; }
    get campSelCountLabel()    { const n=this.campSelectedContacts.length; return n>0?`${n} contact${n===1?'':'s'}`:'0 contacts'; }
    get campStatusSent()      { return 'ona-camp-status-btn'+(this.campMemberStatus==='Sent'?' on':''); }
    get campStatusResponded() { return 'ona-camp-status-btn'+(this.campMemberStatus==='Responded'?' on':''); }
    get campStatusPlanned()   { return 'ona-camp-status-btn'+(this.campMemberStatus==='Planned'?' on':''); }
    get campBtnClass()         { return 'ona-bell-btn'+(this.campPanelOpen?' active':''); }
    get campChipCooling()      { return 'ona-camp-chip'+(this.campActiveChips.includes('cooling')?' on':''); }
    get campChipCold()         { return 'ona-camp-chip'+(this.campActiveChips.includes('cold')?' on':''); }
    get campChipDark()         { return 'ona-camp-chip'+(this.campActiveChips.includes('dark')?' on':''); }
    get panelClass()   { return 'ona-rpanel' + (this.panelOpen?'':' closed'); }
    get tipClass()     { return 'ona-tip' + (this.tipVisible?' v':''); }

    get iq1Class() { return 'ona-iq' + (this.hlMode==='connections'?' on':''); }
    get iq2Class() { return 'ona-iq' + (this.hlMode==='influence'  ?' on':''); }
    get iq3Class() { return 'ona-iq' + (this.hlMode==='centrality' ?' on':''); }
    get iq4Class() { return 'ona-iq' + (this.hlMode==='engage'     ?' on':''); }
    get iq5Class() { return 'ona-iq' + (this.hlMode==='velocity'   ?' on':''); }

    // Filter chip classes
    get countryChipClass()   { return 'ona-fchip' + (this.filterCountry?'  ona-fchip-active':''); }
    get regionChipClass()    { return 'ona-fchip' + (this.filterRegion?' ona-fchip-active':''); }
    get deptChipClass()      { return 'ona-fchip' + (this.filterDept?' ona-fchip-active':''); }
    get seniorityChipClass() { return 'ona-fchip' + (this.filterSeniority?' ona-fchip-active':''); }
    get strengthChipClass()  { return 'ona-fchip' + (this.filterStrength?' ona-fchip-active':''); }

    get pal() { return this.isDark ? PAL.dark : PAL.light; }
    _nc(type) { return this.pal[type] || this.pal.connector; }

    // Account Intelligence styles
    get covBarStyle()   { const s=this.accountIntel?.coverageScore||0; const c=s>=70?'#0369a1':s>=40?'#b45309':'#dc2626'; return `width:${s}%;background:${c}`; }
    get covBadgeStyle() { const b=this.accountIntel?.coverageBadge; if(b==='Good')return'background:#dcfce7;color:#15803d'; if(b==='Moderate')return'background:#fef3c7;color:#92400e'; return'background:#fee2e2;color:#991b1b'; }
    get covDesc()       { const s=this.accountIntel?.coverageScore||0; return s>=70?'Buying committee well covered.':s>=40?'Moderate — broaden engagement.':'Critical stakeholders missing.'; }
    get mtBarStyle()    { const s=this.accountIntel?.multiThreadScore||0; const c=s>=70?'#059669':s>=40?'#b45309':'#dc2626'; return `width:${s}%;background:${c}`; }
    get mtBadgeStyle()  { const b=this.accountIntel?.multiThreadBadge; if(b==='Healthy')return'background:#dcfce7;color:#15803d'; if(b==='Moderate')return'background:#fef3c7;color:#92400e'; return'background:#fee2e2;color:#991b1b'; }
    get mtDesc()        { const s=this.accountIntel?.multiThreadScore||0; return s>=70?'Activity well distributed.':s>=40?'Some concentration — broaden outreach.':'Single-thread risk.'; }

    // Contact styles
    get avStyle()      { const c=this._nc(this.contact.nodeType||'connector'); return `background:${c}20;color:${c};border-color:${c}`; }
    get badgeStyle()   { const map={'Network Hub':'#b45309','Gatekeeper':'#4338ca','Key Influencer':'#0369a1','Active Contact':'#0369a1','Low Engagement':'#94a3b8','Cooling Contact':'#dc2626','Central Communicator':'#0369a1','Cross-Account Bridge':'#4338ca'}; const c=map[this.contact.networkRole]||'#0369a1'; return `background:${c}15;color:${c}`; }

    // ── Data Completeness Badge (v4.5) ───────────────────────────────────────
    get compBadgeClass() {
        const lvl = this.contact.completenessLevel;
        return 'ona-comp-badge ' + (lvl==='complete' ? 'ona-comp-ok' : lvl==='partial' ? 'ona-comp-warn' : 'ona-comp-none');
    }
    get compBadgeIcon() {
        const lvl = this.contact.completenessLevel;
        return lvl==='complete' ? '✓' : lvl==='partial' ? '!' : '';
    }
    get compBadgeTitle() {
        const lvl = this.contact.completenessLevel;
        if (lvl==='complete') return 'Phone/Mobile, Email, and Title are all on file';
        if (lvl==='partial')  return 'Some contact details missing — scores may be less reliable';
        return 'Phone, Email, and Title are all missing for this contact';
    }

    // Contact Details section — shows actual values, greys out + italicises if missing
    get cdPhoneValue()  { return this.contact.phone || 'Not on file'; }
    get cdMobileValue() { return this.contact.mobilePhone || 'Not on file'; }
    get cdEmailValue()  { return this.contact.email || 'Not on file'; }
    get cdTitleValue()  { return this.contact.title || 'Not on file'; }
    get cdPhoneClass()  { return 'ona-cd-cell-val' + (this.contact.phone ? '' : ' ona-cd-missing'); }
    get cdMobileClass() { return 'ona-cd-cell-val' + (this.contact.mobilePhone ? '' : ' ona-cd-missing'); }
    get cdEmailClass()  { return 'ona-cd-cell-val' + (this.contact.email ? '' : ' ona-cd-missing'); }
    get cdTitleClass()  { return 'ona-cd-cell-val' + (this.contact.title ? '' : ' ona-cd-missing'); }

    get cdSummaryClass() {
        const lvl = this.contact.completenessLevel;
        return 'ona-cd-summary ' + (lvl==='complete' ? 'ona-cd-summary-ok' : lvl==='partial' ? 'ona-cd-summary-warn' : 'ona-cd-summary-none');
    }
    get cdSummaryLabel() {
        const lvl = this.contact.completenessLevel;
        const n = this.contact.completenessCount || 0;
        if (lvl==='complete') return '✓ All key fields on file';
        if (lvl==='partial')  return `! ${n} of 3 fields on file — some details missing`;
        return '✕ No contact details on file';
    }

    @track cdCopiedField = '';
    _cdCopyTimer = null;
    handleCopyField(e) {
        const field = e.currentTarget.dataset.field;
        const valueMap = {
            phone:  this.contact.phone,
            mobile: this.contact.mobilePhone,
            email:  this.contact.email,
            title:  this.contact.title
        };
        const val = valueMap[field];
        if (!val) return; // nothing to copy for "Not on file"
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val).catch(()=>{});
        }
        const labelMap = { phone:'Phone', mobile:'Mobile', email:'Email', title:'Title' };
        this.cdCopiedField = labelMap[field];
        clearTimeout(this._cdCopyTimer);
        this._cdCopyTimer = setTimeout(()=>{ this.cdCopiedField = ''; }, 1600);
    }
    get infBarStyle()  { return `width:${this.contact.influenceScore||0}%;background:${this.pal.hub}`; }
    get cenBarStyle()  { return `width:${this.contact.centralityScore||0}%;background:${this.pal.connector}`; }
    get decBarStyle()  { return `width:${this.contact.decayScore||0}%;background:#059669`; }
    get betwBarStyle() { return `width:${this.contact.betweennessScore||0}%;background:#4338ca`; }
    get velBigStyle()  { const v=VEL_COLORS[this.contact.velocityLabel]||VEL_COLORS.Stable; return `color:${v.color}`; }
    get velLabelStyle(){ const v=VEL_COLORS[this.contact.velocityLabel]||VEL_COLORS.Stable; return `color:${v.color}`; }

    // ── Filters ───────────────────────────────────────────────────────────────
    _populateFilterOptions(nodes) {
        const countries = [...new Set(nodes.map(n=>n.country).filter(Boolean))].sort();
        this.filterCountries = countries.map(c=>({ value:c, label:COUNTRY_NAMES[c]||c }));

        const regions = [...new Set(nodes.map(n=>n.region).filter(Boolean))].sort();
        this.filterRegions = regions.map(r=>({ value:r, label:r }));

        const depts = [...new Set(nodes.map(n=>n.department).filter(Boolean))].sort();
        this.filterDepts = depts.map(d=>({ value:d, label:d }));
    }

    _seniorityOf(title) {
        if (!title) return 'ic';
        const t = title.toLowerCase();
        if (t.includes('chief')||t.includes('ceo')||t.includes('cto')||t.includes('cfo')||t.includes('president')) return 'clevel';
        if (t.includes('vice president')||t.includes(' vp')||t.startsWith('vp ')||t.includes('director')||t.includes('head of')) return 'vp';
        if (t.includes('manager')||t.includes('lead')||t.includes('senior')) return 'manager';
        return 'ic';
    }

    _applyFilters() {
        let nodes = [...this._allNodes];
        let edges = [...this._allEdges];
        const f = { country:this.filterCountry, region:this.filterRegion, dept:this.filterDept, seniority:this.filterSeniority, strength:this.filterStrength };

        nodes = nodes.filter(n => {
            if (f.country   && n.country    !== f.country)              return false;
            if (f.region    && n.region     !== f.region)               return false;
            if (f.dept      && n.department !== f.dept)                 return false;
            if (f.seniority && this._seniorityOf(n.title) !== f.seniority) return false;
            return true;
        });

        const visIds = new Set(nodes.map(n=>n.contactId));
        const minStr = f.strength==='strong'?15:f.strength==='medium'?6:2;
        edges = edges.filter(e=>visIds.has(e.sourceId)&&visIds.has(e.targetId)&&e.weight>=minStr);

        const fCount = Object.values(f).filter(Boolean).length;
        this.filterCountLabel = fCount ? `${nodes.length} of ${this._allNodes.length} contacts` : '';

        this._nodes = nodes;
        this._edges = edges;
        this.stats  = {
            totalContacts: nodes.length,
            totalEdges:    edges.length,
            hubCount:      nodes.filter(n=>n.nodeType==='hub').length,
            clusterCount:  [...new Set(nodes.map(n=>n.clusterId))].length
        };
        this._render();
        this._applyHL(this.hlMode);
    }

    handleFilterCountry(e)   { this.filterCountry   = e.target.value; this._applyFilters(); }
    handleFilterRegion(e)    { this.filterRegion    = e.target.value; this._applyFilters(); }
    handleFilterDept(e)      { this.filterDept      = e.target.value; this._applyFilters(); }
    handleFilterSeniority(e) { this.filterSeniority = e.target.value; this._applyFilters(); }
    handleFilterStrength(e)  { this.filterStrength  = e.target.value; this._applyFilters(); }
    handleClearFilters()     {
        this.filterCountry=this.filterRegion=this.filterDept=this.filterSeniority=this.filterStrength='';
        this.filterCountLabel='';
        this._nodes=[...this._allNodes]; this._edges=[...this._allEdges];
        this.stats={ totalContacts:this._allNodes.length, totalEdges:this._allEdges.length,
            hubCount:this._allNodes.filter(n=>n.nodeType==='hub').length,
            clusterCount:[...new Set(this._allNodes.map(n=>n.clusterId))].length };
        this._render(); this._applyHL(this.hlMode);
    }

    // ── Data load ─────────────────────────────────────────────────────────────
    async _load() {
        if (!this._d3Loaded) return;
        this.isLoading=true; this.hasError=false; this.showEmpty=false;
        this.panelOpen=false; this.connList=[]; this.accountIntel=null;
        // Reset filters and highlight mode so all contacts are visible on new load
        this.filterCountry=this.filterRegion=this.filterDept=this.filterSeniority=this.filterStrength='';
        this.filterCountLabel='';
        this.hlMode='connections';
        try {
            let json;
            if (this.mode==='account' && this.selectedAcctId)
                json = await getAccountGraph({ accountId: this.selectedAcctId });
            else if (this.mode==='global')
                json = await getCrossAccountGraph({ industry: this.industry||null, anchorId: this.selectedAcctId||null });
            else { this.showEmpty=true; this.isLoading=false; return; }

            const p = JSON.parse(json);
            this._graphJson = json;
            this._allNodes  = p.nodes || [];
            this._allEdges  = p.edges || [];
            this._nodes     = [...this._allNodes];
            this._edges     = [...this._allEdges];
            this.stats      = { totalContacts:p.totalContacts||0, totalEdges:p.totalEdges||0, hubCount:p.hubCount||0, clusterCount:p.clusterCount||0 };

            if (p.accountIntel) {
                this.accountIntel = p.accountIntel;
                this.whitespace = (p.accountIntel.whitespace||[]).map(w=>({
                    ...w,
                    statusLabel: w.engaged?'Engaged':'Gap',
                    statusStyle: w.engaged?'background:#dcfce7;color:#15803d':'background:#fee2e2;color:#991b1b'
                }));
            }

            // Fetch score history trend (non-blocking — failure here should
            // never break the main graph load)
            if (this.mode==='account' && this.selectedAcctId) {
                this._loadScoreTrend(this.selectedAcctId);
            }

            // Populate dynamic filter dropdowns
            this._populateFilterOptions(this._allNodes);
            // Populate portfolio accounts
            this._buildPortfolioAccounts(p);

            this._render();
            this._applyHL(this.hlMode);
            this.bellDot = true;
            if(this.summaryOpen) this._buildSummary();
            if(this._pendingHandoverPack) {
                this._pendingHandoverPack = false;
                setTimeout(() => this._openHandoverPack(this._allNodes, this._allEdges, this._accountIntel, this.searchTerm, this.isDark), 300);
            }
            // Highlight contact if selected from search
            if(this._contactToHighlight) {
                setTimeout(() => this._highlightContact(this._contactToHighlight), 600);
            }
        } catch(e) {
            this._err(e.body ? e.body.message : e.message);
        } finally {
            this.isLoading = false;
        }
    }

    // ── D3 render ─────────────────────────────────────────────────────────────
    _render() {
        const cont = this.refs.svgContainer;
        if (!cont || !window.d3) return;
        if (this._sim) this._sim.stop();
        cont.innerHTML = '';
        const d3 = window.d3;
        const W = cont.clientWidth||900, H = cont.clientHeight||600;
        const pal = this.pal;

        const svg = d3.select(cont).append('svg').attr('width','100%').attr('height','100%');
        this._zoom = d3.zoom().scaleExtent([.15,3.5]).on('zoom',e=>this._gMain.attr('transform',e.transform));
        svg.call(this._zoom).on('click',()=>{ this._clearHL(); this.closePanel(); });
        this._gMain = svg.append('g');

        const nodes = this._nodes.map(n=>({...n, x:W/2+(Math.random()-.5)*160, y:H/2+(Math.random()-.5)*160}));
        const links = this._edges.map(e=>({...e, source:e.sourceId, target:e.targetId}));

        const clusterIds = [...new Set(nodes.map(n=>n.clusterId))];
        const spread = Math.min(W,H)*0.22;
        const clusterPos = {};
        clusterIds.forEach((cid,i)=>{
            const angle = (2*Math.PI*i)/clusterIds.length - Math.PI/2;
            clusterPos[cid] = { x:W/2+spread*Math.cos(angle), y:H/2+spread*Math.sin(angle) };
        });

        this._sim = d3.forceSimulation(nodes)
            .force('link',d3.forceLink(links).id(d=>d.contactId).distance(d=>d.weight>=15?45:d.weight>=6?70:100).strength(d=>d.weight>=15?1.0:d.weight>=6?.7:.4))
            .force('charge',d3.forceManyBody().strength(-180).distanceMax(220))
            .force('center',d3.forceCenter(W/2,H/2).strength(0.08))
            .force('clusterX',d3.forceX(d=>(clusterPos[d.clusterId]||{x:W/2}).x).strength(0.12))
            .force('clusterY',d3.forceY(d=>(clusterPos[d.clusterId]||{y:H/2}).y).strength(0.12))
            .force('collision',d3.forceCollide().radius(d=>d.nodeType==='hub'?38:28).strength(0.85))
            .alphaDecay(0.028).velocityDecay(0.45);

        const dk = this.isDark;
        this._edgeSel = this._gMain.append('g').selectAll('line').data(links).enter().append('line')
            .attr('stroke',d=>d.weight>=15?(dk?'#d4a840':'#b45309'):d.weight>=6?'#4a7fa8':(dk?'#3a4a5c':'#b0bec5'))
            .attr('stroke-width',d=>d.weight>=15?3:d.weight>=6?1.8:1.2)
            .attr('stroke-opacity',d=>d.weight>=15?.85:d.weight>=6?.65:.40)
            .attr('stroke-dasharray',d=>d.weight<6?'5,4':null);

        const nr = d=>d.nodeType==='hub'?25:d.nodeType==='low'?14:19;
        const nc = d=>this._nc(d.nodeType);

        this._nodeSel = this._gMain.append('g').selectAll('g').data(nodes).enter().append('g')
            .style('cursor','pointer')
            .call(d3.drag()
                .on('start',(e,d)=>{ if(!e.active) this._sim.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
                .on('drag', (e,d)=>{ d.fx=e.x; d.fy=e.y; })
                .on('end',  (e,d)=>{ if(!e.active) this._sim.alphaTarget(0); d.fx=null; d.fy=null; }))
            .on('click',    (e,d)=>{ e.stopPropagation(); this._nodeClick(d,links,nodes); })
            .on('mouseover',(e,d)=>this._showTip(e,d))
            .on('mousemove', e=>this._moveTip(e))
            .on('mouseleave',()=>this._hideTip());

        this._nodeSel.filter(d=>d.nodeType==='hub').append('circle')
            .attr('r',d=>nr(d)+9).attr('fill','none').attr('stroke',nc).attr('stroke-width',1).attr('opacity',.35);
        this._nodeSel.append('circle').attr('class','_nc')
            .attr('r',nr).attr('fill',d=>nc(d)+(dk?'28':'22')).attr('stroke',nc)
            .attr('stroke-width',d=>d.nodeType==='hub'?2.5:2);
        this._nodeSel.append('text').attr('class','_ni')
            .attr('text-anchor','middle').attr('dominant-baseline','central')
            .attr('font-family','sans-serif').attr('font-size',d=>d.nodeType==='hub'?13:11)
            .attr('font-weight','700').attr('fill',nc).text(d=>d.initials||'');
        this._nodeSel.append('text').attr('class','_nl')
            .attr('text-anchor','middle').attr('dy',d=>nr(d)+13)
            .attr('font-family','sans-serif').attr('font-size','11').attr('font-weight','500')
            .attr('fill',pal.lbl).text(d=>(d.name||'').split(' ')[0]);
        const velColor = d=>{ const vc=VEL_COLORS[d.velocityLabel]||VEL_COLORS.Stable; return vc.color; };
        this._nodeSel.append('text').attr('class','_nv')
            .attr('text-anchor','middle').attr('dy',d=>nr(d)+26)
            .attr('font-family','sans-serif').attr('font-size','12').attr('font-weight','700')
            .attr('fill',velColor).text(d=>d.velocityArrow||'→');

        // ── Last Activity Badge (v4.1) ─────────────────────────────────────
        // Badge pill — hidden by default, shown when showLastActivity is true
        this._nodeSel.append('rect').attr('class','_act-badge')
            .attr('x',-18).attr('y',d=>nr(d)+30)
            .attr('width',36).attr('height',14).attr('rx',7)
            .attr('fill',d=>d.activityBadgeColor||'#94A3B8')
            .attr('opacity', this.showLastActivity ? 1 : 0);
        this._nodeSel.append('text').attr('class','_act-label')
            .attr('text-anchor','middle').attr('dy',d=>nr(d)+41)
            .attr('font-family','sans-serif').attr('font-size','8').attr('font-weight','700')
            .attr('fill','#ffffff')
            .attr('opacity', this.showLastActivity ? 1 : 0)
            .text(d=>d.activityBadgeLabel||'—');

        // ── Data Completeness Badge (v4.5) ──────────────────────────────────
        // Small dot top-right of the node. Green check = Phone/Mobile + Email
        // + Title all present. Amber = 1-2 present. No badge at all when 0
        // fields present — an empty dot would just be visual noise; the
        // contact already looks sparse without a marker.
        const compColor = d => d.completenessLevel==='complete' ? '#059669'
                              : d.completenessLevel==='partial'  ? '#d97706'
                              : null;
        this._nodeSel.filter(d=>d.completenessLevel!=='incomplete').append('circle').attr('class','_comp-badge')
            .attr('cx',d=>nr(d)*0.72).attr('cy',d=>-nr(d)*0.72).attr('r',5.5)
            .attr('fill',compColor).attr('stroke',dk?'#0d111c':'#ffffff').attr('stroke-width',1.5);
        this._nodeSel.filter(d=>d.completenessLevel==='complete').append('text').attr('class','_comp-tick')
            .attr('x',d=>nr(d)*0.72).attr('y',d=>-nr(d)*0.72)
            .attr('text-anchor','middle').attr('dominant-baseline','central')
            .attr('font-family','sans-serif').attr('font-size','7').attr('font-weight','900')
            .attr('fill','#ffffff').text('✓');
        this._nodeSel.filter(d=>d.completenessLevel==='partial').append('text').attr('class','_comp-tick')
            .attr('x',d=>nr(d)*0.72).attr('y',d=>-nr(d)*0.72)
            .attr('text-anchor','middle').attr('dominant-baseline','central')
            .attr('font-family','sans-serif').attr('font-size','8').attr('font-weight','900')
            .attr('fill','#ffffff').text('!');

        // ── Champion Risk Badge (v4.6) ───────────────────────────────────────
        // Pulsing red ring + warning badge, top-LEFT corner (opposite the
        // completeness badge) so a contact can show both signals at once
        // without visual collision. No Task created — this is purely a
        // live, computed, in-graph signal per the user's explicit preference.
        this._nodeSel.filter(d=>d.isChampionRisk).append('circle').attr('class','_champ-pulse')
            .attr('r',d=>nr(d)+5).attr('fill','none').attr('stroke','#dc2626')
            .attr('stroke-width',2).attr('opacity',.55);
        this._nodeSel.filter(d=>d.isChampionRisk).select('._champ-pulse')
            .append('animate')
            .attr('attributeName','r')
            .attr('values', d=>`${nr(d)+5};${nr(d)+11};${nr(d)+5}`)
            .attr('dur','2s').attr('repeatCount','indefinite');
        this._nodeSel.filter(d=>d.isChampionRisk).select('._champ-pulse')
            .append('animate')
            .attr('attributeName','opacity')
            .attr('values','.55;.12;.55')
            .attr('dur','2s').attr('repeatCount','indefinite');
        this._nodeSel.filter(d=>d.isChampionRisk).append('circle').attr('class','_champ-badge')
            .attr('cx',d=>-nr(d)*0.72).attr('cy',d=>-nr(d)*0.72).attr('r',6)
            .attr('fill','#dc2626').attr('stroke',dk?'#0d111c':'#ffffff').attr('stroke-width',1.5);
        this._nodeSel.filter(d=>d.isChampionRisk).append('text').attr('class','_champ-tick')
            .attr('x',d=>-nr(d)*0.72).attr('y',d=>-nr(d)*0.72)
            .attr('text-anchor','middle').attr('dominant-baseline','central')
            .attr('font-family','sans-serif').attr('font-size','8').attr('font-weight','900')
            .attr('fill','#ffffff').text('⚠');

        this._sim.on('tick',()=>{
            this._edgeSel.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
            this._nodeSel.attr('transform',d=>`translate(${d.x},${d.y})`);
        });
        this._nodeData = nodes;
        this._linkData = links;
    }

    // ── Node click ────────────────────────────────────────────────────────────
    _nodeClick(clicked, links, nodes) {
        const connEdges = links.filter(e=>e.sourceId===clicked.contactId||e.targetId===clicked.contactId);
        const connIds   = new Set([clicked.contactId]);
        connEdges.forEach(e=>{ connIds.add(e.sourceId); connIds.add(e.targetId); });

        this._nodeSel.selectAll('._nc').transition().duration(220)
            .attr('opacity',d=>connIds.has(d.contactId)?1:0.08)
            .attr('stroke-width',d=>d.contactId===clicked.contactId?3.5:2);
        this._nodeSel.selectAll('text').transition().duration(220)
            .attr('opacity',d=>connIds.has(d.contactId)?1:0.08);
        this._nodeSel.selectAll('circle:first-child').transition().duration(220)
            .attr('opacity',d=>connIds.has(d.contactId)?0.4:0.03);

        const hl=this.pal.hl, dk=this.isDark;
        this._edgeSel.transition().duration(220)
            .attr('stroke',e=>{ const h=e.sourceId===clicked.contactId||e.targetId===clicked.contactId; return h?hl:(dk?'rgba(74,85,104,.06)':'rgba(148,163,184,.06)'); })
            .attr('stroke-width',e=>{ const h=e.sourceId===clicked.contactId||e.targetId===clicked.contactId; return h?(e.weight>=15?3:e.weight>=6?2:1.5):.5; })
            .attr('opacity',e=>(e.sourceId===clicked.contactId||e.targetId===clicked.contactId)?1:.1);

        const nm={};nodes.forEach(n=>nm[n.contactId]=n);
        this.connNodeName = clicked.name;
        this.connList = connEdges.map(e=>{
            const oId=e.sourceId===clicked.contactId?e.targetId:e.sourceId, o=nm[oId]; if(!o) return null;
            const c=this._nc(o.nodeType), sl=e.weight>=15?'Strong':e.weight>=6?'Medium':'Weak';
            const sc=e.weight>=15?this.pal.hub:e.weight>=6?this.pal.connector:this.pal.low;
            return{ id:oId, name:o.name, dotStyle:`background:${c}`, strength:sl, strStyle:`background:${sc}18;color:${sc}` };
        }).filter(Boolean);

        this._openInsight(clicked);
    }

    _clearHL() {
        if (!this._nodeSel||!this._edgeSel) return;
        this.connList=[]; this.connNodeName='';
        this._nodeSel.selectAll('circle').transition().duration(220).attr('opacity',null).attr('stroke-width',null);
        this._nodeSel.selectAll('text').transition().duration(220).attr('opacity',1);
        const dk=this.isDark;
        this._edgeSel.transition().duration(220)
            .attr('stroke',d=>d.weight>=15?(dk?'#d4a840':'#b45309'):d.weight>=6?'#4a7fa8':(dk?'#3a4a5c':'#b0bec5'))
            .attr('stroke-width',d=>d.weight>=15?3:d.weight>=6?1.8:1.2)
            .attr('stroke-opacity',d=>d.weight>=15?.85:d.weight>=6?.65:.40).attr('opacity',1);
    }

    // ── Insight panel ─────────────────────────────────────────────────────────
    async _openInsight(n) {
        this.panelOpen=true; this.loadingInsight=true;
        this.timeline=[]; this.recos=[]; this.introPaths=[];
        const velConfig = VEL_COLORS[n.velocityLabel] || VEL_COLORS.Stable;
        const velRaw    = parseFloat(n.velocityRaw || 0);
        this.contact = {
            contactId:n.contactId, name:n.name, initials:n.initials,
            title:n.title, accountName:n.accountName, department:n.department,
            nodeType:n.nodeType, networkRole:this._networkRole(n),
            // Contact detail fields — must be explicitly copied from node here
            // since _openInsight() builds a plain object and only gets what
            // it lists. These come from the Apex SOQL (Phone, MobilePhone,
            // Email added to both fetch queries in ONAController v4.5).
            email:n.email||'', phone:n.phone||'', mobilePhone:n.mobilePhone||'',
            completenessLevel:n.completenessLevel||'incomplete',
            completenessCount:n.completenessCount||0,
            isChampionRisk:n.isChampionRisk||false,
            championRiskReason:n.championRiskReason||'',
            influenceScore:n.influenceScore||0, centralityScore:n.centralityScore||0,
            influenceDesc:(n.influenceScore||0)>=75?'Key influencer':(n.influenceScore||0)>=50?'Moderate':'Limited',
            centralityDesc:(n.centralityScore||0)>=70?'Hub — info bridge':(n.centralityScore||0)>=40?'Well connected':'Peripheral',
            decayScore:n.decayScore||0, betweennessScore:n.betweennessScore||0,
            decayDesc:(n.decayScore||0)>=70?'Warm now':(n.decayScore||0)>=40?'Cooling':'Cold',
            betweennessDesc:(n.betweennessScore||0)>=70?'Key gatekeeper':(n.betweennessScore||0)>=40?'Moderate bridge':'Low brokerage',
            velocityLabel:n.velocityLabel||'Stable', velocityArrow:n.velocityArrow||'→',
            velocityDesc:velRaw>0.15?`Activity up ${Math.round(velRaw*100)}% — good time to engage.`:velRaw<-0.15?`Activity down ${Math.round(Math.abs(velRaw)*100)}% — re-engage before it goes cold.`:'Consistent activity over 6 months.',
            emailCount:n.emailCount||0, meetingCount:n.meetingCount||0, taskCount:n.taskCount||0,
            lastAct:n.lastActivityDate?`Last activity: ${n.lastActivityDate}`:'No recent activity',
        };
        if (!this._graphJson) { this.loadingInsight=false; return; }
        try {
            const payload = JSON.parse(await getContactInsight({ contactId:n.contactId, graphJson:this._graphJson }));
            const TC={Email:'#4f46e5',Meeting:'#0369a1',Task:'#b45309'};
            const TB={Email:'rgba(79,70,229,.1)',Meeting:'rgba(3,105,161,.1)',Task:'rgba(180,83,9,.1)'};
            this.timeline = (payload.recentActivity||[]).map((a,i)=>({
                id:a.id||String(i), subject:a.subject, activityType:a.activityType, activityDate:a.activityDate,
                dotStyle:`background:${TC[a.activityType]||'#64748b'}`,
                badgeStyle:`background:${TB[a.activityType]||'rgba(100,116,139,.1)'};color:${TC[a.activityType]||'#64748b'}`
            }));
            const PC={Critical:'#dc2626',High:'#b45309',Medium:'#0369a1',Low:'#94a3b8'};
            const PB={Critical:'rgba(220,38,38,.1)',High:'rgba(180,83,9,.1)',Medium:'rgba(3,105,161,.1)',Low:'rgba(148,163,184,.1)'};
            this.recos = (payload.recommendations||[]).map(r=>({
                candidate:r.candidate, reason:r.reason, priority:r.priority,
                avStyle:`background:${this._nc(r.candidate.nodeType)}18;color:${this._nc(r.candidate.nodeType)}`,
                badgeStyle:`background:${PB[r.priority]};color:${PC[r.priority]}`
            }));
            this.introPaths = (payload.introPaths||[]).map(p=>({
                targetContactId:p.targetContactId, targetName:p.targetName, hopCount:p.hopCount,
                steps:(p.pathNames||[]).map((name,i)=>({
                    id:`${p.targetContactId}-${i}`, nodeKey:`${p.targetContactId}-n-${i}`,
                    arrowKey:`${p.targetContactId}-a-${i}`, name:(name||'').split(' ')[0],
                    isTarget:i===(p.pathNames.length-1),
                    nodeClass:i===(p.pathNames.length-1)?'ona-path-target':'ona-path-node'
                }))
            }));
        } catch(e) {
            this.dispatchEvent(new ShowToastEvent({ title:'Insight error', message:e.body?e.body.message:e.message, variant:'error', mode:'sticky' }));
        } finally {
            this.loadingInsight=false;
        }
    }

    _networkRole(n) {
        if(n.nodeType==='hub')          return 'Network Hub';
        if((n.betweennessScore||0)>=60) return 'Gatekeeper';
        if((n.influenceScore||0)>=75)   return 'Key Influencer';
        if((n.centralityScore||0)>=50)  return 'Central Communicator';
        if(n.velocityLabel==='Cooling') return 'Cooling Contact';
        if((n.totalActivities||0)<5)    return 'Low Engagement';
        return 'Active Contact';
    }

    // ── Portfolio view ────────────────────────────────────────────────────────
    _buildPortfolioAccounts(p) {
        const acctMap = {};
        (p.nodes||[]).forEach(n => {
            const aid = n.accountId;
            if (!acctMap[aid]) acctMap[aid] = { id:aid, name:n.accountName||'Unknown', nodes:[], edges:[] };
            acctMap[aid].nodes.push(n);
        });
        (p.edges||[]).forEach(e => {
            Object.values(acctMap).forEach(a => {
                const ids = new Set(a.nodes.map(n=>n.contactId));
                if (ids.has(e.sourceId) && ids.has(e.targetId)) a.edges.push(e);
            });
        });

        const _col = v => v>=70?'#059669':v>=40?'#b45309':'#dc2626';
        const _bg  = v => v>=70?'#dcfce7':v>=40?'#fef3c7':'#fee2e2';
        const _fc  = v => v>=70?'#15803d':v>=40?'#92400e':'#991b1b';

        const accounts = Object.values(acctMap).map((a,i) => {
            const cov  = p.accountIntel?.coverageScore || 0;
            const mt   = p.accountIntel?.multiThreadScore || 0;
            const score = Math.round((cov + mt) / 2);
            const badge = score>=70?'Healthy':score>=40?'Moderate':'At Risk';
            const regions = [...new Set(a.nodes.map(n=>n.region).filter(Boolean))];
            const initials = (a.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
            return {
                id: a.id, name: a.name, initials,
                contactCount: a.nodes.length,
                hubCount: a.nodes.filter(n=>n.nodeType==='hub').length,
                coverageScore: cov, multiThreadScore: mt,
                region: regions[0]||'Unknown', industry: '',
                badge, score, rank: i+1,
                // Account list row styles
                dotStyle:    `background:${_col(score)}`,
                badgeStyle:  `background:${_bg(score)};color:${_fc(score)}`,
                covBarStyle: `width:${cov}%;background:${_col(cov)}`,
                mtBarStyle:  `width:${mt}%;background:${_col(mt)}`,
                covPctStyle: `color:${_col(cov)}`,
                mtPctStyle:  `color:${_col(mt)}`,
                rowClass:    'ona-port-acc',
                topContacts: [...a.nodes].sort((x,y)=>(y.influenceScore||0)-(x.influenceScore||0)).slice(0,5).map(n=>({
                    ...n,
                    dotStyle: `background:${this._nc(n.nodeType)}`,
                    velStyle: `color:${(VEL_COLORS[n.velocityLabel]||VEL_COLORS.Stable).color}`
                }))
            };
        });

        this.portfolioAccounts = accounts.sort((a,b)=>b.score-a.score)
            .map((a,i)=>({...a, rank:i+1}));
        this.portfolioStats = {
            total:   accounts.length,
            atRisk:  accounts.filter(a=>a.score<40).length,
            healthy: accounts.filter(a=>a.score>=70).length
        };
    }

    _renderPortfolioGraph() {
        const cont = this.refs.portSvgContainer;
        if (!cont || !window.d3 || !this.portfolioAccounts.length) return;
        const d3 = window.d3;
        cont.innerHTML = '';
        const W = cont.clientWidth||600, H = cont.clientHeight||450;
        const svg = d3.select(cont).append('svg').attr('width','100%').attr('height','100%');
        const g = svg.append('g');
        this._portZoom = d3.zoom().scaleExtent([.2,4]).on('zoom',e=>g.attr('transform',e.transform));
        svg.call(this._portZoom);
        svg.call(this._portZoom.transform, d3.zoomIdentity.translate(W*0.05,H*0.05).scale(0.88));

        const accts = this.portfolioAccounts;
        const nodes = accts.map((a,i)=>({ ...a, id:i, x:W/2+(Math.random()-.5)*250, y:H/2+(Math.random()-.5)*200, r:Math.max(22,Math.min(48, a.contactCount*2)) }));
        const edges = [];
        nodes.forEach((a,i)=>nodes.forEach((b,j)=>{ if(j<=i) return; if(a.region===b.region) edges.push({source:i,target:j}); }));

        d3.forceSimulation(nodes)
            .force('link',d3.forceLink(edges).id(d=>d.id).distance(150).strength(.3))
            .force('charge',d3.forceManyBody().strength(-500).distanceMax(400))
            .force('center',d3.forceCenter(W/2,H/2).strength(.12))
            .force('collision',d3.forceCollide().radius(d=>d.r+22).strength(1))
            .force('x',d3.forceX(W/2).strength(.04))
            .force('y',d3.forceY(H/2).strength(.04))
            .alphaDecay(.015).velocityDecay(.35)
            .on('tick',()=>{
                eSel.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
                nSel.attr('transform',d=>`translate(${d.x},${d.y})`);
            });

        const eSel = g.append('g').selectAll('line').data(edges).enter().append('line')
            .attr('stroke',this.isDark?'#1e2840':'#e2e8f0').attr('stroke-width',1.5);

        const nSel = g.append('g').selectAll('g').data(nodes).enter().append('g')
            .style('cursor','pointer')
            .on('click',(e,d)=>{ this._selectPortfolioAccount(d); });

        nSel.append('circle').attr('r',d=>d.r)
            .attr('fill',d=>{ const c=d.score>=70?'#059669':d.score>=40?'#b45309':'#dc2626'; return c+(this.isDark?'22':'18'); })
            .attr('stroke',d=>d.score>=70?'#059669':d.score>=40?'#b45309':'#dc2626')
            .attr('stroke-width',2);
        nSel.append('text').attr('text-anchor','middle').attr('dy',-5)
            .attr('font-family','sans-serif').attr('font-size',9).attr('font-weight','600')
            .attr('fill',d=>d.score>=70?'#059669':d.score>=40?'#b45309':'#dc2626')
            .text(d=>d.name.split(' ')[0]);
        nSel.append('text').attr('text-anchor','middle').attr('dy',8)
            .attr('font-family','sans-serif').attr('font-size',8)
            .attr('fill',this.isDark?'#94a3b8':'#475569')
            .text(d=>d.contactCount+' contacts');
        nSel.append('text').attr('text-anchor','middle').attr('dy',20)
            .attr('font-family','sans-serif').attr('font-size',9).attr('font-weight','700')
            .attr('fill',d=>d.score>=70?'#059669':d.score>=40?'#b45309':'#dc2626')
            .text(d=>d.score+'%');
    }

    _selectPortfolioAccount(a) {
        const _col = v => v>=70?'#059669':v>=40?'#b45309':'#dc2626';
        const _bg  = v => v>=70?'#dcfce7':v>=40?'#fef3c7':'#fee2e2';
        const _fc  = v => v>=70?'#15803d':v>=40?'#92400e':'#991b1b';
        const _bc  = v => v>=70?'#86efac':v>=40?'#fcd34d':'#fca5a5';

        // Build signal cards
        const signals = [];
        if (a.multiThreadScore < 40 && a.coverageScore < 40) {
            signals.push({ icon:'⚠', title:'High risk — act now', sub:'Single-threaded and low coverage. Immediate action needed.', borderColor:'#dc2626' });
        } else if (a.multiThreadScore < 40) {
            signals.push({ icon:'⚠', title:'Single-thread risk', sub:'Engagement concentrated on one contact — broaden urgently.', borderColor:'#dc2626' });
        } else if (a.coverageScore < 40) {
            signals.push({ icon:'⚠', title:'Low coverage', sub:'Critical stakeholders in the buying committee not yet engaged.', borderColor:'#b45309' });
        } else if (a.coverageScore >= 70 && a.multiThreadScore >= 70) {
            signals.push({ icon:'✓', title:'Account is healthy', sub:'Well covered and multi-threaded across the buying committee.', borderColor:'#059669' });
        } else {
            signals.push({ icon:'→', title:'Moderate', sub:'Good foundation — broadening coverage will reduce deal risk.', borderColor:'#b45309' });
        }

        // Add borderStyle to each signal object
        signals.forEach(s => {
            s.borderStyle = `border-left-color:${s.borderColor}`;
        });

        const col = _col(a.score||0);
        const initials = (a.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        this.selectedAccount = {
            ...a, signals, initials,
            avStyle:`background:${col}20;color:${col};width:38px;height:38px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0`,
            covBarStyle:`width:${a.coverageScore}%;background:${_col(a.coverageScore)}`,
            mtBarStyle:`width:${a.multiThreadScore}%;background:${_col(a.multiThreadScore)}`,
            covPctStyle:`color:${_col(a.coverageScore)}`,
            mtPctStyle:`color:${_col(a.multiThreadScore)}`
        };
        this.hasPortfolioSelected = true;
        this.portfolioAccounts = this.portfolioAccounts.map(acc=>({
            ...acc,
            rowClass:   'ona-port-acc'+(acc.id===a.id?' ona-port-acc-sel':''),
            isSelected:  acc.id===a.id
        }));
        // Load live news for this account
        this._loadAccountNews(a.name);
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────
    _showTip(e,d) {
        const vc = VEL_COLORS[d.velocityLabel]||VEL_COLORS.Stable;
        // Set base tip data immediately
        this.tip = {
            name:d.name, role:d.title, acct:d.accountName||'',
            inf:d.influenceScore||0, cen:d.centralityScore||0,
            btw:d.betweennessScore||0, con:d.connectionCount||0,
            velArrow:d.velocityArrow||'→', velLabel:d.velocityLabel||'Stable',
            velStyle:`background:${vc.bg};color:${vc.color}`,
            championRisk:d.isChampionRisk||false, championReason:d.championRiskReason||'',
            // Seller section — loading state
            sellers:[], hasSellers:false, mostActive:'', sellersLoading:true
        };
        this.tipVisible = true;
        this._moveTip(e);

        // Seller interactions — read directly from node data (no async callout)
        // Data is pre-populated by populateLastActivity() in getAccountGraph Apex
        const sellers = d.sellerInteractions || [];
        this.tip = {
            name:           this.tip.name,
            role:           this.tip.role,
            acct:           this.tip.acct,
            inf:            this.tip.inf,
            cen:            this.tip.cen,
            btw:            this.tip.btw,
            con:            this.tip.con,
            velArrow:       this.tip.velArrow,
            velLabel:       this.tip.velLabel,
            velStyle:       this.tip.velStyle,
            championRisk:   this.tip.championRisk,
            championReason: this.tip.championReason,
            sellers,
            hasSellers:     sellers.length > 0,
            sellersLoading: false,
            mostActive:     sellers.length > 0 ? sellers[0].repName : ''
        };
    }
    _moveTip(e) {
        const tt = this.refs.graphTooltip;
        if (!tt) return;
        const r = this.refs.graphContainer.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        // Flip left if near right edge
        tt.style.left = x > r.width - 280 ? (x - 280) + 'px' : (x + 14) + 'px';
        tt.style.top  = Math.max(0, y - 20) + 'px';
    }
    _hideTip() {
        clearTimeout(this._tooltipTimer);
        this.tipVisible = false;
    }

    // ── Highlight modes ───────────────────────────────────────────────────────
    _applyHL(mode) {
        if(!this._nodeSel) return;
        this._nodeSel.selectAll('._nc').transition().duration(200).attr('opacity',d=>{
            if(mode==='influence')  return (d.influenceScore||0)>=60?1:.15;
            if(mode==='centrality') return (d.centralityScore||0)>=50?1:.15;
            if(mode==='engage')     { const cs=new Set(this._edges.flatMap(e=>[e.sourceId,e.targetId])); return(!cs.has(d.contactId)||(d.influenceScore||0)>=70)?1:.15; }
            if(mode==='velocity')   return d.velocityLabel==='Growing'?1:.15;
            return 1;
        });
    }

    // ── Event handlers ────────────────────────────────────────────────────────
    handleAccountMode()  { this.mode='account'; this.showEmpty=true; this._nodes=[]; this._edges=[]; this.accountIntel=null; this.hlMode='connections'; if(this._sim)this._sim.stop(); if(this.refs.svgContainer)this.refs.svgContainer.innerHTML=''; }
    handleGlobalMode()   { this.mode='global'; this._load(); }
    handlePortfolioMode(){
        this.mode='portfolio';
        if(this.portfolioAccounts.length===0){
            if(this._allNodes.length>0){
                // Already have graph data — build from it
                this._buildPortfolioAccounts({nodes:this._allNodes,edges:this._allEdges,accountIntel:this.accountIntel});
                setTimeout(()=>this._renderPortfolioGraph(),100);
            } else {
                // No data loaded yet — fetch cross-account graph to populate portfolio
                this._loadPortfolioData();
            }
        } else {
            setTimeout(()=>this._renderPortfolioGraph(),100);
        }
    }

    async _loadPortfolioData(){
        if(!this._d3Loaded) return;
        this.isLoading=true;
        try {
            const json = await getCrossAccountGraph({ industry:null, anchorId:null });
            const p = JSON.parse(json);
            this._graphJson = json;
            this._allNodes  = p.nodes  || [];
            this._allEdges  = p.edges  || [];
            this._nodes     = [...this._allNodes];
            this._edges     = [...this._allEdges];
            if(p.accountIntel) this.accountIntel = p.accountIntel;
            this._buildPortfolioAccounts(p);
            setTimeout(()=>this._renderPortfolioGraph(),120);
        } catch(e){
            this._err(e.body ? e.body.message : e.message);
        } finally {
            this.isLoading=false;
        }
    }
    handleToggleActivity() {
        this.showLastActivity = !this.showLastActivity;
        const cont = this.refs.svgContainer;
        if (cont && window.d3) {
            const badges = window.d3.select(cont).selectAll('rect._act-badge');
            if (!badges.empty()) {
                this._applyActivityBadges(this.showLastActivity);
                return;
            }
        }
        if (this._nodes && this._nodes.length) {
            this._render();
            this._applyHL(this.hlMode);
        }
    }

    _applyActivityBadges(visible) {
        const cont = this.refs.svgContainer;
        if (!cont || !window.d3) return;
        const op = visible ? 1 : 0;
        window.d3.select(cont).selectAll('rect._act-badge').attr('opacity', op);
        window.d3.select(cont).selectAll('text._act-label').attr('opacity', op);
    }

    handleRefresh()      { if(this.mode!=='portfolio') this._load(); else this._renderPortfolioGraph(); }
    handleIndustry(e)    { this.industry=e.target.value; this._load(); }
    handleTheme()        { this.isDark=!this.isDark; if(this._nodes.length){ this._render(); this._applyHL(this.hlMode); } if(this.mode==='portfolio') this._renderPortfolioGraph(); }
    handleHL(e)          { this.hlMode=e.currentTarget.dataset.mode; this._applyHL(this.hlMode); }
    handleZoomIn()       { const s=this.refs.svgContainer?.querySelector('svg'); if(s)window.d3.select(s).transition().duration(200).call(this._zoom.scaleBy,1.4); }
    handleZoomOut()      { const s=this.refs.svgContainer?.querySelector('svg'); if(s)window.d3.select(s).transition().duration(200).call(this._zoom.scaleBy,.7); }
    handleZoomReset()    { const s=this.refs.svgContainer?.querySelector('svg'); if(s)window.d3.select(s).transition().duration(500).call(this._zoom.transform,window.d3.zoomIdentity); }
    handlePortZoomIn()   { const s=this.refs.portSvgContainer?.querySelector('svg'); if(s&&this._portZoom)window.d3.select(s).transition().duration(200).call(this._portZoom.scaleBy,1.4); }
    handlePortZoomOut()  { const s=this.refs.portSvgContainer?.querySelector('svg'); if(s&&this._portZoom)window.d3.select(s).transition().duration(200).call(this._portZoom.scaleBy,.7); }
    handlePortZoomReset(){ const s=this.refs.portSvgContainer?.querySelector('svg'); if(s&&this._portZoom)window.d3.select(s).transition().duration(500).call(this._portZoom.transform,window.d3.zoomIdentity.translate(0,0).scale(0.88)); }
    handlePortAccClick(e){ const id=e.currentTarget.dataset.id; const acc=this.portfolioAccounts.find(a=>a.id===id); if(acc)this._selectPortfolioAccount(acc); }
    handlePortDetailClose(){ this.hasPortfolioSelected=false; this.selectedAccount=null; this.portfolioAccounts=this.portfolioAccounts.map(a=>({...a,rowClass:'ona-port-acc'})); }
    closePanel()         { this.panelOpen=false; this._clearHL(); }
    handleRecoClick(e)   { const n=this._nodeData.find(nd=>nd.contactId===e.currentTarget.dataset.id); if(n)this._nodeClick(n,this._linkData,this._nodeData); }

    async handleSearch(e) {
        this.searchTerm = e.target.value;
        this.showDropdown = false;
        clearTimeout(this._searchTimer);
        if (this.searchTerm.length < 2) return;
        this._searchTimer = setTimeout(async () => {
            try {
                const raw = await searchAccountsAndContacts({ searchTerm: this.searchTerm });
                this.searchResults = raw.map(r => ({
                    ...r,
                    isAccount: r.type === 'account',
                    isContact: r.type === 'contact',
                    icon: r.type === 'account' ? '🏢' : '👤',
                    rowClass: 'ona-ditem' + (r.type === 'contact' ? ' ona-ditem-contact' : '')
                }));
                this.accountResults = raw
                    .filter(r => r.type === 'account')
                    .map(r => ({ Id: r.id, Name: r.name, Industry: r.subtitle, nameInitial: r.initial }));
                this.showDropdown = this.searchResults.length > 0;
            } catch(err) { /* ignore */ }
        }, 300);
    }
    handleSearchFocus() { if (this.searchResults.length) this.showDropdown = true; }
    handleSearchBlur()  { setTimeout(() => { this.showDropdown = false; }, 200); }

    selectResult(e) {
        const type      = e.currentTarget.dataset.type;
        const id        = e.currentTarget.dataset.id;
        const name      = e.currentTarget.dataset.name;
        const accountId = e.currentTarget.dataset.accountid;
        this.showDropdown = false;
        this.mode = 'account';

        if (type === 'account') {
            // Existing behaviour — load account graph
            this.searchTerm    = name;
            this.selectedAcctId = id;
            this._contactToHighlight = null;
            this._load();
        } else {
            // Contact selected — load their account then highlight the contact node
            this.searchTerm    = name + ' (' + e.currentTarget.dataset.accountname + ')';
            this.selectedAcctId = accountId;
            this._contactToHighlight = id;
            this._load();
        }
    }

    // Keep selectAccount for backward compatibility (Compare pane uses it)
    selectAccount(e) { this.selectResult(e); }

    // ── Guide ─────────────────────────────────────────────────────────────────
    get currentStep()    { return GUIDE_STEPS[this.guideStep]||GUIDE_STEPS[0]; }
    get guideStepLabel() { return `Step ${this.guideStep+1} of ${GUIDE_STEPS.length}`; }
    get guideNextLabel() { return this.guideStep===GUIDE_STEPS.length-1?'Finish':'Next →'; }
    get isFirstStep()    { return this.guideStep===0; }
    get guideDots()      { return GUIDE_STEPS.map((_,i)=>({i, cls:'ona-gc-dot'+(i===this.guideStep?' on':'')})); }

    get spotlightStyle() {
        const r=this._guideRect(this.currentStep.zone);
        if(r.isCentre) return 'left:50%;top:50%;width:0;height:0;box-shadow:none;outline:none';
        return `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    }
    get guideCardStyle() {
        const r=this._guideRect(this.currentStep.zone);
        const app=this.template.querySelector('.ona-app');
        const aw=app?app.clientWidth:900, ah=app?app.clientHeight:700, cw=340;
        if(r.isCentre) return `left:${Math.round((aw-cw)/2)}px;top:${Math.round(ah*0.28)}px`;
        let left=Math.min(Math.max(Math.round(r.x),12),aw-cw-12);
        let top=r.y+r.h+14+300<ah?Math.round(r.y+r.h+14):Math.max(Math.round(r.y-300-14),55);
        return `left:${left}px;top:${top}px`;
    }
    _guideRect(sel) {
        const app=this.template.querySelector('.ona-app');
        if(!app||!sel) return {isCentre:true};
        const ar=app.getBoundingClientRect(), el=this.template.querySelector(sel);
        if(!el) return {isCentre:true};
        const er=el.getBoundingClientRect();
        return { x:er.left-ar.left-4, y:er.top-ar.top-4, w:er.width+8, h:er.height+8 };
    }

    handleGuide()             { this.guideOpen=true; this.guideStep=0; }
    closeGuide()              { this.guideOpen=false; }
    stopProp(e)               { e.stopPropagation(); }
    guideNext()               { if(this.guideStep===GUIDE_STEPS.length-1){this.guideOpen=false;}else{this.guideStep=this.guideStep+1;} }
    guidePrev()               { if(!this.isFirstStep) this.guideStep=this.guideStep-1; }
    handleGuideOverlayClick() { this.guideOpen=false; }

    // ── News signals ─────────────────────────────────────────────────────────
    async _loadAccountNews(accountName) {
        this.newsLoading = true;
        this.accountNews = [];
        try {
            const raw = await getAccountNews({ accountName });
            const data = JSON.parse(raw);
            this.accountNews = (data.articles || []).map(a => ({
                id:       a.url || a.title,
                headline: a.title || '',
                source:   (a.source && a.source.name) ? a.source.name : '',
                date:     this._relativeDate(a.publishedAt),
                url:      a.url || ''
            }));
        } catch(e) {
            this.accountNews = [];
        } finally {
            this.newsLoading = false;
        }
    }

    _relativeDate(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const h = Math.floor(diff / 3600000);
        if (h < 1)  return 'Just now';
        if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
        const d = Math.floor(h / 24);
        return d === 1 ? '1 day ago' : d + ' days ago';
    }

    get hasNews()        { return this.accountNews.length > 0; }
    get showNewsEmpty()  { return !this.newsLoading && !this.hasNews; }

    // ── Summary popup ────────────────────────────────────────────────────────
    toggleSummary()   { this.summaryOpen = !this.summaryOpen; if(this.summaryOpen) this._buildSummary(); }
    closeSummary()    { this.summaryOpen = false; }
    stopSummaryProp(e){ e.stopPropagation(); }

    _buildSummary() {
        const nodes = this._nodes; const edges = this._edges;
        if (!nodes || !nodes.length) { this.summaryHasData=false; return; }
        this.summaryHasData = true;
        this.bellDot = true;

        const _col = v=>v>=70?'#059669':v>=40?'#b45309':'#dc2626';

        // Coverage
        const depts    = [...new Set(nodes.map(n=>n.department).filter(Boolean))];
        const engDepts = depts.filter(d=>nodes.filter(n=>n.department===d).reduce((s,n)=>s+(n.emailCount||0)+(n.meetingCount||0),0)>=3);
        const cov      = depts.length ? Math.round(engDepts.length/depts.length*100) : 0;
        const wsGaps   = depts.length - engDepts.length;

        // Risk
        const total = nodes.reduce((s,n)=>s+(n.emailCount||0)*3+(n.meetingCount||0)*5,0);
        const hhi   = total>0 ? nodes.reduce((s,n)=>s+Math.pow(((n.emailCount||0)*3+(n.meetingCount||0)*5)/total,2),0) : 1;
        const mt    = Math.round((1-hhi)*100);
        const avgDecay = Math.round(nodes.reduce((s,n)=>s+(n.decayScore||50),0)/nodes.length);
        const spof  = nodes.filter(n=>{
            const cnt = edges.filter(e=>e.sourceId===n.contactId||e.targetId===n.contactId).length;
            return cnt >= Math.ceil(edges.length*0.4);
        }).length;
        const riskLbl = mt<40||cov<40?'High':mt<70||cov<70?'Moderate':'Low';
        const riskColMap = {High:{bg:'#fee2e2',c:'#991b1b'},Moderate:{bg:'#fef3c7',c:'#92400e'},Low:{bg:'#dcfce7',c:'#15803d'}};

        // Network
        const hubs    = nodes.filter(n=>n.nodeType==='hub');
        const avgCen  = Math.round(nodes.reduce((s,n)=>s+(n.centralityScore||0),0)/nodes.length);
        const avgBtw  = Math.round(nodes.reduce((s,n)=>s+(n.betweennessScore||0),0)/nodes.length);
        const topInfl = [...nodes].sort((a,b)=>(b.influenceScore||0)-(a.influenceScore||0)).slice(0,4).map(n=>({
            ...n, avStyle:`background:${this._nc(n.nodeType)}20;color:${this._nc(n.nodeType)}`
        }));

        // Velocity
        const growing = nodes.filter(n=>n.velocityLabel==='Growing').length;
        const cooling = nodes.filter(n=>n.velocityLabel==='Cooling').length;
        const stable  = nodes.length - growing - cooling;
        const velTotal= nodes.length||1;
        const velSegs = [
            { key:'g', style:`flex:${growing||0.1};background:#059669;height:100%;border-radius:2px;min-width:${growing?3:0}px` },
            { key:'s', style:`flex:${stable||0.1};background:#94a3b8;height:100%;border-radius:2px;min-width:${stable?3:0}px` },
            { key:'c', style:`flex:${cooling||0.1};background:#dc2626;height:100%;border-radius:2px;min-width:${cooling?3:0}px` }
        ];

        // Intro paths
        const connectedIds = new Set(edges.flatMap(e=>[e.sourceId,e.targetId]));
        const nodesByConn  = [...nodes].sort((a,b)=>{
            const aC=edges.filter(e=>e.sourceId===a.contactId||e.targetId===a.contactId).length;
            const bC=edges.filter(e=>e.sourceId===b.contactId||e.targetId===b.contactId).length;
            return bC-aC;
        });
        const unconnected = nodes.filter(n=>!connectedIds.has(n.contactId)).slice(0,3);
        const introPaths  = unconnected.map(tgt=>{
            const bridge = nodesByConn.find(n=>n.contactId!==tgt.contactId&&connectedIds.has(n.contactId));
            if(!bridge) return null;
            return {
                id:tgt.contactId,
                bridgeName: (bridge.name||'').split(' ')[0],
                targetName: (tgt.name||'').split(' ')[0],
                label: `Ask ${(bridge.name||'').split(' ')[0]} to introduce you to ${tgt.name}`
            };
        }).filter(Boolean);

        // Whitespace
        const wsDepts = depts.map(d=>({ dept:d, engaged:engDepts.includes(d),
            chipStyle:`background:${engDepts.includes(d)?'#dcfce7':'#fee2e2'};color:${engDepts.includes(d)?'#15803d':'#991b1b'};font-size:9px;padding:2px 8px;border-radius:8px;font-weight:500` }));

        // Insights
        const insights = [];
        if(hubs.length)      insights.push({dot:'#b45309',text:`${hubs.length} hub node${hubs.length>1?'s':''} detected — ${hubs.slice(0,2).map(h=>(h.name||'').split(' ')[0]).join(', ')} are central brokers.`});
        if(spof>0)           insights.push({dot:'#dc2626',text:`Single-point-of-failure risk: ${spof} contact${spof>1?'s':''} control${spof===1?'s':''} over 40% of relationship activity.`});
        if(growing>=cooling) insights.push({dot:'#059669',text:`Engagement momentum positive — ${growing} contacts growing vs ${cooling} cooling.`});
        if(wsGaps>0)         insights.push({dot:'#0369a1',text:`${wsGaps} department${wsGaps>1?'s':''} with no logged activity: ${depts.filter(d=>!engDepts.includes(d)).slice(0,3).join(', ')}.`});
        if(cov<40)           insights.push({dot:'#dc2626',text:`Coverage below 40% — critical buying committee members missing.`});
        if(introPaths.length) insights.push({dot:'#4338ca',text:`${introPaths.length} warm introduction path${introPaths.length>1?'s':''} available to unconnected stakeholders.`});
        insights.forEach((ins,i)=>{ ins.key=`ins-${i}`; ins.dotStyle=`background:${ins.dot};width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:3px`; });

        this.summaryData = {
            acctName:   this.searchTerm || (this._graphJson ? JSON.parse(this._graphJson).accountName||'Account' : 'Account'),
            acctSub:    `${nodes.length} contacts · ${edges.length} relationships`,
            cov, covStyle:`background:${_col(cov)};width:${cov}%`,
            engagedDepts:engDepts.length, wsGaps, wsDepts,
            mt, mtStyle:`background:${_col(mt)};width:${mt}%`,
            avgDecay, spof, riskLbl,
            riskBadgeStyle:`background:${riskColMap[riskLbl].bg};color:${riskColMap[riskLbl].c};font-size:8.5px;font-weight:600;padding:1px 7px;border-radius:8px`,
            hubCount:hubs.length, avgCen, avgBtw, topInfl,
            growing, stable, cooling, velSegs,
            introPaths, introCount:`${introPaths.length} paths`,
            insights,
            covScore:`${cov}%`, mtScore:`${mt}%`
        };
    }

    get summaryBellClass()     { return 'ona-bell-btn' + (this.summaryOpen?' active':''); }
    get activityBadgeBtnClass() { return 'ona-hbtn' + (this.showLastActivity?' ona-badge-btn-on':''); }

        // ── Analytics handlers ───────────────────────────────────────────────────
    handleCompareMode() {
        this.mode = 'compare';
        this.hasCmpResults = false;
        this._cmpDataA = null;
        this._cmpDataB = null;
    }

    // ── ABM Intelligence (v4.7) ───────────────────────────────────────────────
    handlePortTabList() { this.portSubTab = 'list'; }

    async handlePortTabABM() {
        this.portSubTab = 'abm';
        this.abmSelected = null;
        if (this.abmAccounts.length === 0) {
            await this._loadABMData();
        } else {
            setTimeout(() => this._renderABMChart(), 100);
        }
    }

    async _loadABMData() {
        this.abmLoading = true;
        try {
            const data = await getABMBubbleData();
            this.abmAccounts = data || [];
            this.abmStats = {
                total:    this.abmAccounts.length,
                ready:    this.abmAccounts.filter(a=>a.readiness==='Ready').length,
                warming:  this.abmAccounts.filter(a=>a.readiness==='Warming').length,
                atRisk:   this.abmAccounts.filter(a=>a.readiness==='At Risk').length,
                champRisk:this.abmAccounts.filter(a=>a.championRisk).length
            };
            this.abmLoading = false;
            await Promise.resolve();
            setTimeout(() => this._renderABMChart(), 150);
        } catch(e) {
            this.abmLoading = false;
            this.dispatchEvent(new ShowToastEvent({ title:'ABM load failed', message:e.body?e.body.message:e.message, variant:'error' }));
        }
    }

    // ── Build the action panel data for a clicked account ─────────────────
    _buildAbmSelected(d) {
        const col  = v => v>=70?'#059669':v>=40?'#d97706':'#dc2626';
        const rc   = d.readiness==='Ready'?{bg:'#dcfce7',fg:'#15803d'}:d.readiness==='Warming'?{bg:'#fef3c7',fg:'#92400e'}:{bg:'#fee2e2',fg:'#991b1b'};
        const initials = (d.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

        // Build top contacts from velocity breakdown string if no contact array
        const contacts = (d.topContact) ? [
            { name:d.topContact, titleInfluence:'Influence ' + (d.topInfluence||0), initials:d.topContact.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(), initStyle:`background:${rc.bg};color:${rc.fg}`, velStyle:`background:${d.championRisk?'#dc2626':'#94a3b8'};width:8px;height:8px;border-radius:50%;flex-shrink:0` }
        ] : [];

        return {
            id:            d.id,
            name:          d.name,
            industry:      d.industry || 'Unknown',
            initials,
            avStyle:       `background:${rc.bg};color:${rc.fg}`,
            abmPlay:       d.abmPlay,
            abmPlayIcon:   d.abmPlayIcon,
            playBadgeStyle:`background:${rc.bg};color:${rc.fg};display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;margin-top:4px`,
            coverageScore: d.coverageScore||0,
            multiThreadScore: d.multiThreadScore||0,
            covStyle:      `color:${col(d.coverageScore||0)};font-size:20px;font-weight:600;line-height:1`,
            mtStyle:       `color:${col(d.multiThreadScore||0)};font-size:20px;font-weight:600;line-height:1`,
            covBarStyle:   `width:${d.coverageScore||0}%;background:${col(d.coverageScore||0)}`,
            mtBarStyle:    `width:${d.multiThreadScore||0}%;background:${col(d.multiThreadScore||0)}`,
            revenueLabel:  (d.annualRevenue||0)>=1000000000 ? '$'+((d.annualRevenue)/1000000000).toFixed(1)+'B'
                         : (d.annualRevenue||0)>=1000000    ? '$'+((d.annualRevenue)/1000000).toFixed(0)+'M'
                         : (d.annualRevenue||0)>0           ? '$'+this._fmtNum(d.annualRevenue)
                         : '—',
            pipelineLabel: (d.openPipeline||0)>0?'$'+this._fmtNum(d.openPipeline):'None',
            topContacts:   contacts,
            championRisk:  d.championRisk,
            velocityBreakdown: d.velocityBreakdown
        };
    }

    // ── D3 bubble chart ───────────────────────────────────────────────────
    _renderABMChart() {
        if (!window.d3 || !this.refs.abmChart) return;
        const d3 = window.d3;
        const cont = this.refs.abmChart;
        cont.innerHTML = '';

        const data = this.abmAccounts;
        if (!data.length) return;

        const margin = { top:40, right:20, bottom:52, left:70 };
        const W = cont.clientWidth  || 580;
        const H = cont.clientHeight || 420;
        const iw = W - margin.left - margin.right;
        const ih = H - margin.top  - margin.bottom;

        const maxPipe  = d3.max(data, d => d.openPipeline||0) || 1;
        const maxCnt   = d3.max(data, d => d.contactCount||1) || 1;
        const colFn    = d => d.readiness==='Ready'?'#059669':d.readiness==='Warming'?'#d97706':'#dc2626';

        const xScale = d3.scaleLinear().domain([0,100]).range([0,iw]);
        const yScale = d3.scaleLinear().domain([0, maxPipe*1.15]).range([ih,0]);
        const rScale = d3.scaleSqrt().domain([0,maxCnt]).range([10,34]);

        const dk     = this.isDark;
        const axCol  = dk?'#4a5568':'#94a3b8';
        const txCol  = dk?'#94a3b8':'#475569';
        const lbCol  = dk?'#f0f4ff':'#0f172a';
        const bgQ    = dk?'rgba(255,255,255,.018)':'rgba(0,0,0,.018)';
        const gridC  = dk?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)';

        const svg = d3.select(cont).append('svg').attr('width',W).attr('height',H);
        const g   = svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);

        // Quadrant backgrounds + labels
        const midX = xScale(50), midY = yScale(maxPipe/2);
        const quads = [
            {x:0,   y:0,    w:midX,    h:midY,    l:'Protect & Expand', lx:midX/2,             ly:midY/2},
            {x:midX,y:0,    w:iw-midX, h:midY,    l:'▲ ABM Priority',   lx:midX+(iw-midX)/2,  ly:midY/2},
            {x:0,   y:midY, w:midX,    h:ih-midY, l:'Nurture & Warm Up',lx:midX/2,             ly:midY+(ih-midY)/2},
            {x:midX,y:midY, w:iw-midX, h:ih-midY, l:'Qualify First',    lx:midX+(iw-midX)/2,  ly:midY+(ih-midY)/2}
        ];
        quads.forEach(q => {
            g.append('rect').attr('x',q.x).attr('y',q.y).attr('width',q.w).attr('height',q.h).attr('fill',bgQ);
            g.append('text').attr('x',q.lx).attr('y',q.ly).attr('text-anchor','middle').attr('dominant-baseline','middle')
             .attr('font-size',10).attr('font-weight',600).attr('fill',axCol).attr('opacity',.4).attr('font-family','sans-serif').text(q.l);
        });

        // Dividers
        g.append('line').attr('x1',midX).attr('y1',0).attr('x2',midX).attr('y2',ih).attr('stroke',axCol).attr('stroke-width',1).attr('stroke-dasharray','4,4').attr('opacity',.35);
        g.append('line').attr('x1',0).attr('y1',midY).attr('x2',iw).attr('y2',midY).attr('stroke',axCol).attr('stroke-width',1).attr('stroke-dasharray','4,4').attr('opacity',.35);

        // Grid
        g.append('g').call(d3.axisLeft(yScale).ticks(5).tickSize(-iw).tickFormat('')).select('.domain').remove();
        g.selectAll('.tick line').attr('stroke',gridC);
        g.append('g').attr('transform',`translate(0,${ih})`).call(d3.axisBottom(xScale).ticks(5).tickSize(-ih).tickFormat('')).select('.domain').remove();
        g.selectAll('.tick line').attr('stroke',gridC);

        // Axes
        g.append('g').attr('transform',`translate(0,${ih})`)
         .call(d3.axisBottom(xScale).ticks(5).tickFormat(d=>d+'%'))
         .call(ax=>{ax.select('.domain').attr('stroke',axCol);ax.selectAll('text').attr('fill',txCol).attr('font-size',10);ax.selectAll('.tick line').attr('stroke','none')});
        g.append('g')
         .call(d3.axisLeft(yScale).ticks(5).tickFormat(d=>d>=1000000?'$'+(d/1000000).toFixed(0)+'M':d===0?'$0':'$'+this._fmtNum(d)))
         .call(ax=>{ax.select('.domain').attr('stroke',axCol);ax.selectAll('text').attr('fill',txCol).attr('font-size',10);ax.selectAll('.tick line').attr('stroke','none')});

        // Axis labels
        g.append('text').attr('x',iw/2).attr('y',ih+42).attr('text-anchor','middle').attr('font-size',11).attr('font-weight',600).attr('fill',txCol).attr('font-family','sans-serif').text('Relationship strength →');
        g.append('text').attr('transform','rotate(-90)').attr('x',-ih/2).attr('y',-54).attr('text-anchor','middle').attr('font-size',11).attr('font-weight',600).attr('fill',txCol).attr('font-family','sans-serif').text('↑ Revenue at stake');

        // Chart title
        svg.append('text').attr('x',margin.left).attr('y',20).attr('font-size',12).attr('font-weight',600).attr('fill',lbCol).attr('font-family','sans-serif').text('Account Targeting Map — click any bubble to open action plan');

        const self = this;
        const nodes = g.selectAll('.abm-node').data(data).enter().append('g').attr('class','abm-node').attr('cursor','pointer')
            .attr('transform',d=>`translate(${xScale(d.coverageScore||0)},${yScale(d.openPipeline||0)})`);

        // Champion risk pulsing ring
        nodes.filter(d=>d.championRisk).append('circle').attr('r',d=>rScale(d.contactCount||1)+7)
            .attr('fill','none').attr('stroke','#dc2626').attr('stroke-width',2.5).attr('opacity',.4)
            .each(function(){ d3.select(this).append('animate').attr('attributeName','r').attr('values',(d)=>`${rScale(d.contactCount||1)+7};${rScale(d.contactCount||1)+12};${rScale(d.contactCount||1)+7}`).attr('dur','2s').attr('repeatCount','indefinite'); });

        // Main bubble
        nodes.append('circle')
            .attr('r',0).attr('fill',d=>colFn(d)+'28').attr('stroke',colFn).attr('stroke-width',d=>d.championRisk?2.5:1.5)
            .transition().duration(600).delay((_,i)=>i*50).attr('r',d=>rScale(d.contactCount||1));

        // Selected ring
        nodes.append('circle').attr('class','sel-ring')
            .attr('r',d=>rScale(d.contactCount||1)+4).attr('fill','none')
            .attr('stroke',d=>colFn(d)).attr('stroke-width',2.5).attr('opacity',0);

        // Play icon
        nodes.append('text').attr('text-anchor','middle').attr('dominant-baseline','central').attr('dy',-3)
            .attr('font-size',d=>rScale(d.contactCount||1)>22?14:11).attr('fill',colFn).attr('pointer-events','none').attr('font-family','sans-serif')
            .text(d=>d.abmPlayIcon||'');

        // Initials
        nodes.append('text').attr('text-anchor','middle').attr('dominant-baseline','central').attr('dy',8)
            .attr('font-size',8).attr('font-weight',700).attr('fill',colFn).attr('pointer-events','none').attr('font-family','sans-serif')
            .text(d=>(d.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase());

        // Name label
        nodes.append('text').attr('text-anchor','middle').attr('y',d=>rScale(d.contactCount||1)+14)
            .attr('font-size',9.5).attr('font-weight',500).attr('fill',txCol).attr('pointer-events','none').attr('font-family','sans-serif')
            .text(d=>(d.name||'').length>16?(d.name||'').slice(0,14)+'…':d.name||'');

        const tip = this.refs.abmTip;

        nodes.on('mouseover', function(event, d) {
                d3.select(this).select('circle:not(.sel-ring)').attr('fill', colFn(d)+'55').attr('stroke-width',2.5);
                const covC = d.coverageScore>=70?'#059669':d.coverageScore>=40?'#d97706':'#dc2626';
                const mtC  = d.multiThreadScore>=70?'#059669':d.multiThreadScore>=40?'#d97706':'#dc2626';
                self.abmTip = {
                    name:d.name, industry:d.industry||'', play:d.abmPlay, playIcon:d.abmPlayIcon,
                    playStyle:`color:${d.abmPlayColor};font-weight:700;font-size:12px`,
                    coverage:d.coverageScore||0, multiThread:d.multiThreadScore||0,
                    contacts:d.contactCount, pipeline:d.openPipeline>0?'$'+self._fmtNum(d.openPipeline):'None',
                    champRisk:d.championRisk,
                    covStyle:`color:${covC};font-weight:700`, mtStyle:`color:${mtC};font-weight:700`
                };
                self.abmTipVisible = true;
                const rect = cont.getBoundingClientRect();
                const mx = event.clientX - rect.left;
                const my = event.clientY - rect.top;
                if(tip){ tip.style.left=(mx+14)+'px'; tip.style.top=Math.max(4,my-80)+'px'; }
            })
            .on('mouseout', function(event, d) {
                d3.select(this).select('circle:not(.sel-ring)').attr('fill',colFn(d)+'28').attr('stroke-width',d.championRisk?2.5:1.5);
                self.abmTipVisible = false;
            })
            .on('click', (event, d) => {
                // Highlight selected bubble
                g.selectAll('.sel-ring').attr('opacity',0);
                g.selectAll('.abm-node').filter(n=>n.id===d.id).select('.sel-ring').attr('opacity',1);
                // Load action panel without leaving ABM view
                this.abmSelected = this._buildAbmSelected(d);
                this.abmTipVisible = false;
            });
    }

    // ── Action panel button handlers ──────────────────────────────────────
    // ── Open relationship map — correct pattern matches search select handler ─
    handleABMOpenGraph(e) {
        const id  = e.currentTarget.dataset.id;
        const acc = this.abmAccounts.find(a => a.id === id);
        if (!id || !acc) return;
        this.mode            = 'account';
        this.portSubTab      = 'list';
        this.panelOpen       = false;
        this.showEmpty       = false;
        this.searchTerm      = acc.name;
        this.selectedAcctId  = id;
        this._contactToHighlight = null;
        this._load();
    }

    // ── Add cooling contacts to campaign — loads account in-place, stays on ABM ──
    async handleABMAddCampaign(e) {
        const id  = e.currentTarget.dataset.id;
        const acc = this.abmAccounts.find(a => a.id === id);
        if (!id || !acc) return;

        // Show campaign panel immediately with loading state
        this.campPanelOpen   = true;
        this.campLastAdded   = '';
        this.campLastId      = '';
        this.campActiveChips = ['cooling', 'cold', 'dark'];
        this.campAutoLabel   = 'Loading contacts for ' + acc.name + '…';
        this.campSelectedContacts = [];
        await this._loadExistingCampaigns();

        // Fetch the account graph in the background without changing mode
        try {
            const json = await getAccountGraph({ accountId: id });
            const p = JSON.parse(json);
            // Temporarily populate _allNodes so _autoSelectAtRisk works
            if (p && p.nodes) {
                this._allNodes = p.nodes;
                this._autoSelectAtRisk();
            } else {
                this.campAutoLabel = 'No contacts found — select manually';
            }
        } catch(err) {
            this.campAutoLabel = 'Could not load contacts — select manually';
        }
    }

    // ── Find unengaged contacts — activates Q4 (Engagement) filter on graph ────
    // Q4 = "Who should I engage next?" — highlights contacts who are high-value
    // but have had zero or minimal CRM interactions. Click any highlighted node
    // to see the BFS warm intro path in the insight panel on the right.
    handleABMFindIntro(e) {
        const id  = e.currentTarget.dataset.id || (this.abmSelected && this.abmSelected.id);
        const acc = this.abmAccounts.find(a => a.id === id);
        if (!id || !acc) return;
        this.mode            = 'account';
        this.portSubTab      = 'list';
        this.panelOpen       = false;
        this.showEmpty       = false;
        this.searchTerm      = acc.name;
        this.selectedAcctId  = id;
        this._contactToHighlight = null;
        this._load();
        // Activate Q4 after graph renders — same as clicking Q4 · Engagement button
        setTimeout(() => { this.hlMode = 'engage'; this._applyHL('engage'); }, 2000);
    }

    handleABMAccountClick(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        const d = this.abmAccounts.find(a => a.id === id);
        if (d) this.abmSelected = this._buildAbmSelected(d);
    }

    _fmtNum(n) {
        if (!n || n===0) return '0';
        if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
        if (n >= 1000)    return (n/1000).toFixed(0) + 'K';
        return String(Math.round(n));
    }


    handleCmpSearchA(e) {
        this.compareSearchA = e.target.value;
        this._cmpSearch('a', e.target.value);
    }
    handleCmpSearchB(e) {
        this.compareSearchB = e.target.value;
        this._cmpSearch('b', e.target.value);
    }

    _cmpSearch(side, term) {
        if (!term || term.length < 2) {
            if (side === 'a') this.cmpDropA = [];
            else              this.cmpDropB = [];
            return;
        }
        searchAccounts({ searchTerm: term })
            .then(results => {
                const list = results.map(a => ({ Id: a.Id, Name: a.Name }));
                if (side === 'a') this.cmpDropA = list;
                else              this.cmpDropB = list;
            })
            .catch(() => {});
    }

    handleCmpSelect(e) {
        const side = e.currentTarget.dataset.side;
        const id   = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name;
        if (side === 'a') {
            this.compareSearchA = name;
            this.cmpDropA = [];
            this._cmpLoadA(id);
        } else {
            this.compareSearchB = name;
            this.cmpDropB = [];
            this._cmpLoadB(id);
        }
    }

    handleRunComparison() {
        if (this._cmpDataA && this._cmpDataB) {
            this._buildComparison();
        }
    }

    _cmpLoadA(accountId) {
        getAccountGraph({ accountId })
            .then(json => {
                this._cmpDataA = JSON.parse(json);
                if (this._cmpDataB) this._buildComparison();
            })
            .catch(e => console.error('CMP A load error', e));
    }

    _cmpLoadB(accountId) {
        getAccountGraph({ accountId })
            .then(json => {
                this._cmpDataB = JSON.parse(json);
                if (this._cmpDataA) this._buildComparison();
            })
            .catch(e => console.error('CMP B load error', e));
    }

    _buildComparison() {
        const A = this._cmpDataA;
        const B = this._cmpDataB;
        if (!A || !B) return;

        const nodesA = A.nodes || [], nodesB = B.nodes || [];
        const edgesA = A.edges || [], edgesB = B.edges || [];
        const aiA = A.accountIntel || {}, aiB = B.accountIntel || {};

        const _col  = v => v>=70?'#059669':v>=40?'#b45309':'#dc2626';
        const _bg   = v => v>=70?'#dcfce7':v>=40?'#fef3c7':'#fee2e2';
        const _tc   = v => v>=70?'#15803d':v>=40?'#92400e':'#991b1b';

        const covA  = aiA.coverageScore     || 0;
        const covB  = aiB.coverageScore     || 0;
        const mtA   = aiA.multiThreadScore  || 0;
        const mtB   = aiB.multiThreadScore  || 0;
        const hubsA = nodesA.filter(n=>n.nodeType==='hub').length;
        const hubsB = nodesB.filter(n=>n.nodeType==='hub').length;

        // Tiles
        const mkTiles = (n,e,h,isA) => {
            const oN = isA ? e.length : edgesA.length;
            return [
                { lbl:'Contacts', val:n.length, cls:'ona-cmp-tile'+(n.length>=(isA?nodesB.length:nodesA.length)?' ona-cmp-tile-win':'') },
                { lbl:'Edges',    val:e.length, cls:'ona-cmp-tile'+(e.length>=(isA?edgesB.length:edgesA.length)?' ona-cmp-tile-win':'') },
                { lbl:'Hubs',     val:h,        cls:'ona-cmp-tile'+(h>=(isA?hubsB:hubsA)?' ona-cmp-tile-win':'') },
            ];
        };

        // Score rows
        const scoreRows = [
            { lbl:'Coverage Score',    vA:covA, vB:covB, unit:'%' },
            { lbl:'Multi-thread Risk', vA:mtA,  vB:mtB,  unit:'%' },
        ].map(s => ({
            lbl:s.lbl,
            valA:s.vA+s.unit, valB:s.vB+s.unit,
            winA:s.vA>s.vB, winB:s.vB>s.vA,
            styleA:`color:${_col(s.vA)}`,
            styleB:`color:${_col(s.vB)}`,
            barStyleA:`width:${s.vA}%;background:${_col(s.vA)}`,
            barStyleB:`width:${s.vB}%;background:${_col(s.vB)}`,
        }));

        // Velocity
        const mkVel = (nodes, total) => [
            { lbl:'Growing ↑', count:nodes.filter(n=>n.velocityLabel==='Growing').length, col:'#059669' },
            { lbl:'Stable →',  count:nodes.filter(n=>n.velocityLabel==='Stable').length,  col:'#94a3b8' },
            { lbl:'Cooling ↓', count:nodes.filter(n=>n.velocityLabel==='Cooling').length, col:'#dc2626' },
        ].map(v => ({
            lbl:v.lbl, count:v.count,
            dotStyle:`background:${v.col};width:8px;height:8px;border-radius:50%`,
            barStyle:`width:${total?Math.round(v.count/total*100):0}%;background:${v.col};height:100%;border-radius:3px`,
        }));

        // Influencers
        const mkInfl = (nodes) => [...nodes]
            .sort((a,b)=>(b.influenceScore||0)-(a.influenceScore||0)).slice(0,3)
            .map((n,i) => ({
                id:n.contactId||('i'+i),
                name:n.name||'', title:n.title||'',
                ini:n.initials||'',
                score:(n.influenceScore||0)+'pts',
                avStyle:`background:${this._nc(n.nodeType)}20;color:${this._nc(n.nodeType)};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700`
            }));

        // Risk
        const mkRisk = (nodes, edges, ai) => {
            const spof = nodes.filter(n=>edges.filter(e=>e.sourceId===n.contactId||e.targetId===n.contactId).length>=Math.ceil(edges.length*0.35)).length;
            const decay = nodes.filter(n=>(n.decayScore||50)<35).length;
            const dark  = nodes.filter(n=>(n.emailCount||0)+(n.meetingCount||0)===0).length;
            const ws    = (ai.whitespace||[]).filter(w=>!w.engaged).length;
            return [
                { ico:'⚡', lbl:`${spof} single-point-of-failure`,   style:`color:${spof>0?'#dc2626':'#059669'};font-size:11px` },
                { ico:'❄',  lbl:`${decay} cooling relationships`,    style:`color:${decay>3?'#b45309':'#059669'};font-size:11px` },
                { ico:'🌑', lbl:`${dark} dark contacts`,             style:`color:${dark>2?'#475569':'#059669'};font-size:11px` },
                { ico:'⬜', lbl:`${ws} whitespace gaps`,             style:`color:${ws>2?'#b45309':'#059669'};font-size:11px` },
            ];
        };

        const overallWinA = (covA+mtA) >= (covB+mtB);

        this.cmpResults = {
            nameA:A.accountName||'Account A', nameB:B.accountName||'Account B',
            badgeA:aiA.coverageBadge||'—',    badgeB:aiB.coverageBadge||'—',
            metaA:`${nodesA.length} contacts · ${edgesA.length} edges`,
            metaB:`${nodesB.length} contacts · ${edgesB.length} edges`,
            badgeStyleA:`background:${_bg(covA)};color:${_tc(covA)};font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;display:inline-block`,
            badgeStyleB:`background:${_bg(covB)};color:${_tc(covB)};font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;display:inline-block`,
            headerStyleA:`border-color:${overallWinA?'#b45309':'var(--b1)'}`,
            headerStyleB:`border-color:${!overallWinA?'#b45309':'var(--b1)'}`,
            tilesA:mkTiles(nodesA,edgesA,hubsA,true),
            tilesB:mkTiles(nodesB,edgesB,hubsB,false),
            scoreRows,
            velA:mkVel(nodesA,nodesA.length),
            velB:mkVel(nodesB,nodesB.length),
            inflA:mkInfl(nodesA),
            inflB:mkInfl(nodesB),
            riskA:mkRisk(nodesA,edgesA,aiA),
            riskB:mkRisk(nodesB,edgesB,aiB),
        };
        this.hasCmpResults = true;
    }

    handleAnalyticsMode() {
        this.mode='analytics'; this.analyticsTab='timeline';
        setTimeout(()=>this._renderAnalytics(),120);
    }
    handleAnTab(e) {
        this.analyticsTab=e.currentTarget.dataset.tab;
        setTimeout(()=>this._renderAnalytics(),80);
    }
    handleTimelineSlide(e) {
        this.timelineValue=parseInt(e.target.value);
        const months=['6 months ago','5 months ago','4 months ago','3 months ago','2 months ago','1 month ago','Today'];
        this.timelineLabel=months[this.timelineValue];
        this._renderTimeline();
    }
    handlePmSize(e)       { this.pmSizeBy=e.target.value;   this._renderPowerMap(); }
    handlePmColour(e)     { this.pmColourBy=e.target.value; this._renderPowerMap(); }
    handleCascadeSelect(e){ this._runCascade(e.target.value); }
    handleCascadeReset()  { this._runCascade(null); }
    handleRiskType(e)     { this.riskType=e.target.value; this._renderRiskRadar(); }

    _renderAnalytics() {
        if(this.analyticsTab==='timeline')  this._renderTimeline();
        if(this.analyticsTab==='powermap')  this._renderPowerMap();
        if(this.analyticsTab==='cascade')   this._runCascade(null);
        if(this.analyticsTab==='risk')      this._renderRiskRadar();
    }

    _renderTimeline() {
        const cont=this.refs.timelineContainer;
        if(!cont||!window.d3||!this._allNodes.length) return;
        const d3=window.d3;
        const frac=this.timelineValue/6;
        const threshold=Math.round(this._allNodes.length*(0.3+frac*0.7));
        const visNodes=this._allNodes.slice(0,threshold);
        const visIds=new Set(visNodes.map(n=>n.contactId));
        // Scale edge weights back for older timeframes
        const visEdges=this._allEdges
            .filter(e=>visIds.has(e.sourceId)&&visIds.has(e.targetId))
            .map(e=>({...e, weight:Math.max(1,Math.round((e.weight||1)*(0.3+frac*0.7)))}));
        const depts=[...new Set(visNodes.map(n=>n.department).filter(Boolean))];
        const engD=depts.filter(d=>visNodes.filter(n=>n.department===d).reduce((s,n)=>s+(n.emailCount||0)+(n.meetingCount||0),0)>=3);
        const cov=depts.length?Math.round(engD.length/depts.length*100):0;
        const covC=cov>=70?'#059669':cov>=40?'#b45309':'#dc2626';
        this.timelineStats={contacts:visNodes.length,edges:visEdges.length,cov,covStyle:`color:${covC}`};
        cont.innerHTML='';
        const W=cont.clientWidth||800,H=cont.clientHeight||440;
        this._buildD3Graph(d3,cont,visNodes,visEdges,W,H);
    }

    _renderPowerMap() {
        const cont=this.refs.powermapContainer;
        if(!cont||!window.d3||!this._allNodes.length) return;
        const d3=window.d3;
        cont.innerHTML='';
        const W=cont.offsetWidth||cont.parentElement?.offsetWidth||800;
        const H=cont.offsetHeight||cont.parentElement?.offsetHeight||480;
        const svg=d3.select(cont).append('svg').attr('width','100%').attr('height','100%');
        const g=svg.append('g');
        svg.call(d3.zoom().scaleExtent([.2,4]).on('zoom',e=>g.attr('transform',e.transform)));
        const senRank=n=>{if(!n.title)return 3;const t=n.title.toLowerCase();if(t.includes('chief')||t.includes('ceo')||t.includes('cto')||t.includes('cfo'))return 0;if(t.includes('vice president')||t.includes(' vp')||t.includes('director')||t.includes('head of'))return 1;if(t.includes('manager')||t.includes('lead')||t.includes('senior'))return 2;return 3;};
        const levels=[0,1,2,3],levelH=H/(levels.length+1),lbls=['C-Level','VP / Director','Manager','Individual Contributor'];
        const byLevel=levels.map(l=>this._allNodes.filter(n=>senRank(n)===l));
        const pos=[];
        byLevel.forEach((grp,li)=>{
            const y=levelH*(li+1);
            const totalW=W*0.82;
            const startX=(W-totalW)/2;
            // Evenly space nodes with max spacing of 120px so they don't spread too far
            const spacing=grp.length===1?0:Math.min(120, totalW/(grp.length-1||1));
            const rowW=spacing*(grp.length-1);
            grp.forEach((n,i)=>pos.push({
                ...n,
                px: W/2 - rowW/2 + spacing*i,
                py: y,
                level:li
            }));
        });
        levels.forEach(li=>{g.append('rect').attr('x',0).attr('y',levelH*(li+0.55)).attr('width',W).attr('height',levelH*0.9).attr('fill',this.isDark?'rgba(255,255,255,.02)':'rgba(0,0,0,.015)').attr('rx',4);g.append('text').attr('x',12).attr('y',levelH*(li+1)-5).attr('font-size',9).attr('font-weight','600').attr('fill',this.isDark?'#4a5568':'#94a3b8').text(lbls[li].toUpperCase());});
        const pm={}; pos.forEach(n=>pm[n.contactId]=n);
        this._allEdges.filter(e=>e.weight>=8).forEach(e=>{const a=pm[e.sourceId],b=pm[e.targetId];if(!a||!b)return;g.append('line').attr('x1',a.px).attr('y1',a.py).attr('x2',b.px).attr('y2',b.py).attr('stroke',this.isDark?'#2a3a54':'#dde6f0').attr('stroke-width',Math.max(1,e.weight/8)).attr('stroke-opacity',.7);});
        const getR=n=>{const v=this.pmSizeBy==='influence'?(n.influenceScore||0):this.pmSizeBy==='centrality'?(n.centralityScore||0):(n.betweennessScore||0);return Math.max(14,Math.min(34,14+v*0.2));};
        const getC=n=>{if(this.pmColourBy==='velocity')return n.velocityLabel==='Growing'?'#059669':n.velocityLabel==='Cooling'?'#dc2626':'#94a3b8';if(this.pmColourBy==='seniority'){const l=senRank(n);return['#b45309','#0369a1','#4338ca','#94a3b8'][l];}return this._nc(n.nodeType);};
        const ng=g.selectAll('g').data(pos).enter().append('g').attr('transform',d=>`translate(${d.px},${d.py})`);
        ng.append('circle').attr('r',d=>getR(d)).attr('fill',d=>getC(d)+'28').attr('stroke',d=>getC(d)).attr('stroke-width',2);
        ng.append('text').attr('text-anchor','middle').attr('dominant-baseline','central').attr('font-size',d=>getR(d)>20?11:9).attr('font-weight','700').attr('fill',d=>getC(d)).text(d=>d.initials||'');
        ng.append('text').attr('text-anchor','middle').attr('dy',d=>getR(d)+13).attr('font-size',9).attr('fill',this.pal.lbl).text(d=>(d.name||'').split(' ')[0]);
    }

    _runCascade(removedId) {
        const cont=this.refs.cascadeContainer;
        if(!cont||!window.d3) return;
        this.cascadeHint=removedId?'Red dashed nodes have become isolated.':'Select a contact above to simulate their removal.';
        const d3=window.d3;
        const visNodes=removedId?this._allNodes.filter(n=>n.contactId!==removedId):this._allNodes;
        const visEdges=removedId?this._allEdges.filter(e=>e.sourceId!==removedId&&e.targetId!==removedId):this._allEdges;
        const connIds=new Set(visEdges.flatMap(e=>[e.sourceId,e.targetId]));
        cont.innerHTML='';
        const W=cont.offsetWidth||cont.parentElement?.offsetWidth||560;
        const H=cont.offsetHeight||cont.parentElement?.offsetHeight||460;
        const svg=d3.select(cont).append('svg').attr('width','100%').attr('height','100%');
        const g=svg.append('g');
        svg.call(d3.zoom().scaleExtent([.15,4]).on('zoom',e=>g.attr('transform',e.transform)));
        const ns=visNodes.map(n=>({...n,x:W/2+(Math.random()-.5)*200,y:H/2+(Math.random()-.5)*160}));
        const ls=visEdges.map(e=>({...e,source:e.sourceId,target:e.targetId}));
        d3.forceSimulation(ns).force('link',d3.forceLink(ls).id(d=>d.contactId).distance(70).strength(.5)).force('charge',d3.forceManyBody().strength(-180)).force('center',d3.forceCenter(W/2,H/2).strength(.08)).force('collision',d3.forceCollide().radius(28).strength(.9)).alphaDecay(.02).on('tick',()=>{eS.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);nS.attr('transform',d=>`translate(${d.x},${d.y})`);});
        const eS=g.append('g').selectAll('line').data(ls).enter().append('line').attr('stroke',this.isDark?'#2a3a54':'#c0cfe0').attr('stroke-width',1.5).attr('stroke-opacity',.6);
        const nS=g.append('g').selectAll('g').data(ns).enter().append('g');
        const isIso=n=>!connIds.has(n.contactId);
        nS.append('circle').attr('r',d=>d.nodeType==='hub'?23:17).attr('fill',d=>isIso(d)?'#fee2e2':this._nc(d.nodeType)+'20').attr('stroke',d=>isIso(d)?'#dc2626':this._nc(d.nodeType)).attr('stroke-width',d=>isIso(d)?2.5:1.5).attr('stroke-dasharray',d=>isIso(d)?'5,3':null);
        nS.append('text').attr('text-anchor','middle').attr('dominant-baseline','central').attr('font-size',9).attr('font-weight','700').attr('fill',d=>isIso(d)?'#dc2626':this._nc(d.nodeType)).text(d=>d.initials||'');
        // Update cascade tracked state (LWC does not allow innerHTML — use @track bindings)
        if(removedId){
            const rn=this._allNodes.find(n=>n.contactId===removedId);
            const edgeCnt=this._allEdges.filter(e=>e.sourceId===removedId||e.targetId===removedId).length;

            // Coverage before
            const depts=[...new Set(this._allNodes.map(n=>n.department).filter(Boolean))];
            const engB=depts.filter(d=>this._allNodes.filter(n=>n.department===d).reduce((s,n)=>s+(n.emailCount||0)+(n.meetingCount||0),0)>=3);
            const covB=depts.length?Math.round(engB.length/depts.length*100):0;
            // Coverage after
            const engA=depts.filter(d=>visNodes.filter(n=>n.department===d).reduce((s,n)=>s+(n.emailCount||0)+(n.meetingCount||0),0)>=3);
            const covA=depts.length?Math.round(engA.length/depts.length*100):0;
            // Multi-thread before
            const totB=this._allNodes.reduce((s,n)=>s+(n.emailCount||0)*3+(n.meetingCount||0)*5,0);
            const hhiB=totB>0?this._allNodes.reduce((s,n)=>s+Math.pow(((n.emailCount||0)*3+(n.meetingCount||0)*5)/totB,2),0):1;
            // Multi-thread after
            const totA=visNodes.reduce((s,n)=>s+(n.emailCount||0)*3+(n.meetingCount||0)*5,0);
            const hhiA=totA>0?visNodes.reduce((s,n)=>s+Math.pow(((n.emailCount||0)*3+(n.meetingCount||0)*5)/totA,2),0):1;
            const mtB=Math.round((1-hhiB)*100);
            const mtA=Math.round((1-hhiA)*100);
            // Isolated
            const wasConnected=new Set(this._allEdges.flatMap(e=>[e.sourceId,e.targetId]));
            const isolated=visNodes.filter(n=>wasConnected.has(n.contactId)&&!connIds.has(n.contactId));

            this.cascadeSelected  = true;
            this.cascadeBefore    = { cov:covB, mt:mtB, contacts:this._allNodes.length, edges:this._allEdges.length };
            this.cascadeAfter     = { cov:covA, mt:mtA, contacts:visNodes.length,       edges:visEdges.length };
            this.cascadeCovDelta  = covA - covB;
            this.cascadeMtDelta   = mtA  - mtB;
            this.cascadeEdgeDelta = visEdges.length - this._allEdges.length;
            this.cascadeIsolated  = isolated.map(n=>({ id:n.contactId, name:(n.name||'').split(' ')[0] }));
            this.hasCascadeIsolated = isolated.length > 0;
            this.cascadeIsHub     = rn?.nodeType==='hub';
            const rnName = rn ? rn.name : 'This contact';
            this.cascadeImpact    = this.cascadeIsHub
                ? `High risk. ${rnName} is a hub — removing them collapses ${edgeCnt} relationship edge${edgeCnt!==1?'s':''}.`
                : edgeCnt>=5
                ? `Significant impact. ${rnName} has ${edgeCnt} direct relationships that would need re-routing.`
                : edgeCnt>0
                ? `Moderate impact. ${rnName} has ${edgeCnt} direct relationship${edgeCnt!==1?'s':''} — manageable risk.`
                : `Minimal impact. ${rnName} has no logged CRM activity — removal has no relationship effect.`;
        } else {
            this.cascadeSelected = false;
        }
    }

    _renderRiskRadar() {
        const cont=this.refs.riskContainer;
        if(!cont||!window.d3||!this._allNodes.length) return;
        const d3=window.d3;

        const TYPE_CFG = {
            spof:  { col:'#dc2626', bg:'#fee2e2', tc:'#991b1b', icon:'⚡', label:'Single-point-of-failure' },
            decay: { col:'#b45309', bg:'#fef3c7', tc:'#92400e', icon:'❄',  label:'Relationship decay'     },
            dark:  { col:'#475569', bg:'var(--s2)',tc:'var(--t2)',icon:'🌑', label:'No CRM activity'        },
        };

        const risks=[];
        this._allNodes.forEach(n=>{
            const ec=this._allEdges.filter(e=>e.sourceId===n.contactId||e.targetId===n.contactId).length;
            const frac=this._allEdges.length?ec/this._allEdges.length:0;

            if((this.riskType==='all'||this.riskType==='spof')&&frac>=0.35){
                const cfg=TYPE_CFG.spof;
                risks.push({ id:n.contactId, name:n.name, title:n.title||'', col:cfg.col,
                    desc:`Controls ${Math.round(frac*100)}% of relationship activity — single point of failure`,
                    icon:cfg.icon, label:cfg.label,
                    tagStyle:`background:${cfg.bg};color:${cfg.tc};font-size:8.5px;font-weight:600;padding:2px 8px;border-radius:8px`,
                    itemStyle:`border-left:3px solid ${cfg.col}`,
                    iconBgStyle:`background:${cfg.bg};color:${cfg.col};width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0`
                });
            }
            if((this.riskType==='all'||this.riskType==='decay')&&(n.decayScore||50)<35){
                const cfg=TYPE_CFG.decay;
                risks.push({ id:n.contactId+'d', name:n.name, title:n.title||'', col:cfg.col,
                    desc:`Decay score ${n.decayScore||0} — engagement going cold, act before it drops further`,
                    icon:cfg.icon, label:cfg.label,
                    tagStyle:`background:${cfg.bg};color:${cfg.tc};font-size:8.5px;font-weight:600;padding:2px 8px;border-radius:8px`,
                    itemStyle:`border-left:3px solid ${cfg.col}`,
                    iconBgStyle:`background:${cfg.bg};color:${cfg.col};width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0`
                });
            }
            if((this.riskType==='all'||this.riskType==='dark')&&(n.emailCount||0)+(n.meetingCount||0)===0){
                const cfg=TYPE_CFG.dark;
                risks.push({ id:n.contactId+'k', name:n.name, title:n.title||'', col:cfg.col,
                    desc:`${n.department||'Unknown dept'} — zero emails or meetings logged in CRM`,
                    icon:cfg.icon, label:cfg.label,
                    tagStyle:`background:var(--s2);color:var(--t2);font-size:8.5px;font-weight:600;padding:2px 8px;border-radius:8px`,
                    itemStyle:`border-left:3px solid ${cfg.col}`,
                    iconBgStyle:`background:var(--s2);color:var(--t2);width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0`
                });
            }
        });

        this.riskItems=risks;
        this.riskSummary=risks.length
            ? `${risks.length} risk signal${risks.length!==1?'s':''} detected across ${new Set(risks.map(r=>r.name)).size} contact${new Set(risks.map(r=>r.name)).size!==1?'s':''}. Highlighted nodes are at risk.`
            : '';

        const riskIds=new Set(this._allNodes
            .filter(n=>risks.find(r=>r.id===n.contactId||r.id===n.contactId+'d'||r.id===n.contactId+'k'))
            .map(n=>n.contactId));

        cont.innerHTML='';
        const W=cont.offsetWidth||cont.parentElement?.offsetWidth||580;
        const H=cont.offsetHeight||cont.parentElement?.offsetHeight||480;
        this._buildD3Graph(d3,cont,this._allNodes,this._allEdges,W,H,riskIds,risks);
    }

    _buildD3Graph(d3,cont,nodes,edges,W,H,riskIds,risks){
        if(!nodes||!nodes.length) return;
        const svg=d3.select(cont).append('svg').attr('width','100%').attr('height','100%');
        const g=svg.append('g');
        const zoomBeh=d3.zoom().scaleExtent([.05,4]).on('zoom',e=>g.attr('transform',e.transform));
        svg.call(zoomBeh);

        // Layout strategy: circular start → force simulation
        // For sparse graphs, use radial force to keep nodes in a visible cluster
        const edgeDensity = edges.length / Math.max(nodes.length, 1);
        const isSparse    = edgeDensity < 0.5;
        const R           = Math.min(W, H) * (isSparse ? 0.38 : 0.28);

        // Pre-position in a circle so simulation doesn't need to travel far
        const ns = nodes.map((n,i) => ({
            ...n,
            x: W/2 + R * Math.cos((2*Math.PI*i/nodes.length) - Math.PI/2),
            y: H/2 + R * Math.sin((2*Math.PI*i/nodes.length) - Math.PI/2)
        }));
        const ls = edges.map(e => ({ ...e, source: e.sourceId, target: e.targetId }));

        const sim = d3.forceSimulation(ns)
            .force('link',      d3.forceLink(ls).id(d=>d.contactId)
                                   .distance(isSparse ? 60 : 65)
                                   .strength(isSparse ? 1.0 : 0.6))
            .force('charge',    d3.forceManyBody().strength(isSparse ? -80 : -150))
            .force('center',    d3.forceCenter(W/2, H/2).strength(isSparse ? 0.30 : 0.08))
            .force('collision', d3.forceCollide().radius(24).strength(1))
            .force('radial',    d3.forceRadial(isSparse ? R*0.85 : R, W/2, H/2)
                                   .strength(isSparse ? 0.25 : 0.04))
            .alphaDecay(0.022).velocityDecay(0.42);

        // Auto zoom-to-fit after simulation settles
        sim.on('end', ()=>{
            const xs=ns.map(n=>n.x), ys=ns.map(n=>n.y);
            const x0=Math.min(...xs)-30, x1=Math.max(...xs)+30;
            const y0=Math.min(...ys)-30, y1=Math.max(...ys)+30;
            const scale=Math.min(0.95, Math.min(W/(x1-x0), H/(y1-y0)));
            const tx=W/2 - scale*(x0+x1)/2;
            const ty=H/2 - scale*(y0+y1)/2;
            svg.transition().duration(600)
               .call(zoomBeh.transform, d3.zoomIdentity.translate(tx,ty).scale(scale));
        });

        const eS=g.append('g').selectAll('line').data(ls).enter().append('line')
            .attr('stroke',this.isDark?'#4a6080':'#94b4cc')
            .attr('stroke-width',d=>(d.weight||d.w||1)>=10?3:2)
            .attr('stroke-opacity',.8);

        const nS=g.append('g').selectAll('g').data(ns).enter().append('g')
            .style('cursor','pointer');

        const isR=n=>riskIds&&riskIds.has(n.contactId);
        const getRiskCol=n=>{
            if(!riskIds||!risks) return this._nc(n.nodeType);
            const r=risks.find(r=>r.id===n.contactId||r.id===n.contactId+'d'||r.id===n.contactId+'k');
            return r ? r.col : this._nc(n.nodeType);
        };

        // Risk glow ring
        nS.filter(d=>isR(d)).append('circle')
            .attr('r',30).attr('fill','none')
            .attr('stroke',d=>getRiskCol(d))
            .attr('stroke-width',1.5).attr('opacity',.4)
            .attr('stroke-dasharray','4,3');

        // Main circle
        nS.append('circle').attr('r',d=>d.nodeType==='hub'?23:17)
            .attr('fill',d=>isR(d)?(getRiskCol(d)+'28'):(this._nc(d.nodeType)+'20'))
            .attr('stroke',d=>isR(d)?getRiskCol(d):this._nc(d.nodeType))
            .attr('stroke-width',d=>isR(d)?2.5:1.5)
            .attr('opacity',d=>(!riskIds||isR(d))?1:.45);

        // Initials
        nS.append('text').attr('text-anchor','middle').attr('dominant-baseline','central')
            .attr('font-size',9).attr('font-weight','700')
            .attr('fill',d=>isR(d)?getRiskCol(d):this._nc(d.nodeType))
            .attr('opacity',d=>(!riskIds||isR(d))?1:.45)
            .text(d=>d.initials||'');

        // Name below node
        nS.append('text').attr('text-anchor','middle').attr('dy',28)
            .attr('font-size',8).attr('fill',this.pal.lbl)
            .attr('opacity',d=>(!riskIds||isR(d))?1:.3)
            .text(d=>(d.name||'').split(' ')[0]);

        // Click on risk nodes → show info
        if(riskIds) {
            nS.filter(d=>isR(d)).on('click',(event,d)=>{
                event.stopPropagation();
                const r=risks.find(r=>r.id===d.contactId||r.id===d.contactId+'d'||r.id===d.contactId+'k');
                if(r) this._showRiskNodeInfo(d, r);
            });
        }

        sim.on('tick',()=>{
            eS.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
              .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
            nS.attr('transform',d=>`translate(${d.x},${d.y})`);
        });
    }

    _showRiskNodeInfo(node, risk) {
        // Highlight in risk list panel by scrolling to the item
        const items=this.template.querySelectorAll('.ona-risk-item');
        items.forEach(el=>{
            if(el.querySelector('.ona-risk-name')?.textContent===node.name){
                el.style.background='var(--s2)';
                el.scrollIntoView({behavior:'smooth',block:'nearest'});
                setTimeout(()=>el.style.background='',1500);
            }
        });
    }

        _highlightContact(contactId) {
        if (!this._nodeSel || !window.d3) return;
        // Fade all other nodes
        this._nodeSel.selectAll('circle').transition().duration(300)
            .attr('opacity', d => d.contactId === contactId ? 1 : 0.15);
        this._nodeSel.selectAll('text').transition().duration(300)
            .attr('opacity', d => d.contactId === contactId ? 1 : 0.15);
        // Zoom to that node
        const target = this._allNodes.find(n => n.contactId === contactId);
        if (target && this._gMain && this._zoom) {
            const W = this.refs.svgContainer?.clientWidth || 800;
            const H = this.refs.svgContainer?.clientHeight || 500;
            // Find node position from D3 simulation
            const d3 = window.d3;
            let nx = W/2, ny = H/2;
            this._nodeSel.each(function(d) {
                if (d.contactId === contactId) { nx = d.x; ny = d.y; }
            });
            const svg = d3.select(this.refs.svgContainer).select('svg');
            svg.transition().duration(600).call(
                this._zoom.transform,
                d3.zoomIdentity.translate(W/2 - nx*1.8, H/2 - ny*1.8).scale(1.8)
            );
        }
        // Clear highlight after 4 seconds
        setTimeout(() => {
            if(this._nodeSel) {
                this._nodeSel.selectAll('circle').transition().duration(300).attr('opacity', 1);
                this._nodeSel.selectAll('text').transition().duration(300).attr('opacity', 1);
            }
            this._contactToHighlight = null;
        }, 4000);
    }


    // ══════════════════════════════════════════════════════════════════════════
    // RELATIONSHIP HANDOVER PACK (v4.3)
    // Entry point 1: Bell Summary popup → ↓ Download PDF button
    // Entry point 2: Portfolio View → 📄 icon on each account row
    // Generates a complete 8-page premium HTML report from live graph data.
    // Opens in a new tab and auto-triggers the browser print dialog.
    // Zero extra Apex — uses _allNodes, _allEdges, _accountIntel already loaded.
    // ══════════════════════════════════════════════════════════════════════════

    handleDownloadHandoverPack() {
        // Called from Bell Summary popup
        this._openHandoverPack(
            this._allNodes,
            this._allEdges,
            this._accountIntel,
            this.summaryData && this.summaryData.acctName ? this.summaryData.acctName : this.searchTerm,
            this.isDark
        );
    }

    handlePortfolioHandoverPack(e) {
        // Called from Portfolio View row — stops row click, loads account, then generates
        e.stopPropagation();
        const accountId   = e.currentTarget.dataset.id;
        const accountName = e.currentTarget.dataset.name;
        if (!accountId) return;

        // If already loaded — generate immediately
        if (this.selectedAcctId === accountId && this._allNodes.length) {
            this._openHandoverPack(this._allNodes, this._allEdges, this._accountIntel, accountName);
            return;
        }
        // Otherwise load the account first, then generate
        this.selectedAcctId = accountId;
        this.searchTerm     = accountName;
        this.mode = 'account';
        this._pendingHandoverPack = true;
        this._load();
    }

    _openHandoverPack(nodes, edges, intel, accountName, isDark = false) {
        console.log('[ONA] Handover Pack requested for:', accountName, '| nodes:', (nodes||[]).length, '| dark:', isDark);
        if (!nodes || !nodes.length) {
            // eslint-disable-next-line no-alert
            alert('Please load an account first, then click Download.');
            return;
        }
        try {
            console.log('[ONA] Building HTML...');
            const html = this._buildHandoverPackHTML(nodes, edges, intel, accountName, isDark);
            console.log('[ONA] HTML built, length:', html ? html.length : 'NULL');
            const blob = new Blob([html], { type: 'application/octet-stream' });
            const url  = URL.createObjectURL(blob);
            // Use anchor download — avoids window.open popup blockers and Salesforce CSP
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'ONA_Handover_Pack_'
                       + (accountName || 'Account').replace(/[^a-zA-Z0-9]/g, '_')
                       + '.html';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch(err) {
            console.error('[ONA] Handover Pack error:', err);
            // eslint-disable-next-line no-alert
            alert('Error generating report. Check browser console for details.');
        }
    }

    // ── HTML Generator ────────────────────────────────────────────────────────
    _buildHandoverPackHTML(nodes, edges, intel, acctName, isDark = false) {
        // Build theme CSS as plain string — no nested template literals (LWC Babel safe)
        const themeCss = isDark
            ? ':root{--paper:#0F172A;--surface:#1E293B;--s2:#263147;--s3:#1A2540;' +
              '--royal:#93C5FD;--royal2:#BAD4FD;--bronze:#C99828;--bronzeL:#E8C76A;--bronzeBg:#1E2A18;' +
              '--sage:#34D399;--sageBg:#0D2318;--sienna:#FCD34D;--siennaBg:#271D0A;' +
              '--crimson:#FCA5A5;--crimBg:#2A0E0E;--steel:#93C5FD;--steelBg:#0F1E3C;' +
              '--ink:#F1F5F9;--ink2:#CBD5E1;--ink3:#94A3B8;--rule:#334155;--rule2:#263147;' +
              '--code-bg:#0D1526;--code-color:#93C5FD;--code-border:#1E3A5F;' +
              'color-scheme:dark}'
            : ':root{--paper:#F0EDE7;--surface:#fff;--s2:#F7F5F1;--s3:#EDE9E3;' +
              '--royal:#1B3560;--royal2:#243F75;--bronze:#A8720E;--bronzeL:#C99828;--bronzeBg:#FCF5E4;' +
              '--sage:#1A6840;--sageBg:#E6F2EA;--sienna:#9E4610;--siennaBg:#FAF0E6;' +
              '--crimson:#8C1C1C;--crimBg:#FAE8E8;--steel:#1A4A96;--steelBg:#E6EEF8;' +
              '--ink:#181E2C;--ink2:#3D4D60;--ink3:#64778C;--rule:#CECCBF;--rule2:#E2DDD6;' +
              '--code-bg:#EEE9DF;--code-color:#1B3560;--code-border:#D0C9BE;' +
              'color-scheme:light}';
        const colorScheme = isDark ? 'dark' : 'light';
        const today   = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' });
        const name    = acctName || 'Account';
        const ai      = intel  || {};
        const covScore = ai.coverageScore     || 0;
        const mtScore  = ai.multiThreadScore  || 0;
        const netScore = Math.round((covScore + mtScore) / 2);

        // Sort nodes by influence
        const sorted   = [...nodes].sort((a,b) => (b.influenceScore||0) - (a.influenceScore||0));
        const top8     = sorted.slice(0, 8);
        const hubs     = nodes.filter(n => n.nodeType === 'hub');
        const growing  = nodes.filter(n => n.velocityLabel === 'Growing');
        const stable   = nodes.filter(n => n.velocityLabel === 'Stable');
        const cooling  = nodes.filter(n => n.velocityLabel === 'Cooling');
        const spof     = nodes.filter(n => (edges.filter(e => e.sourceId === n.contactId || e.targetId === n.contactId).length) >= Math.ceil(edges.length * 0.35));
        const decayRisk= nodes.filter(n => (n.decayScore||50) < 35 && (n.decayScore||50) > 0);
        const dark     = nodes.filter(n => (n.emailCount||0) + (n.meetingCount||0) === 0);

        // Score colours
        const sc = v => v >= 70 ? '#1A6840' : v >= 40 ? '#9E4610' : '#8C1C1C';
        const sb = v => v >= 70 ? '#E6F2EA' : v >= 40 ? '#FAF0E6' : '#FAE8E8';
        const sn = v => v >= 70 ? 'Good'    : v >= 40 ? 'Moderate': 'At Risk';

        // Contact table rows
        const contactRows = top8.map(n => {
            const d    = n.decayScore || 0;
            const dc   = d < 35 ? '#8C1C1C' : d < 60 ? '#9E4610' : '#1A6840';
            const vCol = n.velocityLabel === 'Growing' ? '#1A6840' : n.velocityLabel === 'Cooling' ? '#9E4610' : '#64778C';
            const vCls = n.velocityLabel === 'Growing' ? 'vel-g'    : n.velocityLabel === 'Cooling' ? 'vel-c'    : 'vel-s';
            const ini  = (n.initials || n.name.split(' ').map(w=>w[0]).join('').slice(0,2)).toUpperCase();
            const lastAct = n.activityBadgeLabel || n.lastActivityDate || '—';
            const sellers = (n.sellerInteractions||[]).slice(0,2).map(s =>
                `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:5px"><span style="width:5px;height:5px;border-radius:50%;background:${s.dotColor||'#94A3B8'};flex-shrink:0;display:inline-block"></span><span style="font-size:8px;color:#4A5568">${s.repName||''} ${s.whenLabel||''}</span></span>`
            ).join('');
            return `<tr${d < 35 && d > 0 ? ' style="background:#FFFCF5"' : dark.includes(n) ? ' style="background:#FDF5F5"' : ''}>
              <td><span class="av" style="background:${sb(n.influenceScore||50)};color:${sc(n.influenceScore||50)}">${ini}</span><strong>${this._esc(n.name)}</strong></td>
              <td>${this._esc(n.title||'')}</td>
              <td>${this._esc(n.department||'')}</td>
              <td><div class="ibar"><div class="itr"><div class="ifl" style="width:${n.influenceScore||0}%"></div></div><span style="font-family:var(--mono);font-size:8.5px">${n.influenceScore||0}</span></div></td>
              <td style="font-family:var(--mono)">${n.centralityScore||0}</td>
              <td style="font-family:var(--mono)">${n.betweennessScore||0}</td>
              <td style="font-family:var(--mono);color:${dc};font-weight:${d<35?'700':'400'}">${d}${d < 35 && d > 0 ? ' ⚠' : d === 0 ? ' ⚠' : ''}</td>
              <td><span class="${vCls}">${n.velocityArrow||'→'} ${n.velocityLabel||'Stable'}</span></td>
              <td>${lastAct}</td>
              <td style="font-size:8.5px">${sellers || '—'}</td>
            </tr>`;
        }).join('');

        // Risk rows
        const riskRows = [...spof.slice(0,1).map(n=>`<div class="rrow"><span class="av" style="background:#FAE8E8;color:#8C1C1C;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;flex-shrink:0">${(n.initials||'?').slice(0,2)}</span><span class="rn">${this._esc(n.name)}</span><span class="rrl">${this._esc(n.title||'')} · ${this._esc(n.department||'')}</span><span class="rtag rt-r">⚡ SPOF</span></div>`),
             ...decayRisk.slice(0,3).map(n=>`<div class="rrow"><span class="av" style="background:#FAF0E6;color:#9E4610;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;flex-shrink:0">${(n.initials||'?').slice(0,2)}</span><span class="rn">${this._esc(n.name)}</span><span class="rrl">${this._esc(n.title||'')} · ${this._esc(n.department||'')}</span><span class="rtag rt-a">❄ Decay ${n.decayScore||0} · ${n.activityBadgeLabel||'—'} since last contact</span></div>`)
            ].join('');

        // Velocity bars HTML
        const velHTML = `
          <div class="vbar-row"><span class="vbar-lbl" style="color:#1A6840">↑ Growing</span><div class="vbar-tr"><div class="vbar-f" style="width:${nodes.length?Math.round(growing.length/nodes.length*100):0}%;background:#1A6840"></div></div><span class="vbar-ct" style="color:#1A6840">${growing.length}</span><span class="vbar-pct">${nodes.length?Math.round(growing.length/nodes.length*100):0}%</span></div>
          <div class="vbar-row"><span class="vbar-lbl" style="color:#64778C">→ Stable</span><div class="vbar-tr"><div class="vbar-f" style="width:${nodes.length?Math.round(stable.length/nodes.length*100):0}%;background:#64778C"></div></div><span class="vbar-ct" style="color:#64778C">${stable.length}</span><span class="vbar-pct">${nodes.length?Math.round(stable.length/nodes.length*100):0}%</span></div>
          <div class="vbar-row"><span class="vbar-lbl" style="color:#9E4610">↓ Cooling</span><div class="vbar-tr"><div class="vbar-f" style="width:${nodes.length?Math.round(cooling.length/nodes.length*100):0}%;background:#9E4610"></div></div><span class="vbar-ct" style="color:#9E4610">${cooling.length}</span><span class="vbar-pct">${nodes.length?Math.round(cooling.length/nodes.length*100):0}%</span></div>`;

        // Department coverage
        const depts = {};
        nodes.forEach(n => { if(n.department) { const k = n.department; depts[k] = (depts[k]||0) + (n.emailCount||0) + (n.meetingCount||0)*2; }});
        const deptRows = Object.entries(depts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([d,v]) => {
            const pct = Math.min(100, Math.round(v / Math.max(...Object.values(depts)) * 100));
            const eng = pct >= 20;
            return `<div class="dbar-row"><span class="dbar-lbl">${this._esc(d)}</span><div class="dbar-tr"><div class="dbar-f" style="width:${pct}%;background:${eng?'#1A6840':'#CECCBF'}"></div></div><span class="dbar-st" style="color:${eng?'#1A6840':'#8C1C1C'}">${eng?'Active':'⚠ Gap'}</span></div>`;
        }).join('');

        // Recommendations from top at-risk contacts
        const recos = [...spof.slice(0,2), ...decayRisk.slice(0,2), ...growing.slice(0,1)].slice(0,5);
        const recoRows = recos.map((n,i) => {
            const isSpof   = spof.includes(n);
            const isDecay  = decayRisk.includes(n);
            const cls      = i < 2 ? 'reco-r' : i < 4 ? 'reco-a' : 'reco-b';
            const pri      = i < 2 ? 'Critical — within 7 days' : i < 4 ? 'High — within 2 weeks' : 'Medium — within 30 days';
            const priCls   = i < 2 ? 'pri-r' : i < 4 ? 'pri-a' : 'pri-b';
            const reason   = isSpof  ? `${this._esc(n.name)} controls a significant portion of all relationship activity. Build 2 parallel relationships immediately.`
                           : isDecay ? `Decay score ${n.decayScore} — ${n.activityBadgeLabel||'some time'} since last contact. Identify a warm introduction path and re-engage before renewal window.`
                           : `Growing momentum — Influence ${n.influenceScore}. Invest now while engagement is rising.`;
            return `<div class="reco ${cls}"><span class="reco-num">${String(i+1).padStart(2,'0')}</span><div><div class="reco-title">${this._esc(n.name)} — ${this._esc(n.title||'')} · ${this._esc(n.department||'')}</div><div class="reco-role">Influence ${n.influenceScore||0} · Centrality ${n.centralityScore||0} · Decay ${n.decayScore||0} · ${n.velocityLabel||'Stable'} ${n.velocityArrow||'→'}</div><div class="reco-body">${reason}</div><span class="reco-pri ${priCls}">${pri}</span></div></div>`;
        }).join('');

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="color-scheme" content="${colorScheme}"/>
<title>ONA Handover Pack — ${this._esc(name)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;0,9..144,700;1,9..144,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
:root{--head:'Fraunces',Georgia,serif;--body:'Plus Jakarta Sans',system-ui,sans-serif;--mono:'JetBrains Mono',monospace}
${themeCss}
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}html{font-size:10px}body{font-family:var(--body);background:var(--paper);color:var(--ink);line-height:1.5}
.toolbar{position:sticky;top:0;z-index:999;background:var(--royal);display:flex;align-items:center;justify-content:space-between;padding:10px 24px;box-shadow:0 2px 16px rgba(27,53,96,.25)}
.toolbar-label{font-size:10px;color:rgba(255,255,255,.5);letter-spacing:.06em;font-family:var(--mono)}
.btn-dl{display:flex;align-items:center;gap:6px;background:var(--bronzeL);color:#fff;border:none;border-radius:4px;padding:7px 18px;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--body);letter-spacing:.04em;box-shadow:0 2px 10px rgba(168,114,14,.4)}
.doc{max-width:860px;margin:0 auto}.page{background:var(--surface);margin-bottom:4px;padding:0;overflow:hidden}
.cover-outer{min-height:380px;display:flex;flex-direction:column}
.cover-top-bar{height:5px;background:linear-gradient(90deg,var(--royal) 0%,var(--bronzeL) 50%,var(--royal) 100%)}
.cover-body{flex:1;display:grid;grid-template-columns:1fr 240px}
.cover-main{padding:28px 28px 22px;border-right:1px solid var(--rule2)}
.cover-eye{font-size:8.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink3);margin-bottom:18px}
.cover-rule{width:32px;height:2px;background:var(--bronze);margin-bottom:14px}
.cover-acct{font-family:var(--head);font-style:italic;font-size:13px;color:var(--bronze);margin-bottom:7px;font-weight:300}
.cover-title{font-family:var(--head);font-size:38px;font-weight:700;color:var(--royal);line-height:1.05;margin-bottom:8px;letter-spacing:-.01em}
.cover-subtitle{font-size:10.5px;color:var(--ink2);font-weight:300;line-height:1.65;margin-bottom:16px;max-width:400px}
.cover-kpi-mini{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.ckpi{background:var(--s2);border:1px solid var(--rule2);border-radius:4px;padding:8px 10px}
.ckpi-l{font-size:7.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink3);margin-bottom:4px}
.ckpi-v{font-family:var(--mono);font-size:20px;font-weight:500;line-height:1}
.ckpi-bar{height:2px;background:var(--rule2);border-radius:1px;margin:5px 0 4px;overflow:hidden}
.ckpi-fill{height:100%;border-radius:1px}
.ckpi-b{font-size:7.5px;font-weight:700;padding:1.5px 6px;border-radius:2px;display:inline-block}
.cover-insight{font-size:9.5px;color:var(--ink2);line-height:1.65;padding:8px 12px;background:var(--s2);border-left:2.5px solid var(--bronze)}
.cover-sidebar{background:var(--royal);padding:22px 18px 18px;display:flex;flex-direction:column}
.csf{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.07)}
.csf:last-of-type{border:none;margin-bottom:0}.csf-l{font-size:7.5px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.38);margin-bottom:2px}
.csf-v{font-size:10px;color:rgba(255,255,255,.85);font-weight:600}.csf-tag{font-size:7.5px;color:var(--bronzeL);font-weight:500;margin-top:2px}
.cover-conf{margin-top:auto;font-size:7.5px;color:rgba(255,255,255,.22);text-transform:uppercase;letter-spacing:.1em}
.sec{padding:18px 26px 16px}.sec+.sec{border-top:1px solid var(--rule2)}
.sh{display:flex;align-items:center;gap:10px;margin-bottom:9px}.sh::after{content:'';flex:1;height:1px;background:var(--royal);opacity:.15}
.sh-num{font-family:var(--mono);font-size:9px;color:var(--bronze);font-weight:500;flex-shrink:0}
.sh-t{font-family:var(--head);font-size:14px;font-weight:600;color:var(--royal);flex-shrink:0;letter-spacing:-.01em}
.sh-pill{font-size:7.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 8px;border-radius:2px;flex-shrink:0}
.pill-r{background:var(--crimBg);color:var(--crimson)}.pill-a{background:var(--siennaBg);color:var(--sienna)}.pill-g{background:var(--sageBg);color:var(--sage)}.pill-n{background:var(--s3);color:var(--ink3);border:1px solid var(--rule)}.pill-b{background:var(--steelBg);color:var(--steel)}
.ssl{font-size:8px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--ink3);margin:9px 0 6px;padding-bottom:3px;border-bottom:1px dashed var(--rule2)}
.narr{font-size:9.5px;color:var(--ink2);line-height:1.7;padding:8px 12px;background:var(--bronzeBg);border-left:2.5px solid var(--bronze);margin-bottom:9px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.sc{border:1px solid var(--rule2);border-radius:4px;overflow:hidden}.sc-h{background:var(--royal);padding:5px 12px;font-size:7.5px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45);font-weight:600;font-family:var(--mono)}
.sc-row{display:flex;justify-content:space-between;align-items:center;padding:4.5px 12px;border-bottom:1px solid var(--rule2);font-size:9.5px}.sc-row:last-child{border:none}
.sc-k{color:var(--ink2)}.sc-v{font-family:var(--mono);font-size:10px;font-weight:500;color:var(--ink)}
.ctbl{width:100%;border-collapse:collapse;font-size:9px}.ctbl thead tr{background:var(--royal)}
.ctbl th{color:rgba(255,255,255,.5);font-size:7.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;padding:6px 8px;text-align:left;white-space:nowrap;font-family:var(--mono)}
.ctbl td{padding:5.5px 8px;border-bottom:1px solid var(--rule2);vertical-align:middle}.ctbl tr:last-child td{border:none}
.av{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;margin-right:4px;vertical-align:middle;flex-shrink:0}
.vel-g{font-size:7px;font-weight:700;padding:1.5px 5px;border-radius:2px;background:var(--sageBg);color:var(--sage)}
.vel-s{font-size:7px;font-weight:700;padding:1.5px 5px;border-radius:2px;background:var(--s3);color:var(--ink3);border:1px solid var(--rule)}
.vel-c{font-size:7px;font-weight:700;padding:1.5px 5px;border-radius:2px;background:var(--siennaBg);color:var(--sienna)}
.ibar{display:flex;align-items:center;gap:4px}.itr{width:38px;height:2.5px;background:var(--rule2);border-radius:1px;overflow:hidden}.ifl{height:100%;background:var(--steel);border-radius:1px}
.rcard{border:1px solid;border-radius:4px;padding:10px 12px}.rcard-r{border-color:#EDBBBB;background:var(--crimBg)}.rcard-a{border-color:#EDD1AA;background:var(--siennaBg)}.rcard-s{border-color:var(--rule2);background:var(--s2)}
.rc-ico{font-size:15px;margin-bottom:4px}.rc-lbl{font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
.rcard-r .rc-lbl{color:var(--crimson)}.rcard-a .rc-lbl{color:var(--sienna)}.rcard-s .rc-lbl{color:var(--ink3)}
.rc-num{font-family:var(--mono);font-size:26px;line-height:1.1;margin-bottom:3px}.rcard-r .rc-num{color:var(--crimson)}.rcard-a .rc-num{color:var(--sienna)}.rcard-s .rc-num{color:var(--ink3)}
.rc-txt{font-size:8.5px;color:var(--ink2);line-height:1.55}
.rrow{display:flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--rule2);border-radius:3px;margin-bottom:4px;font-size:9px}.rrow:last-child{margin-bottom:0}
.rn{font-weight:700;flex:1}.rrl{font-size:8.5px;color:var(--ink3)}.rtag{font-size:7.5px;font-weight:700;padding:1.5px 7px;border-radius:2px}.rt-r{background:var(--crimBg);color:var(--crimson)}.rt-a{background:var(--siennaBg);color:var(--sienna)}
.vbar-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}.vbar-lbl{width:68px;font-size:9.5px;font-weight:600;flex-shrink:0}.vbar-tr{flex:1;height:7px;background:var(--rule2);border-radius:4px;overflow:hidden}.vbar-f{height:100%;border-radius:4px}.vbar-ct{font-family:var(--mono);font-size:10px;width:18px;text-align:right;flex-shrink:0}.vbar-pct{font-size:8.5px;color:var(--ink3);width:28px;flex-shrink:0}
.dbar-row{display:flex;align-items:center;gap:7px;margin-bottom:4.5px}.dbar-lbl{width:95px;font-size:9px;color:var(--ink2);flex-shrink:0}.dbar-tr{flex:1;height:5.5px;background:var(--rule2);border-radius:3px;overflow:hidden}.dbar-f{height:100%;border-radius:3px}.dbar-st{font-size:8px;font-weight:700;width:40px;text-align:right;flex-shrink:0}
.reco{display:flex;gap:12px;padding:9px 12px;border:1px solid var(--rule2);border-radius:4px;border-left:2.5px solid;margin-bottom:7px}.reco:last-child{margin-bottom:0}
.reco-r{border-left-color:var(--crimson)}.reco-a{border-left-color:var(--sienna)}.reco-b{border-left-color:var(--steel)}
.reco-num{font-family:var(--head);font-size:22px;color:var(--rule);flex-shrink:0;line-height:1.1}.reco-title{font-size:10.5px;font-weight:700;margin-bottom:1.5px}.reco-role{font-size:8.5px;color:var(--ink3);margin-bottom:4px}.reco-body{font-size:9.5px;color:var(--ink2);line-height:1.65}
.reco-pri{font-size:7.5px;font-weight:700;padding:1.5px 7px;border-radius:2px;margin-top:5px;display:inline-block}.pri-r{background:var(--crimBg);color:var(--crimson)}.pri-a{background:var(--siennaBg);color:var(--sienna)}.pri-b{background:var(--steelBg);color:var(--steel)}
.meth{margin-bottom:11px;padding-bottom:11px;border-bottom:1px solid var(--rule2)}.meth:last-child{border:none;margin:0;padding:0}
.meth-name{font-size:10px;font-weight:700;color:var(--royal);margin-bottom:3px}.meth-f{font-family:var(--mono);font-size:8px;background:var(--code-bg);border:1px solid var(--code-border);border-radius:3px;padding:5.5px 9px;margin:4px 0;color:var(--code-color);display:block;line-height:1.8;white-space:pre-wrap}.meth-d{font-size:9.5px;color:var(--ink2);line-height:1.65}
.glo{display:flex;gap:9px;padding:7px 10px;border:1px solid var(--rule2);border-radius:3px;margin-bottom:4.5px;background:var(--s2)}.glo:last-child{margin-bottom:0}
.glo-n{font-family:var(--mono);font-size:8px;color:var(--bronze);width:16px;flex-shrink:0;margin-top:1px;font-weight:500}.glo-term{font-size:9.5px;font-weight:700;color:var(--royal);margin-bottom:2px}.glo-lbl{font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--bronze);margin-bottom:2px}.glo-txt{font-size:8.5px;color:var(--ink2);line-height:1.55}
.pf{display:flex;justify-content:space-between;align-items:center;padding:8px 26px;background:var(--s3);border-top:1px solid var(--rule2);font-size:7.5px;color:var(--ink3)}
.pf-r{font-family:var(--mono)}
.back{background:var(--royal);padding:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;justify-content:center;min-height:60px}
@media print{.toolbar{display:none!important}.page{margin-bottom:0;page-break-after:always}.page:last-of-type{page-break-after:auto}}
</style></head><body>
<div class="toolbar">
  <span class="toolbar-label">ONA Handover Pack · ${this._esc(name)} · ${today}</span>
  <button class="btn-dl" onclick="window.print()">↓ Download PDF</button>
</div>
<div class="doc">

<!-- COVER -->
<div class="page"><div class="cover-outer">
  <div class="cover-top-bar"></div>
  <div class="cover-body">
    <div class="cover-main">
      <div class="cover-eye">ONA Relationship Intelligence · Genpact Salesforce Practice</div>
      <div class="cover-rule"></div>
      <div class="cover-acct">${this._esc(name)}</div>
      <div class="cover-title">Relationship<br>Handover Pack</div>
      <div class="cover-subtitle">Complete account intelligence. All scores computed from live Salesforce data — no manual input required.</div>
      <div class="cover-kpi-mini">
        <div class="ckpi" style="border-color:${sc(covScore)}22"><div class="ckpi-l">Coverage</div><div class="ckpi-v" style="color:${sc(covScore)}">${covScore}<span style="font-size:12px">%</span></div><div class="ckpi-bar"><div class="ckpi-fill" style="width:${covScore}%;background:${sc(covScore)}"></div></div><span class="ckpi-b" style="background:${sb(covScore)};color:${sc(covScore)}">${sn(covScore)}</span></div>
        <div class="ckpi" style="border-color:${sc(mtScore)}22"><div class="ckpi-l">Multi-thread</div><div class="ckpi-v" style="color:${sc(mtScore)}">${mtScore}<span style="font-size:12px">%</span></div><div class="ckpi-bar"><div class="ckpi-fill" style="width:${mtScore}%;background:${sc(mtScore)}"></div></div><span class="ckpi-b" style="background:${sb(mtScore)};color:${sc(mtScore)}">${sn(mtScore)}</span></div>
        <div class="ckpi" style="border-color:${sc(netScore)}22"><div class="ckpi-l">Network Score</div><div class="ckpi-v" style="color:${sc(netScore)}">${netScore}<span style="font-size:12px">%</span></div><div class="ckpi-bar"><div class="ckpi-fill" style="width:${netScore}%;background:${sc(netScore)}"></div></div><span class="ckpi-b" style="background:${sb(netScore)};color:${sc(netScore)}">${sn(netScore)}</span></div>
      </div>
      <div class="cover-insight"><strong style="color:var(--royal)">Incoming rep brief:</strong> ${spof.length ? `${spof[0].name} is a single-point-of-failure. ` : ''}${decayRisk.length ? `${decayRisk.length} contact${decayRisk.length>1?'s':''} at decay risk. ` : ''}${dark.length ? `${dark.length} dark contacts with zero activity. ` : ''}Growing contacts: ${growing.length} of ${nodes.length}.</div>
    </div>
    <div class="cover-sidebar">
      <div style="font-size:7.5px;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:14px">Document Metadata</div>
      <div class="csf"><div class="csf-l">Account</div><div class="csf-v">${this._esc(name)}</div></div>
      <div class="csf"><div class="csf-l">Generated</div><div class="csf-v">${today}</div></div>
      <div class="csf"><div class="csf-l">Contacts Mapped</div><div class="csf-v">${nodes.length} contacts · ${edges.length} edges</div></div>
      <div class="csf"><div class="csf-l">Hub Contacts</div><div class="csf-v">${hubs.length} hubs</div></div>
      <div class="csf"><div class="csf-l">Growing</div><div class="csf-v" style="color:var(--bronzeL)">${growing.length} contacts (${nodes.length?Math.round(growing.length/nodes.length*100):0}%)</div></div>
      <div class="csf"><div class="csf-l">Cooling</div><div class="csf-v" style="color:var(--bronzeL)">${cooling.length} contacts</div></div>
      <div class="csf"><div class="csf-l">At Decay Risk</div><div class="csf-v">${decayRisk.length} contacts</div></div>
      <div class="csf"><div class="csf-l">Dark Contacts</div><div class="csf-v">${dark.length} contacts</div></div>
      <div class="csf"><div class="csf-l">Algorithm Suite</div><div class="csf-v">11 graph algorithms</div></div>
      <div class="cover-conf">Confidential · Internal Use Only</div>
    </div>
  </div>
</div></div>

<!-- BUYING COMMITTEE -->
<div class="page"><div class="sec">
  <div class="sh"><span class="sh-num">02</span><span class="sh-t">Buying Committee Map</span><span class="sh-pill pill-n">${nodes.length} Contacts · All ONA Scores</span></div>
  <table class="ctbl"><thead><tr><th>Contact</th><th>Title</th><th>Dept</th><th>Influence</th><th>Centrality</th><th>Betweenness</th><th>Decay</th><th>Velocity</th><th>Last Activity</th><th>Team Interactions</th></tr></thead>
  <tbody>${contactRows}<tr><td colspan="10" style="font-size:8.5px;color:var(--ink3);font-style:italic;padding:4px 8px">↳ ${Math.max(0,nodes.length-8)} additional contacts in ONA Network Map. Highlighted rows require immediate attention.</td></tr></tbody></table>
  <div style="margin-top:9px;padding:7px 11px;background:var(--s2);border:1px solid var(--rule2);border-radius:3px;font-size:8.5px;color:var(--ink2)"><strong style="color:var(--royal)">How to read:</strong> Influence = connections × seniority × activity. Centrality = network connectivity index. Betweenness = gatekeeper score. Decay = recency-weighted engagement (100=very active, 0=cold). ⚠ = action required.</div>
</div>
<div class="pf"><span>ONA Relationship Intelligence · Genpact · Confidential</span><span class="pf-r">01 / 05</span></div></div>

<!-- RISK + VELOCITY -->
<div class="page"><div class="sec">
  <div class="sh"><span class="sh-num">03</span><span class="sh-t">Relationship Risk Assessment</span><span class="sh-pill ${spof.length > 0 ? 'pill-r' : 'pill-a'}">${spof.length + decayRisk.length} Risks Identified</span></div>
  <div class="g3" style="margin-bottom:10px">
    <div class="rcard rcard-r"><div class="rc-ico">⚡</div><div class="rc-lbl">Single-Point-of-Failure</div><div class="rc-num">${spof.length}</div><div class="rc-txt">${spof.length ? `${spof[0].name} controls a disproportionate share of activity. Departure would fracture the network.` : 'No SPOF contacts detected — activity is well distributed.'}</div></div>
    <div class="rcard rcard-a"><div class="rc-ico">❄</div><div class="rc-lbl">Relationship Decay Risk</div><div class="rc-num">${decayRisk.length}</div><div class="rc-txt">Contacts below the 35-point decay threshold — engagement has cooled significantly. Re-contact required before renewal.</div></div>
    <div class="rcard rcard-s"><div class="rc-ico">🌑</div><div class="rc-lbl">Dark Contacts</div><div class="rc-num">${dark.length}</div><div class="rc-txt">Zero logged CRM interactions. These stakeholders are completely outside the relationship map.</div></div>
  </div>
  <div class="ssl">At-Risk Contact Detail</div>
  ${riskRows || '<div style="font-size:9px;color:var(--ink3);font-style:italic;padding:6px 0">No at-risk contacts identified — network is in good health.</div>'}
</div>
<div class="sec">
  <div class="g2" style="gap:14px">
    <div>
      <div class="sh" style="margin-bottom:7px"><span class="sh-num">04</span><span class="sh-t">Engagement Velocity</span><span class="sh-pill pill-g">${growing.length} Growing</span></div>
      ${velHTML}
      <div class="narr" style="margin-top:7px;margin-bottom:0;font-size:9px">Growing (${growing.length}) vs cooling (${cooling.length}). ${growing.length > cooling.length ? 'Positive momentum — maintain.' : 'More contacts cooling than growing — intervention needed.'}</div>
    </div>
    <div>
      <div class="sh" style="margin-bottom:7px"><span class="sh-num">05</span><span class="sh-t">Coverage by Department</span></div>
      ${deptRows || '<div style="font-size:9px;color:var(--ink3);font-style:italic">No department data available.</div>'}
    </div>
  </div>
</div>
<div class="pf"><span>ONA Relationship Intelligence · Genpact · Confidential</span><span class="pf-r">02 / 05</span></div></div>

<!-- RECOMMENDATIONS -->
<div class="page"><div class="sec">
  <div class="sh"><span class="sh-num">06</span><span class="sh-t">Priority Actions for Incoming Rep</span><span class="sh-pill pill-r">${recos.length} Actions</span></div>
  ${recoRows || '<div style="font-size:9px;color:var(--ink3);font-style:italic;padding:6px 0">Load account graph to generate recommendations.</div>'}
</div>
<div class="pf"><span>ONA Relationship Intelligence · Genpact · Confidential</span><span class="pf-r">03 / 05</span></div></div>

<!-- METHODOLOGY -->
<div class="page"><div class="sec">
  <div class="sh"><span class="sh-num">07</span><span class="sh-t">How the Scores Are Calculated — Methodology</span><span class="sh-pill pill-n">6 Formulas</span></div>
  <div class="narr" style="margin-bottom:9px;font-size:9px">All scores computed from Salesforce Tasks, Events and OpportunityContactRoles. No manual input. Refresh by loading the ONA graph.</div>
  <div class="g2" style="gap:14px">
    <div>
      <div class="meth"><div class="meth-name">Coverage Score</div><code class="meth-f">Score = (Engaged Depts ÷ Total Depts × 0.60)
     + (Seniority Levels Hit ÷ 5 × 0.40)
Engaged dept = ≥ 3 logged interactions</code><div class="meth-d">Weighted 60% departmental breadth, 40% seniority breadth. Below 40% = vulnerable to veto from anyone outside your circle.</div></div>
      <div class="meth"><div class="meth-name">Multi-thread Risk (HHI)</div><code class="meth-f">HHI = Σ (each contact's activity share²)
Score = (1 − HHI) × 100
activity = emails×3 + meetings×5 + tasks×2</code><div class="meth-d">Herfindahl-Hirschman Index from economics. Below 40 = dangerously single-threaded. Most important number before any renewal.</div></div>
      <div class="meth"><div class="meth-name">Influence Score</div><code class="meth-f">Raw = (connections × 2) + (activities × 3)
     + roleWeight(title)
Weights: C-Level=10,VP=8,Dir=6,Mgr=4,IC=2</code><div class="meth-d">Composite of connection breadth, engagement and seniority. Above 80 = contact whose endorsement moves others.</div></div>
    </div>
    <div>
      <div class="meth"><div class="meth-name">Engagement Decay</div><code class="meth-f">Score = Σ ( weight × e^(−0.18 × months_ago) )
Bands: 70+ Warm · 40–69 Cooling · 0–39 Cold</code><div class="meth-d">Exponential decay — recent interactions outweigh old ones. Below 35 = act now. Below 20 = starting cold regardless of history.</div></div>
      <div class="meth"><div class="meth-name">Velocity Score</div><code class="meth-f">Δ = (last 90d − prior 90d) ÷ prior 90d
Growing: Δ > +15%  Cooling: Δ < −15%</code><div class="meth-d">Direction of travel matters more than level. Growing = act now. Cooling = find out why before it becomes decay.</div></div>
      <div class="meth"><div class="meth-name">Relationship Strength (Edge)</div><code class="meth-f">Strength = emails×3 + meetings×5 + tasks×2
Min threshold: strength ≥ 2 to display</code><div class="meth-d">Meetings count most (×5) — highest-quality signal of a real relationship. Dashed line = weak — verify before using as intro bridge.</div></div>
    </div>
  </div>
</div>
<div class="pf"><span>ONA Relationship Intelligence · Genpact · Confidential</span><span class="pf-r">04 / 05</span></div></div>

<!-- GLOSSARY -->
<div class="page"><div class="sec">
  <div class="sh"><span class="sh-num">08</span><span class="sh-t">Algorithm Glossary — What It Means for You as a Seller</span><span class="sh-pill pill-n">All 11 Algorithms</span></div>
  <div class="g2" style="gap:8px">
    <div>
      <div class="glo"><span class="glo-n">01</span><div><div class="glo-term">Relationship Strength</div><div class="glo-lbl">What it means</div><div class="glo-txt">Thick gold line = strong intro path. Thin dashed = weak — verify before using as a bridge.</div></div></div>
      <div class="glo"><span class="glo-n">02</span><div><div class="glo-term">Influence Score</div><div class="glo-lbl">What it means</div><div class="glo-txt">Above 80 = this contact moves others. Worth 3× the effort. Prioritise in first 30 days.</div></div></div>
      <div class="glo"><span class="glo-n">03</span><div><div class="glo-term">Network Centrality</div><div class="glo-lbl">What it means</div><div class="glo-txt">Gold hub nodes — the people everyone talks to. Get them on side. Losing a hub is a critical event.</div></div></div>
      <div class="glo"><span class="glo-n">04</span><div><div class="glo-term">Recommendation Engine</div><div class="glo-lbl">What it means</div><div class="glo-txt">Top 5 unengaged contacts whose engagement would most accelerate the deal right now.</div></div></div>
      <div class="glo"><span class="glo-n">05</span><div><div class="glo-term">Engagement Decay</div><div class="glo-lbl">What it means</div><div class="glo-txt">Relationship freshness. Score 80 = warm. Score 30 = they have forgotten you. Check before every renewal conversation.</div></div></div>
      <div class="glo"><span class="glo-n">06</span><div><div class="glo-term">Velocity Scoring</div><div class="glo-lbl">What it means</div><div class="glo-txt">↑ Growing = engage now. ↓ Cooling = find out why. More actionable than a static score.</div></div></div>
    </div>
    <div>
      <div class="glo"><span class="glo-n">07</span><div><div class="glo-term">Betweenness Centrality</div><div class="glo-lbl">What it means</div><div class="glo-txt">Gatekeepers — control who talks to whom. Always engage before approaching the groups they bridge.</div></div></div>
      <div class="glo"><span class="glo-n">08</span><div><div class="glo-term">BFS Warm Intro Paths</div><div class="glo-lbl">What it means</div><div class="glo-txt">Mathematically shortest introduction chain. Follow in order — never skip a hop. A 2-hop intro is warmer than a cold approach.</div></div></div>
      <div class="glo"><span class="glo-n">09</span><div><div class="glo-term">Whitespace Analysis</div><div class="glo-lbl">What it means</div><div class="glo-txt">Departments with under 3 interactions. Gaps in Legal, Finance or IT cause surprises at deal close. Fix before renewal.</div></div></div>
      <div class="glo"><span class="glo-n">10</span><div><div class="glo-term">Coverage Score</div><div class="glo-lbl">What it means</div><div class="glo-txt">Below 40% = vulnerable to veto. Above 70% = you have earned the right to be in the room when decisions are made.</div></div></div>
      <div class="glo"><span class="glo-n">11</span><div><div class="glo-term">Multi-thread Risk (HHI)</div><div class="glo-lbl">What it means</div><div class="glo-txt">Below 40 = one person leaving stops your deal. Watch this number — not just the level but the velocity.</div></div></div>
    </div>
  </div>
</div>
<div class="pf"><span>ONA Relationship Intelligence · Genpact · Confidential</span><span class="pf-r">05 / 05</span></div></div>

<div class="back"><div style="font-family:var(--head);font-size:14px;color:rgba(255,255,255,.75)">ONA Relationship Intelligence</div><div style="width:28px;height:1.5px;background:var(--bronzeL);margin:4px 0"></div><div style="font-size:8px;color:rgba(255,255,255,.28);letter-spacing:.14em;text-transform:uppercase">Genpact Salesforce Practice · Confidential · ${today}</div></div>
</div></body></html>`;
    }

    // ── Campaign Creator — handlers ──────────────────────────────────────────

    async _loadScoreTrend(accountId) {
        try {
            const result = await getScoreTrend({ accountId, daysBack: 180 });
            this.trendPoints     = result.points || [];
            this.trendComparison = result.comparison || null;
        } catch(e) {
            // Non-critical — silently skip trend display rather than
            // surfacing an error toast for a secondary feature
            this.trendComparison = null;
            console.warn('[ONA] Score trend unavailable:', e.body ? e.body.message : e.message);
        }
    }

    async handleOpenCampPanel() {
        this.campPanelOpen   = true;
        this.campLastAdded   = '';
        this.campLastId      = '';
        this.campActiveChips = ['cooling','cold','dark'];
        this._autoSelectAtRisk();
        await this._loadExistingCampaigns();
    }

    handleCloseCampPanel() {
        this.campPanelOpen = false;
        this.campDot = this.campSelectedContacts.length > 0;
    }

    _autoSelectAtRisk() {
        if(!this._allNodes.length) return;
        const atRisk = this._allNodes.filter(n=>{
            return n.velocityLabel==='Cooling' || (n.decayScore||0)<40 || (n.totalActivities||0)===0;
        });
        this.campSelectedIds      = atRisk.map(n=>n.contactId);
        this.campSelectedContacts = atRisk.map(n=>({
            contactId:n.contactId, name:n.name, initials:n.initials, title:n.title||'',
            riskLabel:this._riskLabel(n),
            avStyle:`background:${this._nc(n.nodeType)}22;color:${this._nc(n.nodeType)};border:1px solid ${this._nc(n.nodeType)}44`
        }));
        const c=atRisk.length;
        this.campAutoLabel = c>0 ? `${c} at-risk contact${c===1?'':'s'} auto-selected` : 'No at-risk contacts — select manually';
        this.campDot = c>0;
    }

    _riskLabel(n) {
        if((n.totalActivities||0)===0)    return '◉ Dark — no CRM activity';
        if((n.decayScore||0)<40)           return '❄ Cold — decay ' + (n.decayScore||0);
        if(n.velocityLabel==='Cooling')    return '↓ Cooling — engagement dropping';
        return n.title||'';
    }

    handleCampChip(e) {
        const f=e.currentTarget.dataset.filter;
        this.campActiveChips = this.campActiveChips.includes(f)
            ? this.campActiveChips.filter(c=>c!==f)
            : [...this.campActiveChips,f];
        this._applyChipFilter();
    }

    handleCampSelectAll() { this.campActiveChips=['cooling','cold','dark']; this._autoSelectAtRisk(); }

    _applyChipFilter() {
        const chips=this.campActiveChips;
        const filtered=this._allNodes.filter(n=>{
            if(chips.includes('cooling')&&n.velocityLabel==='Cooling') return true;
            if(chips.includes('cold')&&(n.decayScore||0)<40)           return true;
            if(chips.includes('dark')&&(n.totalActivities||0)===0)     return true;
            return false;
        });
        this.campSelectedIds      = filtered.map(n=>n.contactId);
        this.campSelectedContacts = filtered.map(n=>({
            contactId:n.contactId, name:n.name, initials:n.initials, title:n.title||'',
            riskLabel:this._riskLabel(n),
            avStyle:`background:${this._nc(n.nodeType)}22;color:${this._nc(n.nodeType)};border:1px solid ${this._nc(n.nodeType)}44`
        }));
        this.campAutoLabel = `${filtered.length} contact${filtered.length===1?'':'s'} selected`;
    }

    async _loadExistingCampaigns() {
        this.campLoading=true;
        try {
            this.existingCampaigns = await getRecentCampaigns();
        } catch(e) {
            this.dispatchEvent(new ShowToastEvent({ title:'Could not load campaigns', message:e.body?e.body.message:e.message, variant:'warning' }));
        } finally { this.campLoading=false; }
    }

    handleCampModeToggle(e) { this.campMode=e.currentTarget.dataset.mode; this.campLastAdded=''; this.campLastId=''; }

    handleCampPick(e) {
        this.campPickedId=e.target.value;
        const opt=e.target.options[e.target.selectedIndex];
        this.campPickedName=opt?opt.text:'';
        this.campLastAdded=''; this.campLastId='';
    }

    handleNewCampName(e)  { this.newCampName=e.target.value; }
    handleNewCampType(e)  { this.newCampType=e.target.value; }
    handleNewCampStart(e) { this.newCampStart=e.target.value; }
    handleNewCampEnd(e)   { this.newCampEnd=e.target.value; }
    handleCampStatus(e)   { this.campMemberStatus=e.target.value; }
    handleCampStatusBtn(e){ this.campMemberStatus=e.currentTarget.dataset.status; }

    handleCampDeselect(e) {
        const id=e.currentTarget.dataset.id;
        this.campSelectedIds      = this.campSelectedIds.filter(x=>x!==id);
        this.campSelectedContacts = this.campSelectedContacts.filter(c=>c.contactId!==id);
    }

    handleCampClearSelection() {
        this.campSelectedIds=[]; this.campSelectedContacts=[];
        this.campAutoLabel=''; this.campActiveChips=[];
    }

    async handleCampAdd() {
        try {
            let campaignId=this.campPickedId, campaignName=this.campPickedName;
            if(this.campMode==='new') {
                campaignId=await createCampaign({ campName:this.newCampName.trim(), campType:this.newCampType, campStatus:'Planning', startDate:this.newCampStart||null, endDate:this.newCampEnd||null });
                campaignName=this.newCampName.trim();
            }
            if(!campaignId) { this.dispatchEvent(new ShowToastEvent({ title:'No campaign selected', message:'Select or create a campaign first.', variant:'warning' })); return; }
            const result=await addContactsToCampaign({ campaignId, contactIdsJson:JSON.stringify(this.campSelectedIds), memberStatus:this.campMemberStatus });
            this.campLastAdded=result; this.campLastId=campaignId; this.campDot=false;
            this.dispatchEvent(new ShowToastEvent({ title:`Added to "${campaignName}"`, message:result, variant:'success' }));
            this.campSelectedIds=[]; this.campSelectedContacts=[];
        } catch(e) {
            this.dispatchEvent(new ShowToastEvent({ title:'Campaign add failed', message:e.body?e.body.message:e.message, variant:'error', mode:'sticky' }));
        }
    }

    handleOpenCampaign(e) {
        const id=e.currentTarget.dataset.id;
        if(!id) return;
        this[NavigationMixin.Navigate]({ type:'standard__recordPage', attributes:{ recordId:id, objectApiName:'Campaign', actionName:'view' } }, true);
    }



    _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    _err(msg) { this.hasError=true; this.errorMsg=msg; this.isLoading=false; }
}
