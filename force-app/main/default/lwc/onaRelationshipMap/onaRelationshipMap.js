import { LightningElement, track, api } from 'lwc';
import { loadScript }      from 'lightning/platformResourceLoader';
import { ShowToastEvent }  from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import D3 from '@salesforce/resourceUrl/d3';

import getAccountGraph      from '@salesforce/apex/ONAController.getAccountGraph';
import getCrossAccountGraph from '@salesforce/apex/ONAController.getCrossAccountGraph';
import getContactInsight    from '@salesforce/apex/ONAController.getContactInsight';
import getAccountNews       from '@salesforce/apex/ONAController.getAccountNews';
import searchAccounts       from '@salesforce/apex/ONAController.searchAccounts';

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
        body:  'ONA maps the real communication graph inside your Salesforce accounts using 11 graph algorithms. See who knows whom, which relationships are at risk, and where your coverage gaps are — all from CRM data already in your org.',
        tip:   'This tour covers every view and feature. Use arrow keys or buttons to navigate.',
        zone:  null
    },
    {
        title: 'View Selector — Five Ways to Explore',
        body:  'Four cards at the top switch between views: Network Map (single account graph), Cross-Account (multiple accounts with bridge contacts), Portfolio View (health scores across all accounts), and Analytics (advanced graph intelligence with four sub-views).',
        isNew: 'Analytics view is new — it contains Timeline, Power Map, Impact Simulator and Risk Radar.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Search and Load an Account',
        body:  'Type any account name in the search box. A dropdown shows matching accounts from your Salesforce org. Click any result to load the full relationship network for that account.',
        tip:   'Click the search box — accounts appear immediately as you type.',
        zone:  '.ona-search-wrap'
    },
    {
        title: 'Smart Filters — Dynamic and Combinable',
        body:  'Filter chips populate automatically from the loaded data. Only countries, regions and departments that exist in the current account appear. Filters combine — select India + Engineering to isolate just that segment. Clears on every new account load.',
        isNew: 'Filters update the graph instantly without an Apex callout.',
        zone:  '.ona-filter-chips'
    },
    {
        title: 'Network Metrics',
        body:  'Four live counts: Contacts loaded, Relationship edges (shared CRM activity), Hub nodes (centrality above 70), and Clusters (separate buying groups detected by Union-Find algorithm). These four numbers describe the shape of the account at a glance.',
        zone:  '.ona-kgrid'
    },
    {
        title: 'Account Intelligence — Coverage and Multi-thread',
        body:  'Coverage Score measures how broadly you are engaged across departments and seniority levels. Multi-thread Risk shows how concentrated your activity is — low score means one contact controls everything. Whitespace lists departments with no CRM activity logged.',
        isNew: 'Algorithms 9, 10 and 11 running on live Salesforce data. Updates every time you load an account.',
        zone:  '.ona-lps'
    },
    {
        title: 'Q1–Q5 Insight Filters',
        body:  'Five one-click highlight modes that fade out irrelevant contacts. Q1 shows all connections. Q2 highlights the most influential. Q3 highlights communication hubs. Q4 surfaces high-value contacts not yet reached. Q5 — the most powerful — highlights only contacts with growing engagement momentum right now.',
        isNew: 'Q5 Velocity: compares last 90 days vs prior 90 days of email and meeting activity. Green = growing.',
        zone:  '.ona-lps'
    },
    {
        title: 'The Relationship Graph',
        body:  'Gold nodes with a glow ring are Hubs — the information brokers. Blue are Connectors. Grey are Low Engagement. The arrow below each name shows velocity. Edge thickness shows relationship strength — thick gold = Strong (15+), dashed = Weak. Click any node to explore.',
        tip:   'Drag nodes to reposition. Scroll to zoom. Click canvas to reset highlights.',
        zone:  '.ona-garea'
    },
    {
        title: 'Contact Insight Panel',
        body:  'Clicking any node opens the right panel: four ONA score cards (Influence, Centrality, Decay, Betweenness), velocity trend, warm introduction paths showing the exact 2-3 hop route to unconnected contacts, activity summary, recent timeline, and ranked next-engagement recommendations.',
        isNew: 'Warm Intro Paths use BFS to find the shortest introduction route — not just a path exists but the specific name to ask.',
        zone:  '.ona-rpanel'
    },
    {
        title: 'Analytics — Timeline Slider',
        body:  'The Timeline view replays how the account network evolved over the past 6 months. Drag the slider left to see the network as it was months ago — contacts appear or fade as the window changes. Coverage Score and edge count update live so you can see when engagement started growing or declining.',
        isNew: 'The slider simulates historical network state using activity timestamps from your CRM data.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Analytics — Power Map',
        body:  'Power Map positions contacts by organisational seniority — C-Level at top, VP/Director below, Manager, then Individual Contributors. Node size reflects the metric you choose (Influence, Centrality or Betweenness). Colour shows Velocity, Node type or Seniority. Edges show who is connected cross-hierarchy.',
        tip:   'Set Size to Influence and Colour to Velocity to instantly see your most influential growing contacts.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Analytics — Impact Simulator',
        body:  'Select any contact and simulate what happens when they leave or become unresponsive. The graph removes them and redraws. The side panel shows a before/after comparison: Coverage, Multi-thread Risk, edges removed, and which contacts become isolated. Hub nodes trigger a high-risk warning.',
        isNew: 'This answers the question: if my champion leaves, what breaks? Use it before renewals or QBRs.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Analytics — Risk Radar',
        body:  'Risk Radar overlays risk signals on the network graph. At-risk contacts glow with a coloured dashed ring and are highlighted at full opacity — others fade. Filter by: Single-point-of-failure (controls 35%+ of activity), Relationship decay (score below 35), or No CRM activity (zero logged interactions).',
        isNew: 'Click any highlighted node in the graph to jump to its entry in the risk list on the right.',
        zone:  '.ona-view-cards'
    },
    {
        title: 'Portfolio View and External Signals',
        body:  'Portfolio View ranks all your accounts by Coverage Score with dual progress bars per row. Click any account to see its full health detail, relationship scores, top contacts by influence, and live external news signals fetched from GNews API — partnerships, acquisitions, leadership changes.',
        isNew: 'The Relationship Summary bell icon gives a consolidated popup of any loaded account without leaving the current view.',
        zone:  '.ona-view-cards'
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
    @track searchTerm     = '';
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
    @track portfolioStats     = { total:0, atRisk:0, healthy:0 };
    @track selectedAccount    = null;
    @track hasPortfolioSelected = false;

    // News signals
    @track accountNews  = [];
    @track newsLoading  = false;

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

            // Populate dynamic filter dropdowns
            this._populateFilterOptions(this._allNodes);
            // Populate portfolio accounts
            this._buildPortfolioAccounts(p);

            this._render();
            this._applyHL(this.hlMode);
            this.bellDot = true;
            if(this.summaryOpen) this._buildSummary();
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
            .on('mouseout',  ()=>this._hideTip());

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
        this.tip = { name:d.name, role:d.title, acct:d.accountName||'', inf:d.influenceScore||0, cen:d.centralityScore||0, btw:d.betweennessScore||0, con:d.connectionCount||0, velArrow:d.velocityArrow||'→', velLabel:d.velocityLabel||'Stable', velStyle:`background:${vc.bg};color:${vc.color}` };
        this.tipVisible=true; this._moveTip(e);
    }
    _moveTip(e) { const tt=this.refs.graphTooltip; if(!tt) return; const r=this.refs.graphContainer.getBoundingClientRect(); tt.style.left=(e.clientX-r.left+14)+'px'; tt.style.top=(e.clientY-r.top+14)+'px'; }
    _hideTip()  { this.tipVisible=false; }

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
        this.searchTerm=e.target.value; this.showDropdown=false;
        clearTimeout(this._searchTimer);
        if(this.searchTerm.length<2) return;
        this._searchTimer=setTimeout(async()=>{
            try {
                const results = await searchAccounts({searchTerm:this.searchTerm});
                this.accountResults = results.map(r=>({ ...r, nameInitial:r.Name?r.Name[0]:'?' }));
                this.showDropdown=true;
            } catch{ /* ignore */ }
        },300);
    }
    handleSearchFocus() { if(this.accountResults.length) this.showDropdown=true; }
    handleSearchBlur()  { setTimeout(()=>{ this.showDropdown=false; },200); }
    selectAccount(e)    { this.selectedAcctId=e.currentTarget.dataset.id; this.searchTerm=e.currentTarget.dataset.name; this.showDropdown=false; this.mode='account'; this._load(); }

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

    get summaryBellClass() { return 'ona-bell-btn' + (this.summaryOpen?' active':''); }

        // ── Analytics handlers ───────────────────────────────────────────────────
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

        _err(msg) { this.hasError=true; this.errorMsg=msg; this.isLoading=false; }
}
