import { LightningElement, track, api } from 'lwc';
import { loadScript }      from 'lightning/platformResourceLoader';
import { ShowToastEvent }  from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import D3 from '@salesforce/resourceUrl/d3';

import getAccountGraph      from '@salesforce/apex/ONAController.getAccountGraph';
import getCrossAccountGraph from '@salesforce/apex/ONAController.getCrossAccountGraph';
import getContactInsight    from '@salesforce/apex/ONAController.getContactInsight';
import searchAccounts       from '@salesforce/apex/ONAController.searchAccounts';

// Light (default) and dark colour palettes
const PAL = {
    light: { hub:'#b45309', connector:'#0369a1', bridge:'#4338ca', low:'#94a3b8', hl:'#b45309', lbl:'rgba(15,23,42,.70)' },
    dark:  { hub:'#f0b429', connector:'#38bdf8', bridge:'#818cf8', low:'#64748b', hl:'#f0b429', lbl:'rgba(200,215,235,.80)' }
};

export default class OnaRelationshipMap extends NavigationMixin(LightningElement) {

    @api recordId; // set when placed on Account record page

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

    // Tooltip
    @track tipVisible = false;
    @track tip = { name:'', role:'', acct:'', inf:0, cen:0, con:0 };

    // Stats (left panel KPIs)
    @track stats = { totalContacts:0, totalEdges:0, hubCount:0, clusterCount:0 };

    // Connection highlight sidebar
    @track connNodeName = '';
    @track connList     = [];

    // Right panel
    @track panelOpen = false;
    @track contact   = {};
    @track timeline  = [];
    @track recos     = [];

    // Private D3 refs
    _d3Loaded    = false;
    _sim         = null;
    _zoom        = null;
    _gMain       = null;
    _edgeSel     = null;
    _nodeSel     = null;
    _nodeData    = [];
    _linkData    = [];
    _nodes       = [];
    _edges       = [];
    _graphJson   = null;
    _searchTimer = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    connectedCallback() {
        loadScript(this, D3)
            .then(() => {
                this._d3Loaded = true;
                if (this.recordId) {
                    this.selectedAcctId = this.recordId;
                    this._load();
                }
            })
            .catch(e => this._err('D3 failed to load: ' + e.message));
    }

    disconnectedCallback() { if (this._sim) this._sim.stop(); }

    // ── Computed getters ──────────────────────────────────────────────────────
    get appClass()   { return 'ona-app' + (this.isDark ? ' dark' : ''); }
    get themeIcon()  { return this.isDark ? '☀' : '☾'; }
    get isGlobal()   { return this.mode === 'global'; }
    get hasResults() { return this.accountResults.length > 0; }
    get hasConnections() { return this.connList.length > 0; }
    get hasTimeline()    { return this.timeline.length > 0; }
    get hasRecos()       { return this.recos.length > 0; }

    get accBtnClass() { return 'ona-vbtn' + (this.mode === 'account' ? ' on' : ''); }
    get glbBtnClass() { return 'ona-vbtn' + (this.mode === 'global'  ? ' on' : ''); }
    get panelClass()  { return 'ona-rpanel' + (this.panelOpen ? '' : ' closed'); }
    get tipClass()    { return 'ona-tip' + (this.tipVisible ? ' v' : ''); }

    get iq1Class() { return 'ona-iq' + (this.hlMode === 'connections' ? ' on' : ''); }
    get iq2Class() { return 'ona-iq' + (this.hlMode === 'influence'   ? ' on' : ''); }
    get iq3Class() { return 'ona-iq' + (this.hlMode === 'centrality'  ? ' on' : ''); }
    get iq4Class() { return 'ona-iq' + (this.hlMode === 'engage'      ? ' on' : ''); }

    get pal() { return this.isDark ? PAL.dark : PAL.light; }

    _nc(nodeType) {
        return this.pal[nodeType] || this.pal.connector;
    }

    get avStyle() {
        const c = this._nc(this.contact.nodeType || 'connector');
        return `background:${c}20;color:${c};border-color:${c}`;
    }
    get badgeStyle() {
        const m = { 'Network Hub':'#b45309','Cross-Account Bridge':'#4338ca','Low Engagement':'#94a3b8','Active Connector':'#0369a1' };
        const c = m[this.contact.networkRole] || '#0369a1';
        return `background:${c}15;color:${c}`;
    }
    get infBarStyle() { return `width:${this.contact.influenceScore||0}%;background:${this.pal.hub}`; }
    get cenBarStyle() { return `width:${this.contact.centralityScore||0}%;background:${this.pal.connector}`; }
    get intBarStyle() { return `width:${this.contact.interactionScore||0}%;background:#059669`; }
    get conBarStyle() {
        const p = Math.min((this.contact.connectionCount||0)/20*100,100);
        return `width:${p}%;background:${this.pal.bridge}`;
    }

    // ── Data loading ──────────────────────────────────────────────────────────
    async _load() {
        if (!this._d3Loaded) return;
        this.isLoading  = true;
        this.hasError   = false;
        this.showEmpty  = false;
        this.panelOpen  = false;
        this.connList   = [];
        this.connNodeName = '';

        try {
            let json;
            if (this.mode === 'account' && this.selectedAcctId) {
                json = await getAccountGraph({ accountId: this.selectedAcctId });
            } else if (this.mode === 'global') {
                json = await getCrossAccountGraph({ industry: this.industry || null, anchorAcctId: this.selectedAcctId || null });
            } else {
                this.showEmpty = true; this.isLoading = false; return;
            }
            const payload  = JSON.parse(json);
            this._graphJson = json;
            this._nodes    = payload.nodes || [];
            this._edges    = payload.edges || [];
            this.stats     = {
                totalContacts: payload.totalContacts || 0,
                totalEdges:    payload.totalEdges    || 0,
                hubCount:      payload.hubCount      || 0,
                clusterCount:  payload.clusterCount  || 0
            };
            this._render();
            this._applyHL(this.hlMode);
        } catch (e) {
            this._err(e.body ? e.body.message : e.message);
        } finally {
            this.isLoading = false;
        }
    }

    // ── D3 graph render ───────────────────────────────────────────────────────
    _render() {
        const cont = this.refs.svgContainer;
        if (!cont || !window.d3) return;
        if (this._sim) this._sim.stop();
        cont.innerHTML = '';

        const d3 = window.d3;
        const W  = cont.clientWidth || 800;
        const H  = cont.clientHeight || 600;
        const pal = this.pal;

        const svg = d3.select(cont).append('svg').attr('width','100%').attr('height','100%');
        this._zoom = d3.zoom().scaleExtent([.15, 3.5]).on('zoom', e => this._gMain.attr('transform', e.transform));
        svg.call(this._zoom).on('click', () => { this._clearHL(); this.closePanel(); });
        this._gMain = svg.append('g');

        const nodes = this._nodes.map(n => ({ ...n, x: W/2+(Math.random()-.5)*160, y: H/2+(Math.random()-.5)*160 }));
        const links = this._edges.map(e => ({ ...e, source: e.sourceId, target: e.targetId }));

        // Cluster centre positions — each cluster gravitates to its own point
        // arranged in a circle around the canvas centre so clusters stay together
        const clusterIds  = [...new Set(nodes.map(n => n.clusterId))];
        const numClusters = clusterIds.length || 1;
        const clusterPos  = {};
        const spread      = Math.min(W, H) * 0.22; // how far apart clusters sit
        clusterIds.forEach((cid, i) => {
            const angle = (2 * Math.PI * i) / numClusters - Math.PI / 2;
            clusterPos[cid] = {
                x: W / 2 + spread * Math.cos(angle),
                y: H / 2 + spread * Math.sin(angle)
            };
        });

        this._sim = d3.forceSimulation(nodes)
            // Shorter distances pull connected nodes closer together
            .force('link', d3.forceLink(links).id(d => d.contactId)
                .distance(d => d.weight >= 15 ? 45 : d.weight >= 6 ? 70 : 100)
                .strength(d => d.weight >= 15 ? 1.0 : d.weight >= 6 ? 0.7 : 0.4))
            // Weaker repulsion so nodes don't fly apart
            .force('charge', d3.forceManyBody().strength(-180).distanceMax(220))
            // Strong centre pull keeps everything on screen
            .force('center', d3.forceCenter(W / 2, H / 2).strength(0.08))
            // Cluster gravity — each node is pulled toward its cluster centre
            .force('clusterX', d3.forceX(d => (clusterPos[d.clusterId] || { x: W/2 }).x).strength(0.12))
            .force('clusterY', d3.forceY(d => (clusterPos[d.clusterId] || { y: H/2 }).y).strength(0.12))
            // Prevent overlapping circles
            .force('collision', d3.forceCollide().radius(d => (d.nodeType === 'hub' ? 34 : 24)).strength(0.85))
            // Settle faster
            .alphaDecay(0.028)
            .velocityDecay(0.45);

        const dk = this.isDark;

        // Edge colors — clearly distinct by strength, readable in both modes
        // Strong  → solid gold/amber,  thick,  full opacity
        // Medium  → solid blue,        medium, high opacity
        // Weak    → dashed gray,       thin,   visible but subdued
        const ec  = d => d.weight >= 15
            ? (dk ? '#f0b429' : '#c2700a')   // strong: gold (dark) / deep amber (light)
            : d.weight >= 6
            ? (dk ? '#60a5fa' : '#2563eb')   // medium: sky blue (dark) / royal blue (light)
            : (dk ? '#4b5a6e' : '#9ca3af');  // weak:   slate (dark) / cool gray (light)

        const ew  = d => d.weight >= 15 ? 3.5 : d.weight >= 6 ? 2.0 : 1.2;
        const eop = d => d.weight >= 15 ? 1.0 : d.weight >= 6 ? 0.85 : 0.55;

        this._edgeSel = this._gMain.append('g').selectAll('line').data(links).enter().append('line')
            .attr('stroke',         ec)
            .attr('stroke-width',   ew)
            .attr('stroke-opacity', eop)
            .attr('stroke-dasharray', d => d.weight < 6 ? '5,4' : null)
            .attr('stroke-linecap', 'round');

        const nr = d => d.nodeType==='hub'?25:d.nodeType==='low'?14:19;
        const nc = d => this._nc(d.nodeType);

        this._nodeSel = this._gMain.append('g').selectAll('g').data(nodes).enter().append('g')
            .style('cursor','pointer')
            .call(d3.drag()
                .on('start',(e,d)=>{ if(!e.active)this._sim.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
                .on('drag', (e,d)=>{ d.fx=e.x; d.fy=e.y; })
                .on('end',  (e,d)=>{ if(!e.active)this._sim.alphaTarget(0); d.fx=null; d.fy=null; }))
            .on('click',     (e,d)=>{ e.stopPropagation(); this._nodeClick(d, links, nodes); })
            .on('mouseover', (e,d)=>this._showTip(e,d))
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
            .attr('text-anchor','middle').attr('dy',d=>nr(d)+14)
            .attr('font-family','sans-serif').attr('font-size','11').attr('font-weight','500')
            .attr('fill', pal.lbl).text(d=>(d.name||'').split(' ')[0]);

        this._sim.on('tick', () => {
            this._edgeSel.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
            this._nodeSel.attr('transform',d=>`translate(${d.x},${d.y})`);
        });

        this._nodeData = nodes;
        this._linkData = links;
    }

    // ── Node click — highlight + sidebar + insight panel ─────────────────────
    _nodeClick(clicked, links, nodes) {
        const connEdges = links.filter(e => e.sourceId===clicked.contactId || e.targetId===clicked.contactId);
        const connIds   = new Set([clicked.contactId]);
        connEdges.forEach(e => { connIds.add(e.sourceId); connIds.add(e.targetId); });

        // Dim/highlight nodes
        this._nodeSel.selectAll('._nc').transition().duration(220)
            .attr('opacity',  d => connIds.has(d.contactId) ? 1 : 0.08)
            .attr('stroke-width', d => d.contactId===clicked.contactId ? 3.5 : 2);
        this._nodeSel.selectAll('text').transition().duration(220)
            .attr('opacity', d => connIds.has(d.contactId) ? 1 : 0.08);
        this._nodeSel.selectAll('circle:first-child').transition().duration(220)
            .attr('opacity', d => connIds.has(d.contactId) ? 0.4 : 0.03);

        // Highlight edges in gold
        const hl = this.pal.hl;
        const dk = this.isDark;
        this._edgeSel.transition().duration(220)
            .attr('stroke', e => {
                const hit = e.sourceId===clicked.contactId || e.targetId===clicked.contactId;
                return hit ? hl : (dk?'rgba(74,85,104,.06)':'rgba(148,163,184,.06)');
            })
            .attr('stroke-width', e => {
                const hit = e.sourceId===clicked.contactId || e.targetId===clicked.contactId;
                return hit ? (e.weight>=15?3:e.weight>=6?2:1.5) : .5;
            })
            .attr('opacity', e => (e.sourceId===clicked.contactId||e.targetId===clicked.contactId) ? 1 : .1);

        // Build left sidebar connection list
        const nm = {}; nodes.forEach(n => nm[n.contactId]=n);
        this.connNodeName = clicked.name;
        this.connList = connEdges.map(e => {
            const oId  = e.sourceId===clicked.contactId ? e.targetId : e.sourceId;
            const o    = nm[oId]; if (!o) return null;
            const c    = this._nc(o.nodeType);
            const sl   = e.weight>=15?'Strong':e.weight>=6?'Medium':'Weak';
            const sc   = e.weight>=15?this.pal.hub:e.weight>=6?this.pal.connector:this.pal.low;
            return { id:oId, name:o.name, dotStyle:`background:${c}`, strength:sl, strStyle:`background:${sc}18;color:${sc}` };
        }).filter(Boolean);

        // Open insight panel
        this._openInsight(clicked);
    }

    _clearHL() {
        if (!this._nodeSel || !this._edgeSel) return;
        this.connList = []; this.connNodeName = '';
        this._nodeSel.selectAll('circle').transition().duration(220).attr('opacity',null).attr('stroke-width',null);
        this._nodeSel.selectAll('text').transition().duration(220).attr('opacity',1);
        const dk = this.isDark;
        this._edgeSel.transition().duration(220)
            .attr('stroke',         d => d.weight>=15?(dk?'#f0b429':'#c2700a'):d.weight>=6?(dk?'#60a5fa':'#2563eb'):(dk?'#4b5a6e':'#9ca3af'))
            .attr('stroke-width',   d => d.weight>=15?3.5:d.weight>=6?2.0:1.2)
            .attr('stroke-opacity', d => d.weight>=15?1.0:d.weight>=6?.85:.55)
            .attr('opacity',1);
    }

    // ── Insight panel ─────────────────────────────────────────────────────────
    async _openInsight(n) {
        this.panelOpen    = true;
        this.loadingInsight = true;
        this.timeline     = [];
        this.recos        = [];

        const col = this._nc(n.nodeType);
        this.contact = {
            contactId:       n.contactId,
            name:            n.name,
            initials:        n.initials,
            title:           n.title,
            accountName:     n.accountName,
            department:      n.department,
            nodeType:        n.nodeType,
            networkRole:     n.nodeType==='hub'?'Network Hub':n.nodeType==='bridge'?'Cross-Account Bridge':n.nodeType==='low'?'Low Engagement':'Active Connector',
            influenceScore:  n.influenceScore  || 0,
            centralityScore: n.centralityScore || 0,
            interactionScore:n.interactionScore|| 0,
            connectionCount: n.connectionCount || 0,
            emailCount:      n.emailCount       || 0,
            meetingCount:    n.meetingCount     || 0,
            taskCount:       n.taskCount        || 0,
            lastAct:         n.lastActivityDate ? 'Last activity: '+n.lastActivityDate : 'No recent activity',
            influenceDesc:   (n.influenceScore||0)>=75?'Key influencer':(n.influenceScore||0)>=50?'Moderate influence':'Limited influence',
            centralityDesc:  (n.centralityScore||0)>=70?'Hub — info bridge':(n.centralityScore||0)>=40?'Well connected':'Peripheral',
            interactionDesc: (n.interactionScore||0)>=70?'Highly active in CRM':'Moderate CRM activity',
            connectionsDesc: (n.connectionCount||0)+' direct connections inferred',
        };

        if (!this._graphJson) { this.loadingInsight = false; return; }

        try {
            const payload = JSON.parse(await getContactInsight({ contactId: n.contactId, graphJson: this._graphJson }));

            const TC = { Email:'#4f46e5', Meeting:'#0369a1', Task:'#b45309' };
            const TB = { Email:'rgba(79,70,229,.1)', Meeting:'rgba(3,105,161,.1)', Task:'rgba(180,83,9,.1)' };
            this.timeline = (payload.recentActivity||[]).map((a,i) => ({
                id: a.id||String(i), subject: a.subject, activityType: a.activityType, activityDate: a.activityDate,
                dotStyle:   `background:${TC[a.activityType]||'#64748b'}`,
                badgeStyle: `background:${TB[a.activityType]||'rgba(100,116,139,.1)'};color:${TC[a.activityType]||'#64748b'}`
            }));

            const PC = { Critical:'#dc2626', High:'#b45309', Medium:'#0369a1', Low:'#94a3b8' };
            const PB = { Critical:'rgba(220,38,38,.1)', High:'rgba(180,83,9,.1)', Medium:'rgba(3,105,161,.1)', Low:'rgba(148,163,184,.1)' };
            this.recos = (payload.recommendations||[]).map(r => ({
                candidate:   r.candidate,
                reason:      r.reason,
                priority:    r.priority,
                avStyle:     `background:${this._nc(r.candidate.nodeType)}18;color:${this._nc(r.candidate.nodeType)}`,
                badgeStyle:  `background:${PB[r.priority]};color:${PC[r.priority]}`
            }));
        } catch (e) {
            const msg = e.body ? e.body.message : e.message;
            this.timeline = [];
            this.recos    = [];
            // Show error inline so it's not silent
            this.dispatchEvent(new ShowToastEvent({
                title: 'Could not load insight', message: msg, variant: 'error', mode: 'sticky'
            }));
        } finally {
            this.loadingInsight = false;
        }
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────
    _showTip(e, d) {
        this.tip = { name:d.name, role:d.title, acct:d.accountName, inf:d.influenceScore||0, cen:d.centralityScore||0, con:d.connectionCount||0 };
        this.tipVisible = true; this._moveTip(e);
    }
    _moveTip(e) {
        const tt = this.refs.graphTooltip; if (!tt) return;
        const r  = this.refs.graphContainer.getBoundingClientRect();
        tt.style.left = (e.clientX-r.left+14)+'px'; tt.style.top = (e.clientY-r.top+14)+'px';
    }
    _hideTip() { this.tipVisible = false; }

    // ── Highlight modes ───────────────────────────────────────────────────────
    _applyHL(mode) {
        if (!this._nodeSel) return;
        this._nodeSel.selectAll('._nc').transition().duration(200).attr('opacity', d => {
            if (mode==='influence')  return (d.influenceScore||0) >=60?1:.15;
            if (mode==='centrality') return (d.centralityScore||0)>=50?1:.15;
            if (mode==='engage') {
                const cs = new Set(this._edges.flatMap(e=>[e.sourceId,e.targetId]));
                return (!cs.has(d.contactId)||(d.influenceScore||0)>=70)?1:.15;
            }
            return 1;
        });
    }

    // ── Event handlers ────────────────────────────────────────────────────────
    handleAccountMode() { this.mode='account'; this._load(); }
    handleGlobalMode()  { this.mode='global';  this._load(); }
    handleRefresh()     { this._load(); }
    handleIndustry(e)   { this.industry=e.target.value; this._load(); }

    handleTheme() {
        this.isDark = !this.isDark;
        if (this._nodes.length) { this._render(); this._applyHL(this.hlMode); }
    }

    handleHL(e) {
        this.hlMode = e.currentTarget.dataset.mode;
        this._applyHL(this.hlMode);
    }

    handleZoomIn()    { const s=this.refs.svgContainer.querySelector('svg'); if(s)window.d3.select(s).transition().duration(200).call(this._zoom.scaleBy,1.4); }
    handleZoomOut()   { const s=this.refs.svgContainer.querySelector('svg'); if(s)window.d3.select(s).transition().duration(200).call(this._zoom.scaleBy,.7); }
    handleZoomReset() { const s=this.refs.svgContainer.querySelector('svg'); if(s)window.d3.select(s).transition().duration(500).call(this._zoom.transform,window.d3.zoomIdentity); }

    async handleSearch(e) {
        this.searchTerm = e.target.value;
        this.showDropdown = false;
        clearTimeout(this._searchTimer);
        if (this.searchTerm.length < 2) return;
        this._searchTimer = setTimeout(async () => {
            try {
                this.accountResults = await searchAccounts({ searchTerm: this.searchTerm });
                this.showDropdown   = true;
            } catch(err) { /* ignore */ }
        }, 300);
    }

    handleSearchFocus() { if (this.accountResults.length) this.showDropdown=true; }
    handleSearchBlur()  { setTimeout(()=>{ this.showDropdown=false; }, 200); }

    selectAccount(e) {
        this.selectedAcctId = e.currentTarget.dataset.id;
        this.searchTerm     = e.currentTarget.dataset.name;
        this.showDropdown   = false;
        this.mode           = 'account';
        this._load();
    }

    closePanel() { this.panelOpen=false; this._clearHL(); }

    handleRecoClick(e) {
        const cid  = e.currentTarget.dataset.id;
        const node = this._nodeData.find(n=>n.contactId===cid);
        if (node) this._nodeClick(node, this._linkData, this._nodeData);
    }

    _err(msg) { this.hasError=true; this.errorMsg=msg; this.isLoading=false; }

    // ── GUIDED TOUR ───────────────────────────────────────────────────────────

    // Each step defines: title, body, tip (optional),
    // and a spotlight target { x, y, w, h } in px relative to the app root.
    // Positions are % or fixed offsets that work across screen sizes.
    GUIDE_STEPS = [
        {
            title: 'Welcome to ONA Relationship Intelligence',
            body:  'This guided tour walks you through every part of the app in 8 quick steps. ONA analyses your Salesforce CRM data to answer four key sales questions — with no external AI.',
            tip:   'You can exit the guide at any time by pressing ✕ or clicking outside the highlighted area.',
            zone:  'centre'
        },
        {
            title: 'Step 1 — Search for an account',
            body:  'Type any account name in the search bar to load its relationship network. The graph shows every contact in that account and how they are connected through CRM activity.',
            tip:   'The app loads the top 50 most active contacts based on emails, meetings, and tasks in the last 12 months.',
            zone:  'search'
        },
        {
            title: 'Step 2 — Account vs Cross-Account view',
            body:  'Account mode shows one account\'s internal network. Cross-Account mode builds a graph across your top 20 active accounts — useful for portfolio analysis and spotting shared stakeholders.',
            zone:  'toggle'
        },
        {
            title: 'Step 3 — Network metrics (left panel)',
            body:  'The four KPIs update every time you load a graph. Contacts = nodes on screen. Relationships = inferred edges from CRM. Hubs = highly central contacts. Clusters = buying committees detected.',
            tip:   'A deal with only 1 cluster covered is high risk. You want engagement across all clusters before close.',
            zone:  'kpis'
        },
        {
            title: 'Step 4 — Insight question filters',
            body:  'Q1 shows all connections. Q2 dims low-influence contacts so key stakeholders stand out. Q3 highlights communication hubs. Q4 dims contacts already engaged and surfaces who you should reach next.',
            zone:  'questions'
        },
        {
            title: 'Step 5 — Reading the graph',
            body:  'Large gold-ringed nodes are Hubs — removing them fragments the network. Blue nodes are connectors. Grey small nodes are low-engagement contacts. Edge thickness shows relationship strength.',
            tip:   'Click any node to see exactly who it connects to, with edge strength labelled Strong / Medium / Weak.',
            zone:  'graph'
        },
        {
            title: 'Step 6 — Edge strength legend',
            body:  'Gold thick lines = strong relationships (score ≥ 15). Blue medium lines = regular contact. Grey dashed = weak inferred link. Only use thick lines as warm intro paths — dashed lines are unreliable.',
            zone:  'legend'
        },
        {
            title: 'Step 7 — Contact insight panel',
            body:  'Click any node to open this panel. It shows 4 ONA scores, 12-month activity summary, a recent CRM timeline, and Algorithm 4 recommendations — the top 5 contacts you should engage next with a reason for each.',
            tip:   'Click a recommendation card to jump straight to that contact\'s insight.',
            zone:  'panel'
        },
        {
            title: 'You\'re ready to use ONA',
            body:  'Start by searching for your most important account. Click the hub node first — that is your highest-value conversation. Check the Q4 filter to find your engagement gaps. Use the recommendation cards to prioritise this week\'s outreach.',
            tip:   'Re-open this guide any time using the ? Guide button in the header.',
            zone:  'centre'
        },
    ];

    @track guideOpen    = false;
    @track guideStep    = 0;

    get currentGuideStep() { return this.GUIDE_STEPS[this.guideStep] || this.GUIDE_STEPS[0]; }
    get guideStepLabel()   { return `Step ${this.guideStep + 1} of ${this.GUIDE_STEPS.length}`; }
    get guideNextLabel()   { return this.guideStep === this.GUIDE_STEPS.length - 1 ? 'Finish' : 'Next →'; }
    get isFirstStep()      { return this.guideStep === 0; }
    get isLastStep()       { return this.guideStep === this.GUIDE_STEPS.length - 1; }

    get guideDots() {
        return this.GUIDE_STEPS.map((_, i) => ({ i, cls: 'ona-gc-dot' + (i === this.guideStep ? ' on' : '') }));
    }

    // Spotlight box: returns absolute position within .ona-app
    get spotlightStyle() {
        const r = this._guideRect(this.currentGuideStep.zone);
        if (r.isCentre || this.currentGuideStep.zone === 'centre') {
            // No spotlight for centre steps
            return 'left:50%;top:50%;width:0;height:0;box-shadow:none;outline:none';
        }
        return `left:${Math.round(r.x)}px;top:${Math.round(r.y)}px;width:${Math.round(r.w)}px;height:${Math.round(r.h)}px`;
    }

    // Card position: place card below or above the spotlight so it never covers it
    get guideCardStyle() {
        const r  = this._guideRect(this.currentGuideStep.zone);
        const cw = 320;

        // Get app dimensions from the root element
        const app = this.template.querySelector('.ona-app');
        const aw  = app ? app.clientWidth  : 900;
        const ah  = app ? app.clientHeight : 700;

        // Centre zone: card in the middle of the screen
        if (r.isCentre || this.currentGuideStep.zone === 'centre') {
            return `left:${Math.round((aw - cw) / 2)}px;top:${Math.round(ah * 0.3)}px`;
        }

        // Horizontal: keep card on screen
        let left = Math.min(Math.max(Math.round(r.x), 12), aw - cw - 12);

        // Vertical: below spotlight if room, above if not
        const cardH = 280;
        let top;
        if (r.y + r.h + 16 + cardH < ah) {
            top = Math.round(r.y + r.h + 14);
        } else {
            top = Math.max(Math.round(r.y - cardH - 14), 55);
        }

        return `left:${left}px;top:${top}px`;
    }

    // Zone → bounding rect relative to .ona-app root
    _guideRect(zone) {
        const app = this.template.querySelector('.ona-app');
        if (!app) return { x:0, y:0, w:0, h:0 };
        const ar = app.getBoundingClientRect();

        const selMap = {
            search:    '.ona-search-wrap',
            toggle:    '.ona-vtog',
            kpis:      '.ona-kgrid',
            questions: '.ona-lps:nth-child(2)',
            legend:    '.ona-lps:nth-child(4)',
            graph:     '.ona-garea',
            panel:     '.ona-rpanel',
        };

        const sel = selMap[zone];
        if (!sel) {
            // Centre zone — invisible 0-size spotlight, card centred
            return { x: ar.width/2, y: ar.height/2, w: 0, h: 0, isCentre: true };
        }

        const el = this.template.querySelector(sel);
        if (!el) return { x: 40, y: 40, w: 200, h: 50 };

        const er = el.getBoundingClientRect();
        return {
            x: er.left - ar.left - 4,
            y: er.top  - ar.top  - 4,
            w: er.width  + 8,
            h: er.height + 8
        };
    }

    handleGuide()  { this.guideOpen = true; this.guideStep = 0; }
    closeGuide()   { this.guideOpen = false; }
    stopProp(e)    { e.stopPropagation(); }

    guideNext() {
        if (this.isLastStep) { this.guideOpen = false; }
        else { this.guideStep = this.guideStep + 1; }
    }
    guidePrev() {
        if (!this.isFirstStep) this.guideStep = this.guideStep - 1;
    }
    handleGuideOverlayClick() { this.guideOpen = false; }
}

