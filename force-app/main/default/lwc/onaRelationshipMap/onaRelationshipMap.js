import { LightningElement, track, api } from 'lwc';
import { loadScript }      from 'lightning/platformResourceLoader';
import { ShowToastEvent }  from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import D3 from '@salesforce/resourceUrl/d3';

import getAccountGraph      from '@salesforce/apex/ONAController.getAccountGraph';
import getCrossAccountGraph from '@salesforce/apex/ONAController.getCrossAccountGraph';
import getContactInsight    from '@salesforce/apex/ONAController.getContactInsight';
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

// ── Guide steps (10 steps including Phase 2) ──────────────────────────────────
const GUIDE_STEPS = [
    {
        title: 'Welcome to ONA Phase 2',
        body:  'Phase 2 adds 7 new algorithms across 3 categories: temporal analytics (Engagement Decay + Velocity), advanced graph topology (Betweenness Centrality + BFS Shortest Path), and sales intelligence (Whitespace, Coverage Score, Multi-thread Risk).',
        tip:   'Click ? Guide any time to re-open this tour.',
        zone:  null
    },
    {
        title: 'Account Intelligence panel',
        body:  'The left panel now shows three account-level metrics — Coverage Score, Multi-thread Risk, and Whitespace — updated every time you load a graph. No manual input required.',
        isNew: 'All computed from your live Salesforce CRM data using Alg 9, 10, and 11.',
        zone:  '.ona-lps:nth-child(2)'
    },
    {
        title: 'Coverage Score (Alg 10)',
        body:  'Measures what % of your buying committee is engaged across departments AND seniority levels. Below 40% means you are talking to a very narrow slice of the decision-making group.',
        tip:   'A deal with Coverage < 40% is statistically 3× more likely to stall at final approval.',
        zone:  '.ona-lps:nth-child(2)'
    },
    {
        title: 'Multi-thread Risk (Alg 11)',
        body:  'Uses the Herfindahl-Hirschman Index to measure how concentrated your CRM activity is. If 80% flows through one contact, you have a dangerous single-thread. Score of 100% = perfectly distributed.',
        isNew: 'Same formula used in economics to measure market concentration.',
        zone:  '.ona-lps:nth-child(2)'
    },
    {
        title: 'Whitespace gaps (Alg 9)',
        body:  'Shows every department in the account with a colour-coded badge — Engaged (green) or Gap (red). Departments with fewer than 3 CRM activities are flagged as whitespace. These are your blind spots.',
        zone:  '.ona-lps:nth-child(2)'
    },
    {
        title: 'Q5 Velocity filter (Alg 6)',
        body:  'The new Q5 question highlights only warming contacts — those whose CRM activity is growing vs 6 months ago. Use it to find relationships gaining momentum before your competitors do.',
        isNew: 'Compares last 90 days vs prior 90 days of email and meeting activity.',
        zone:  '.ona-lps:nth-child(3)'
    },
    {
        title: 'Velocity arrows on nodes (Alg 6)',
        body:  'Every node shows a ↑ ↓ → under the contact name. Gold hub nodes with ↑ are your highest-value growing relationships. Grey nodes with ↓ need urgent attention before they go cold.',
        zone:  '.ona-garea'
    },
    {
        title: 'Decay score + Betweenness (Alg 5 + 7)',
        body:  'Click any node to see two new score cards. Decay Score shows whether the relationship is healthy right now (not just historically). Betweenness shows if the contact acts as a gatekeeper bridging separate clusters.',
        tip:   'High Betweenness + low Decay = the most strategically important contact to engage this week.',
        zone:  '.ona-garea'
    },
    {
        title: 'Warm intro paths (Alg 8 — BFS)',
        body:  'The insight panel now shows exact intro routes using Breadth-First Search. Instead of "a path exists", you see the exact chain: You → Rohan → Sara → CFO. The precise sequence of introductions to request.',
        isNew: 'BFS shortest path algorithm — guaranteed to find the minimum number of hops.',
        zone:  '.ona-rpanel'
    },
    {
        title: 'You are ready for Phase 2',
        body:  'Start by checking Coverage and Whitespace gaps in the Account Intelligence panel. Then click the highest-Betweenness node to find your strategic gatekeeper. Use Warm Intro Paths to reach contacts you have never met.',
        tip:   'Re-open this guide any time using the ? Guide button.',
        zone:  null
    }
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

    // Mode
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

    // Account Intelligence (Phase 2)
    @track accountIntel  = null;
    @track whitespace    = [];

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

    // Guide
    @track guideOpen = false;
    @track guideStep = 0;

    // Private D3 refs
    _d3Loaded   = false;
    _sim        = null;
    _zoom       = null;
    _gMain      = null;
    _edgeSel    = null;
    _nodeSel    = null;
    _nodeData   = [];
    _linkData   = [];
    _nodes      = [];
    _edges      = [];
    _graphJson  = null;
    _searchTimer= null;

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
    get appClass()   { return 'ona-app' + (this.isDark ? ' dark' : ''); }
    get themeIcon()  { return this.isDark ? '☀' : '☾'; }
    get isGlobal()   { return this.mode === 'global'; }
    get hasResults() { return this.accountResults.length > 0; }
    get hasConnections()  { return this.connList.length > 0; }
    get hasTimeline()     { return this.timeline.length > 0; }
    get hasRecos()        { return this.recos.length > 0; }
    get hasIntroPaths()   { return this.introPaths.length > 0; }
    get hasAccountIntel() { return this.accountIntel !== null; }

    get accBtnClass() { return 'ona-vbtn' + (this.mode==='account'?' on':''); }
    get glbBtnClass() { return 'ona-vbtn' + (this.mode==='global' ?' on':''); }
    get panelClass()  { return 'ona-rpanel' + (this.panelOpen?'':' closed'); }
    get tipClass()    { return 'ona-tip' + (this.tipVisible?' v':''); }
    get iq1Class()    { return 'ona-iq' + (this.hlMode==='connections'?' on':''); }
    get iq2Class()    { return 'ona-iq' + (this.hlMode==='influence'  ?' on':''); }
    get iq3Class()    { return 'ona-iq' + (this.hlMode==='centrality' ?' on':''); }
    get iq4Class()    { return 'ona-iq' + (this.hlMode==='engage'     ?' on':''); }
    get iq5Class()    { return 'ona-iq' + (this.hlMode==='velocity'   ?' on':''); }

    get pal() { return this.isDark ? PAL.dark : PAL.light; }
    _nc(type) { return this.pal[type] || this.pal.connector; }

    // Account Intelligence styles
    get covBarStyle() {
        const s = this.accountIntel?.coverageScore || 0;
        const c = s>=70?'#0369a1':s>=40?'#b45309':'#dc2626';
        return `width:${s}%;background:${c}`;
    }
    get covBadgeStyle() {
        const b = this.accountIntel?.coverageBadge;
        if(b==='Good')     return 'background:#dcfce7;color:#15803d';
        if(b==='Moderate') return 'background:#fef3c7;color:#92400e';
        return 'background:#fee2e2;color:#991b1b';
    }
    get covDesc() {
        const s = this.accountIntel?.coverageScore || 0;
        return s>=70?'Buying committee well covered.':s>=40?'Moderate coverage — broaden engagement.':'Low coverage — critical stakeholders missing.';
    }
    get mtBarStyle() {
        const s = this.accountIntel?.multiThreadScore || 0;
        const c = s>=70?'#059669':s>=40?'#b45309':'#dc2626';
        return `width:${s}%;background:${c}`;
    }
    get mtBadgeStyle() {
        const b = this.accountIntel?.multiThreadBadge;
        if(b==='Healthy')  return 'background:#dcfce7;color:#15803d';
        if(b==='Moderate') return 'background:#fef3c7;color:#92400e';
        return 'background:#fee2e2;color:#991b1b';
    }
    get mtDesc() {
        const s = this.accountIntel?.multiThreadScore || 0;
        return s>=70?'Activity well distributed.':s>=40?'Some concentration — broaden outreach.':'Single-thread risk — if this contact leaves, deal is at risk.';
    }

    // Contact insight styles
    get avStyle() {
        const c = this._nc(this.contact.nodeType||'connector');
        return `background:${c}20;color:${c};border-color:${c}`;
    }
    get badgeStyle() {
        const map={'Network Hub':'#b45309','Gatekeeper':'#4338ca','Key Influencer':'#0369a1','Active Contact':'#0369a1','Low Engagement':'#94a3b8','Cooling Contact':'#dc2626','Central Communicator':'#0369a1','Cross-Account Bridge':'#4338ca'};
        const c = map[this.contact.networkRole] || '#0369a1';
        return `background:${c}15;color:${c}`;
    }
    get infBarStyle()  { return `width:${this.contact.influenceScore||0}%;background:${this.pal.hub}`; }
    get cenBarStyle()  { return `width:${this.contact.centralityScore||0}%;background:${this.pal.connector}`; }
    get decBarStyle()  { return `width:${this.contact.decayScore||0}%;background:#059669`; }
    get betwBarStyle() { return `width:${this.contact.betweennessScore||0}%;background:#4338ca`; }

    get velBigStyle() {
        const v = VEL_COLORS[this.contact.velocityLabel] || VEL_COLORS.Stable;
        return `color:${v.color}`;
    }
    get velLabelStyle() {
        const v = VEL_COLORS[this.contact.velocityLabel] || VEL_COLORS.Stable;
        return `color:${v.color}`;
    }

    // ── Data load ─────────────────────────────────────────────────────────────
    async _load() {
        if (!this._d3Loaded) return;
        this.isLoading = true; this.hasError = false; this.showEmpty = false;
        this.panelOpen = false; this.connList = []; this.accountIntel = null;
        try {
            let json;
            if (this.mode==='account' && this.selectedAcctId)
                json = await getAccountGraph({ accountId: this.selectedAcctId });
            else if (this.mode==='global')
                json = await getCrossAccountGraph({ industry: this.industry||null, anchorId: this.selectedAcctId||null });
            else { this.showEmpty=true; this.isLoading=false; return; }

            const p = JSON.parse(json);
            this._graphJson = json;
            this._nodes = p.nodes || [];
            this._edges = p.edges || [];
            this.stats  = { totalContacts:p.totalContacts||0, totalEdges:p.totalEdges||0, hubCount:p.hubCount||0, clusterCount:p.clusterCount||0 };

            // Phase 2: Account Intelligence
            if (p.accountIntel) {
                this.accountIntel = p.accountIntel;
                this.whitespace = (p.accountIntel.whitespace||[]).map(w => ({
                    ...w,
                    statusLabel: w.engaged ? 'Engaged' : 'Gap',
                    statusStyle: w.engaged
                        ? 'background:#dcfce7;color:#15803d'
                        : 'background:#fee2e2;color:#991b1b'
                }));
            }
            this._render();
            this._applyHL(this.hlMode);
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
            .force('link', d3.forceLink(links).id(d=>d.contactId)
                .distance(d=>d.weight>=15?45:d.weight>=6?70:100)
                .strength(d=>d.weight>=15?1.0:d.weight>=6?.7:.4))
            .force('charge', d3.forceManyBody().strength(-180).distanceMax(220))
            .force('center', d3.forceCenter(W/2,H/2).strength(0.08))
            .force('clusterX', d3.forceX(d=>(clusterPos[d.clusterId]||{x:W/2}).x).strength(0.12))
            .force('clusterY', d3.forceY(d=>(clusterPos[d.clusterId]||{y:H/2}).y).strength(0.12))
            .force('collision', d3.forceCollide().radius(d=>d.nodeType==='hub'?38:28).strength(0.85))
            .alphaDecay(0.028).velocityDecay(0.45);

        const dk = this.isDark;

        // Edges
        this._edgeSel = this._gMain.append('g').selectAll('line').data(links).enter().append('line')
            .attr('stroke', d=>d.weight>=15?(dk?'#d4a840':'#b45309'):d.weight>=6?'#4a7fa8':(dk?'#3a4a5c':'#b0bec5'))
            .attr('stroke-width', d=>d.weight>=15?3:d.weight>=6?1.8:1.2)
            .attr('stroke-opacity', d=>d.weight>=15?.85:d.weight>=6?.65:.40)
            .attr('stroke-dasharray', d=>d.weight<6?'5,4':null);

        const nr = d => d.nodeType==='hub'?25:d.nodeType==='low'?14:19;
        const nc = d => this._nc(d.nodeType);

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

        // Hub glow ring
        this._nodeSel.filter(d=>d.nodeType==='hub').append('circle')
            .attr('r',d=>nr(d)+9).attr('fill','none').attr('stroke',nc).attr('stroke-width',1).attr('opacity',.35);

        // Main circle
        this._nodeSel.append('circle').attr('class','_nc')
            .attr('r',nr).attr('fill',d=>nc(d)+(dk?'28':'22')).attr('stroke',nc)
            .attr('stroke-width',d=>d.nodeType==='hub'?2.5:2);

        // Initials
        this._nodeSel.append('text').attr('class','_ni')
            .attr('text-anchor','middle').attr('dominant-baseline','central')
            .attr('font-family','sans-serif').attr('font-size',d=>d.nodeType==='hub'?13:11)
            .attr('font-weight','700').attr('fill',nc).text(d=>d.initials||'');

        // Name label
        this._nodeSel.append('text').attr('class','_nl')
            .attr('text-anchor','middle').attr('dy',d=>nr(d)+13)
            .attr('font-family','sans-serif').attr('font-size','11').attr('font-weight','500')
            .attr('fill', pal.lbl).text(d=>(d.name||'').split(' ')[0]);

        // Velocity arrow — Phase 2 NEW
        const velColor = d => {
            const vc = VEL_COLORS[d.velocityLabel] || VEL_COLORS.Stable;
            return vc.color;
        };
        this._nodeSel.append('text').attr('class','_nv')
            .attr('text-anchor','middle').attr('dy',d=>nr(d)+26)
            .attr('font-family','sans-serif').attr('font-size','12').attr('font-weight','700')
            .attr('fill',velColor).text(d=>d.velocityArrow||'→');

        this._sim.on('tick',()=>{
            this._edgeSel.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
                          .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
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
            .attr('opacity', d=>connIds.has(d.contactId)?1:0.08)
            .attr('stroke-width', d=>d.contactId===clicked.contactId?3.5:2);
        this._nodeSel.selectAll('text').transition().duration(220)
            .attr('opacity', d=>connIds.has(d.contactId)?1:0.08);
        this._nodeSel.selectAll('circle:first-child').transition().duration(220)
            .attr('opacity', d=>connIds.has(d.contactId)?0.4:0.03);

        const hl = this.pal.hl, dk = this.isDark;
        this._edgeSel.transition().duration(220)
            .attr('stroke', e=>{ const h=e.sourceId===clicked.contactId||e.targetId===clicked.contactId; return h?hl:(dk?'rgba(74,85,104,.06)':'rgba(148,163,184,.06)'); })
            .attr('stroke-width', e=>{ const h=e.sourceId===clicked.contactId||e.targetId===clicked.contactId; return h?(e.weight>=15?3:e.weight>=6?2:1.5):.5; })
            .attr('opacity', e=>(e.sourceId===clicked.contactId||e.targetId===clicked.contactId)?1:.1);

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
        this.panelOpen = true; this.loadingInsight = true;
        this.timeline=[]; this.recos=[]; this.introPaths=[];

        const velConfig = VEL_COLORS[n.velocityLabel] || VEL_COLORS.Stable;
        const velRaw    = parseFloat(n.velocityRaw || 0);

        this.contact = {
            contactId:       n.contactId,
            name:            n.name,
            initials:        n.initials,
            title:           n.title,
            accountName:     n.accountName,
            department:      n.department,
            nodeType:        n.nodeType,
            networkRole:     this._networkRole(n),
            // Phase 1 scores
            influenceScore:  n.influenceScore  || 0,
            centralityScore: n.centralityScore || 0,
            influenceDesc:   (n.influenceScore||0)>=75?'Key influencer':(n.influenceScore||0)>=50?'Moderate influence':'Limited influence',
            centralityDesc:  (n.centralityScore||0)>=70?'Hub — info bridge':(n.centralityScore||0)>=40?'Well connected':'Peripheral',
            // Phase 2 scores
            decayScore:      n.decayScore      || 0,
            betweennessScore:n.betweennessScore|| 0,
            decayDesc:       (n.decayScore||0)>=70?'Relationship currently active':(n.decayScore||0)>=40?'Moderate — some fade':'Cold — little recent engagement',
            betweennessDesc: (n.betweennessScore||0)>=70?'Key gatekeeper — bridges clusters':(n.betweennessScore||0)>=40?'Moderate bridge role':'Low brokerage role',
            // Velocity
            velocityLabel:   n.velocityLabel || 'Stable',
            velocityArrow:   n.velocityArrow || '→',
            velocityDesc:    velRaw>0.15
                ?`Activity increasing by ${Math.round(velRaw*100)}% — warming up. Good time to engage.`
                :velRaw<-0.15
                ?`Activity dropped by ${Math.round(Math.abs(velRaw)*100)}% — cooling. Act before it goes cold.`
                :'Activity stable over the past 6 months.',
            // Activity
            emailCount:      n.emailCount   || 0,
            meetingCount:    n.meetingCount || 0,
            taskCount:       n.taskCount    || 0,
            lastAct:         n.lastActivityDate ? `Last activity: ${n.lastActivityDate}` : 'No recent activity',
        };

        if (!this._graphJson) { this.loadingInsight=false; return; }

        try {
            const payload = JSON.parse(
                await getContactInsight({ contactId:n.contactId, graphJson:this._graphJson })
            );

            // Timeline
            const TC={Email:'#4f46e5',Meeting:'#0369a1',Task:'#b45309'};
            const TB={Email:'rgba(79,70,229,.1)',Meeting:'rgba(3,105,161,.1)',Task:'rgba(180,83,9,.1)'};
            this.timeline = (payload.recentActivity||[]).map((a,i)=>({
                id:a.id||String(i), subject:a.subject, activityType:a.activityType, activityDate:a.activityDate,
                dotStyle:`background:${TC[a.activityType]||'#64748b'}`,
                badgeStyle:`background:${TB[a.activityType]||'rgba(100,116,139,.1)'};color:${TC[a.activityType]||'#64748b'}`
            }));

            // Recommendations
            const PC={Critical:'#dc2626',High:'#b45309',Medium:'#0369a1',Low:'#94a3b8'};
            const PB={Critical:'rgba(220,38,38,.1)',High:'rgba(180,83,9,.1)',Medium:'rgba(3,105,161,.1)',Low:'rgba(148,163,184,.1)'};
            this.recos = (payload.recommendations||[]).map(r=>({
                candidate:  r.candidate,
                reason:     r.reason,
                priority:   r.priority,
                avStyle:    `background:${this._nc(r.candidate.nodeType)}18;color:${this._nc(r.candidate.nodeType)}`,
                badgeStyle: `background:${PB[r.priority]};color:${PC[r.priority]}`
            }));

            // Intro paths — Phase 2
            this.introPaths = (payload.introPaths||[]).map(p=>({
                targetContactId: p.targetContactId,
                targetName:      p.targetName,
                hopCount:        p.hopCount,
                steps: (p.pathNames||[]).map((name,i)=>({
                    id:       `${p.targetContactId}-${i}`,
                    nodeKey:  `${p.targetContactId}-n-${i}`,
                    arrowKey: `${p.targetContactId}-a-${i}`,
                    name:     (name||'').split(' ')[0],
                    isTarget: i === (p.pathNames.length-1),
                    nodeClass:i === (p.pathNames.length-1) ? 'ona-path-target' : 'ona-path-node'
                }))
            }));

        } catch(e) {
            this.dispatchEvent(new ShowToastEvent({
                title:'Insight error', message:e.body?e.body.message:e.message, variant:'error', mode:'sticky'
            }));
        } finally {
            this.loadingInsight = false;
        }
    }

    _networkRole(n) {
        if(n.nodeType==='hub')        return 'Network Hub';
        if((n.betweennessScore||0)>=60)return 'Gatekeeper';
        if((n.influenceScore||0)>=75)  return 'Key Influencer';
        if((n.centralityScore||0)>=50) return 'Central Communicator';
        if(n.velocityLabel==='Cooling')return 'Cooling Contact';
        if((n.totalActivities||0)<5)   return 'Low Engagement';
        return 'Active Contact';
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────
    _showTip(e,d) {
        const vc = VEL_COLORS[d.velocityLabel] || VEL_COLORS.Stable;
        this.tip = {
            name:d.name, role:d.title, acct:d.accountName||'',
            inf:d.influenceScore||0, cen:d.centralityScore||0,
            btw:d.betweennessScore||0, con:d.connectionCount||0,
            velArrow:d.velocityArrow||'→', velLabel:d.velocityLabel||'Stable',
            velStyle:`background:${vc.bg};color:${vc.color}`
        };
        this.tipVisible=true; this._moveTip(e);
    }
    _moveTip(e) {
        const tt=this.refs.graphTooltip; if(!tt) return;
        const r=this.refs.graphContainer.getBoundingClientRect();
        tt.style.left=(e.clientX-r.left+14)+'px'; tt.style.top=(e.clientY-r.top+14)+'px';
    }
    _hideTip() { this.tipVisible=false; }

    // ── Highlight modes ───────────────────────────────────────────────────────
    _applyHL(mode) {
        if(!this._nodeSel) return;
        this._nodeSel.selectAll('._nc').transition().duration(200).attr('opacity',d=>{
            if(mode==='influence')  return(d.influenceScore||0)>=60?1:.15;
            if(mode==='centrality') return(d.centralityScore||0)>=50?1:.15;
            if(mode==='engage'){
                const cs=new Set(this._edges.flatMap(e=>[e.sourceId,e.targetId]));
                return(!cs.has(d.contactId)||(d.influenceScore||0)>=70)?1:.15;
            }
            if(mode==='velocity')   return d.velocityLabel==='Growing'?1:.15;
            return 1;
        });
    }

    // ── Event handlers ────────────────────────────────────────────────────────
    handleAccountMode()  { this.mode='account'; this._load(); }
    handleGlobalMode()   { this.mode='global';  this._load(); }
    handleRefresh()      { this._load(); }
    handleIndustry(e)    { this.industry=e.target.value; this._load(); }
    handleTheme()        { this.isDark=!this.isDark; if(this._nodes.length){this._render();this._applyHL(this.hlMode);} }
    handleHL(e)          { this.hlMode=e.currentTarget.dataset.mode; this._applyHL(this.hlMode); }
    handleZoomIn()       { const s=this.refs.svgContainer.querySelector('svg'); if(s)window.d3.select(s).transition().duration(200).call(this._zoom.scaleBy,1.4); }
    handleZoomOut()      { const s=this.refs.svgContainer.querySelector('svg'); if(s)window.d3.select(s).transition().duration(200).call(this._zoom.scaleBy,.7); }
    handleZoomReset()    { const s=this.refs.svgContainer.querySelector('svg'); if(s)window.d3.select(s).transition().duration(500).call(this._zoom.transform,window.d3.zoomIdentity); }
    closePanel()         { this.panelOpen=false; this._clearHL(); }
    handleRecoClick(e)   { const n=this._nodeData.find(nd=>nd.contactId===e.currentTarget.dataset.id); if(n)this._nodeClick(n,this._linkData,this._nodeData); }

    async handleSearch(e) {
        this.searchTerm=e.target.value; this.showDropdown=false;
        clearTimeout(this._searchTimer);
        if(this.searchTerm.length<2) return;
        this._searchTimer=setTimeout(async()=>{
            try{ this.accountResults=await searchAccounts({searchTerm:this.searchTerm}); this.showDropdown=true; }
            catch{ /* ignore */ }
        },300);
    }
    handleSearchFocus() { if(this.accountResults.length) this.showDropdown=true; }
    handleSearchBlur()  { setTimeout(()=>{ this.showDropdown=false; },200); }
    selectAccount(e)    { this.selectedAcctId=e.currentTarget.dataset.id; this.searchTerm=e.currentTarget.dataset.name; this.showDropdown=false; this.mode='account'; this._load(); }

    // ── Guided tour ───────────────────────────────────────────────────────────
    get currentStep()    { return GUIDE_STEPS[this.guideStep] || GUIDE_STEPS[0]; }
    get guideStepLabel() { return `Step ${this.guideStep+1} of ${GUIDE_STEPS.length}`; }
    get guideNextLabel() { return this.guideStep===GUIDE_STEPS.length-1?'Finish':'Next →'; }
    get isFirstStep()    { return this.guideStep===0; }
    get guideDots()      { return GUIDE_STEPS.map((_,i)=>({i,cls:'ona-gc-dot'+(i===this.guideStep?' on':'')})); }

    get spotlightStyle() {
        const r = this._guideRect(this.currentStep.zone);
        if(r.isCentre) return 'left:50%;top:50%;width:0;height:0;box-shadow:none;outline:none';
        return `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    }
    get guideCardStyle() {
        const r  = this._guideRect(this.currentStep.zone);
        const app= this.template.querySelector('.ona-app');
        const aw = app?app.clientWidth:900, ah=app?app.clientHeight:700;
        const cw = 330;
        if(r.isCentre) return `left:${Math.round((aw-cw)/2)}px;top:${Math.round(ah*0.3)}px`;
        let left = Math.min(Math.max(Math.round(r.x),12),aw-cw-12);
        let top  = r.y+r.h+14+300<ah ? Math.round(r.y+r.h+14) : Math.max(Math.round(r.y-300-14),55);
        return `left:${left}px;top:${top}px`;
    }
    _guideRect(sel) {
        const app = this.template.querySelector('.ona-app');
        if(!app||!sel) return {isCentre:true};
        const ar = app.getBoundingClientRect();
        const el = this.template.querySelector(sel);
        if(!el) return {isCentre:true};
        const er = el.getBoundingClientRect();
        return { x:er.left-ar.left-4, y:er.top-ar.top-4, w:er.width+8, h:er.height+8 };
    }

    handleGuide()  { this.guideOpen=true; this.guideStep=0; }
    closeGuide()   { this.guideOpen=false; }
    stopProp(e)    { e.stopPropagation(); }
    guideNext()    { if(this.guideStep===GUIDE_STEPS.length-1){this.guideOpen=false;}else{this.guideStep=this.guideStep+1;} }
    guidePrev()    { if(!this.isFirstStep) this.guideStep=this.guideStep-1; }
    handleGuideOverlayClick() { this.guideOpen=false; }

    _err(msg) { this.hasError=true; this.errorMsg=msg; this.isLoading=false; }
}
