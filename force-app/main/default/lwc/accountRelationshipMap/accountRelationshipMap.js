import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, getFieldValue, refreshApex } from 'lightning/uiRecordApi';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import ACCOUNT_NAME_FIELD     from '@salesforce/schema/Account.Name';
import ACCOUNT_INDUSTRY_FIELD from '@salesforce/schema/Account.Industry';
import getAccountContacts       from '@salesforce/apex/AccountRelationshipMapController.getAccountContacts';
import getContactConnections    from '@salesforce/apex/AccountRelationshipMapController.getContactConnections';
import getAccountTeam           from '@salesforce/apex/AccountRelationshipMapController.getAccountTeam';
import createContact            from '@salesforce/apex/AccountRelationshipMapController.createContact';
import saveContactRoles         from '@salesforce/apex/AccountRelationshipMapController.saveContactRoles';
import saveContactAttribute     from '@salesforce/apex/AccountRelationshipMapController.saveContactAttribute';
import getContactRequiredFields from '@salesforce/apex/AccountRelationshipMapController.getContactRequiredFields';

const ACCOUNT_FIELDS = [ACCOUNT_NAME_FIELD, ACCOUNT_INDUSTRY_FIELD];

const DEPT_COLORS = {
    Executive         : '#0176d3',
    Sales             : '#534AB7',
    Marketing         : '#0F6E56',
    'Customer Success': '#854F0B'
};
const RING_COLORS   = { high: '#1D9E75', medium: '#EF9F27', low: '#E24B4A' };
const STATUS_COLORS = { active: '#1D9E75', warm: '#EF9F27', cold: '#E24B4A' };

const ROLES = {
    dm  : { label: 'Decision Maker', cls: 'arm-pill arm-role-dm' },
    ch  : { label: 'Champion',       cls: 'arm-pill arm-role-ch' },
    inf : { label: 'Influencer',     cls: 'arm-pill arm-role-inf' },
    eu  : { label: 'End User',       cls: 'arm-pill arm-role-eu' },
    ev  : { label: 'Evaluator',      cls: 'arm-pill arm-role-ev' }
};
const ROLE_TOGGLE_ON = {
    dm  : 'arm-role-toggle arm-rt-on-dm',
    ch  : 'arm-role-toggle arm-rt-on-ch',
    inf : 'arm-role-toggle arm-rt-on-inf',
    eu  : 'arm-role-toggle arm-rt-on-eu',
    ev  : 'arm-role-toggle arm-rt-on-ev'
};
const LEVELS     = ['C-Suite', 'VP Level', 'Director', 'Manager', 'Individual'];
const DEPTS      = ['Executive', 'Sales', 'Marketing', 'Customer Success'];
const CONN_TYPES = ['Reports to', 'Peer', 'Collaborates with', 'Influences', 'Blocks'];
const LETTERS    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const CC_BASE_FIELDS = [
    { key: 'FirstName',   label: 'First Name',  type: 'text',   required: true  },
    { key: 'LastName',    label: 'Last Name',   type: 'text',   required: true  },
    { key: 'Email',       label: 'Email',       type: 'email',  required: true  },
    { key: 'Title',       label: 'Title',       type: 'text',   required: false },
    { key: 'Department',  label: 'Department',  type: 'select', required: false,
      options: DEPTS.map(d => ({ value: d, label: d })) },
    { key: 'Phone',       label: 'Phone',       type: 'tel',    required: false },
    { key: 'ReportsToId', label: 'Reports to',  type: 'lookup', required: false }
];

export default class AccountRelationshipMap extends NavigationMixin(LightningElement) {

    @api recordId;

    // ── State ─────────────────────────────────────────────────────────────
    @track _contacts     = [];
    @track _view         = 'list';
    @track _search       = '';
    @track _deptFilter   = 'All';
    @track _azFilter     = '';
    @track _selId        = null;
    @track _dark         = false;
    @track _panelTab     = 'info';
    @track _connections  = null;
    @track _connLoading  = false;
    @track _accountTeam  = [];
    @track _teamLoading  = false;
    @track isLoading     = true;
    @track errorMessage  = null;

    // Quick Connect
    @track qcOpen    = false;
    @track _qcFrom   = null;
    @track _qcTo     = null;
    @track _qcType   = 'Peer';
    @track _qcSearch = '';

    // Create Contact
    @track ccOpen         = false;
    @track _ccFields      = {};
    @track _ccExtraFields = [];
    @track _ccSaving      = false;

    // Toast
    @track toastVisible = false;
    @track toastMessage = '';

    _toastTimer;
    _manualConns = {};
    _dragId      = null;
    _wiredContacts;

    // ── FIX: accountName/accountIndustry tracked properly ─────────────────
    @track accountName     = '';
    @track accountIndustry = '';

    // ── Wires ─────────────────────────────────────────────────────────────
    @wire(getRecord, { recordId: '$recordId', fields: ACCOUNT_FIELDS })
    wiredAccount({ data, error }) {
        if (data) {
            this.accountName     = getFieldValue(data, ACCOUNT_NAME_FIELD)     || '';
            this.accountIndustry = getFieldValue(data, ACCOUNT_INDUSTRY_FIELD) || '';
        }
        if (error) {
            this.accountName     = '';
            this.accountIndustry = '';
        }
    }

    @wire(getAccountContacts, { accountId: '$recordId' })
    wiredContacts(result) {
        this._wiredContacts = result;
        this.isLoading = false;
        if (result.data) {
            this._contacts = result.data.map(c => this._enrich(c));
            try { if (localStorage.getItem('arm-theme') === 'dark') this._dark = true; } catch(e) { /* */ }
        }
        if (result.error) this.errorMessage = 'Failed to load contacts. Please refresh.';
    }

    // ── FIX: Account team loaded via wire — previously _accountTeam stayed
    //         empty because the imperative call was never triggered properly
    @wire(getAccountTeam, { accountId: '$recordId' })
    wiredTeam({ data, error }) {
        if (data) {
            this._accountTeam = data.members || [];
        }
        if (error) {
            this._accountTeam = [];
        }
    }

    @wire(getContactRequiredFields)
    wiredRequiredFields({ data }) {
        if (data) this._ccExtraFields = data;
    }

    // ── Enrich ────────────────────────────────────────────────────────────
    _enrich(c) {
        const dept   = c.Department || null;
        const col    = DEPT_COLORS[dept] || '#888888';
        const score  = c.engagementScore  || 0;
        const rel    = c.relationshipStrength || 0;
        const status = score >= 70 ? 'active' : score >= 40 ? 'warm' : 'cold';
        const sCo    = STATUS_COLORS[status];
        const rc     = this._ringColor(score);
        // Parse roles from Buyer_Roles__c if present (semicolon delimited)
        let roles = c.roles || [];
        if (c.Buyer_Roles__c) {
            roles = c.Buyer_Roles__c.split(';').map(r => r.trim()).filter(r => r);
        }
        return {
            ...c,
            initials            : this._initials(c.Name),
            avatarStyle         : `background:${col}`,
            accentStyle         : `background:${col}`,
            ringStyle           : `border-color:${rc}`,
            deptColor           : col,
            ringColor           : rc,
            deptDisplay         : dept || 'Standalone',
            titleDisplay        : c.Title || 'No title',
            reportsToName       : c.ReportsToName || '—',
            statusLabel         : status.charAt(0).toUpperCase() + status.slice(1),
            engagementLabel     : this._engLabel(score),
            pillClass           : 'arm-pill ' + this._pillCls(score),
            totalActivities     : (c.taskCount || 0) + (c.eventCount || 0),
            emailHref           : 'mailto:' + (c.Email || ''),
            deptTagStyle        : `border-color:${col}55;color:${col}`,
            statusTagStyle      : `color:${sCo};border-color:${sCo}55`,
            relStrengthStyle    : `width:${rel}%;background:${this._engColor(rel)}`,
            relStrengthValStyle : `color:${this._engColor(rel)}`,
            engagementStyle     : `width:${score}%;background:${this._engColor(score)}`,
            engagementValStyle  : `color:${this._engColor(score)}`,
            oppCount            : (c.opportunities || []).length,
            hasNoOpps           : !(c.opportunities || []).length,
            hasNoTimeline       : !(c.timeline || []).length,
            gridCardClass       : 'arm-gc',
            listRowClass        : 'arm-cr',
            roles               : roles,
            seniority           : c.seniority || 'Individual',
            roleBadges          : this._roleBadges(roles),
            opportunities: (c.opportunities || []).map(o => ({
                ...o,
                amountFormatted: o.amount ? '$' + (o.amount / 1000).toFixed(0) + 'K' : '—',
                barStyle: `background:${this._engColor(o.probability || 0)}`
            })),
            timeline: (c.timeline || []).map(t => ({
                ...t,
                iconStyle: `background:${this._tlColor(t.subtype)}`,
                iconChar : this._tlChar(t.subtype)
            }))
        };
    }

    _postProcess(contacts) {
        return contacts.map(c => {
            const drs = contacts.filter(x => x.ReportsToId === c.Id);
            return {
                ...c,
                isStandalone      : !c.ReportsToId && drs.length === 0,
                directReports     : drs.map(dr => ({ ...dr, ringStyle: `border-color:${dr.ringColor}` })),
                directReportCount : drs.length,
                hasNoDirectReports: drs.length === 0
            };
        });
    }

    // ── Filtering ─────────────────────────────────────────────────────────
    get _filtered() {
        const processed = this._postProcess(this._contacts);
        const q = (this._search || '').toLowerCase().trim();
        return processed.filter(c => {
            const qm = !q
                || c.Name.toLowerCase().includes(q)
                || (c.Title || '').toLowerCase().includes(q)
                || (c.Department || '').toLowerCase().includes(q);
            const sa = c.isStandalone;
            const dm = this._deptFilter === 'All'        ? true
                     : this._deptFilter === 'Standalone' ? sa
                     : c.Department === this._deptFilter;
            const az = !this._azFilter || c.Name.toUpperCase().startsWith(this._azFilter);
            return qm && dm && az;
        });
    }
    get filteredContacts() { return this._filtered; }

    // ── Sidebar ───────────────────────────────────────────────────────────
    get totalContacts()         { return this._contacts.length; }
    get highEngagementCount()   { return this._contacts.filter(c => (c.engagementScore || 0) >= 70).length; }
    get totalActivities()       { return this._contacts.reduce((s, c) => s + (c.taskCount || 0) + (c.eventCount || 0), 0); }
    get openPipelineFormatted() {
        const t = this._contacts.flatMap(c => c.opportunities || []).reduce((s, o) => s + (o.amount || 0), 0);
        return t >= 1000000 ? '$' + (t / 1000000).toFixed(1) + 'M' : '$' + (t / 1000).toFixed(0) + 'K';
    }
    get deptStrip() {
        const map = {};
        this._contacts.filter(c => c.Department).forEach(c => map[c.Department] = (map[c.Department] || 0) + 1);
        return Object.entries(map).map(([dept, n]) => ({
            dept, style: `flex:${n};background:${DEPT_COLORS[dept] || '#888'};height:100%`
        }));
    }
    get deptFilters() {
        const depts = ['All', ...[...new Set(this._contacts.filter(c => c.Department).map(c => c.Department))], 'Standalone'];
        return depts.map(d => {
            const on  = this._deptFilter === d;
            const col = DEPT_COLORS[d];
            return {
                label      : d,
                btnClass   : on ? 'arm-df arm-df-on' : 'arm-df',
                activeStyle: on && col ? `background:${col};border-color:${col}` : ''
            };
        });
    }
    get azLetters() {
        const used = new Set(this._contacts.map(c => c.Name && c.Name[0] ? c.Name[0].toUpperCase() : ''));
        return LETTERS.map(l => ({
            letter  : l,
            btnClass: 'arm-az-btn' + (this._azFilter === l ? ' arm-az-on' : '') + (!used.has(l) ? ' arm-az-dim' : ''),
            disabled: !used.has(l)
        }));
    }
    get hasActiveFilter() { return !!(this._azFilter || this._deptFilter !== 'All' || this._search); }

    // ── View ──────────────────────────────────────────────────────────────
    get isListView()  { return this._view === 'list'; }
    get isGridView()  { return this._view === 'grid'; }
    get isTreeView()  { return this._view === 'tree'; }
    get viewTitle()   { return this._view === 'list' ? 'Contact List' : this._view === 'grid' ? 'Contact Grid' : 'Org Hierarchy'; }
    get viewCount()   { const n = this._filtered.length; return n === 1 ? '1 contact' : n + ' contacts'; }
    get isEmpty()     { return !this.isLoading && !this.hasError && this._filtered.length === 0; }
    get hasError()    { return !!this.errorMessage; }
    get listBtnClass(){ return this._view === 'list' ? 'arm-vsw-btn arm-vsw-on' : 'arm-vsw-btn'; }
    get gridBtnClass(){ return this._view === 'grid' ? 'arm-vsw-btn arm-vsw-on' : 'arm-vsw-btn'; }
    get treeBtnClass(){ return this._view === 'tree' ? 'arm-vsw-btn arm-vsw-on' : 'arm-vsw-btn'; }
    get appClass()    { return this._dark ? 'arm-app arm-dark' : 'arm-app'; }
    get themeIcon()   { return this._dark ? '☀' : '🌙'; }

    // ── List groups ───────────────────────────────────────────────────────
    get listGroups() {
        const f   = this._filtered;
        const ids = new Set(f.map(c => c.Id));
        const ch  = {}; f.forEach(c => { ch[c.Id] = []; });
        const roots = [], stand = [];
        f.forEach(c => {
            if (c.isStandalone) stand.push(c);
            else if (c.ReportsToId && ids.has(c.ReportsToId)) ch[c.ReportsToId].push(c.Id);
            else roots.push(c.Id);
        });
        const byId    = id => f.find(c => c.Id === id);
        const flatten = (id, depth) => {
            const c = byId(id); if (!c) return [];
            const rows = [{ ...c, indentStyle: depth > 0 ? `padding-left:${depth * 18 + 8}px` : '' }];
            (ch[id] || []).forEach(k => rows.push(...flatten(k, depth + 1)));
            return rows;
        };
        const dG = {};
        roots.forEach(r => {
            const c = byId(r); if (c) {
                const d = c.Department || 'Other';
                if (!dG[d]) dG[d] = [];
                dG[d].push(r);
            }
        });
        const groups = Object.entries(dG).map(([dept, rids]) => ({
            dept,
            dotStyle: `background:${DEPT_COLORS[dept] || '#888'}`,
            rows    : rids.flatMap(r => flatten(r, 0))
        }));
        if (stand.length) groups.push({ dept: 'Standalone', dotStyle: 'background:#888', rows: stand });
        return groups;
    }

    // ── Panel ─────────────────────────────────────────────────────────────
    get hasSelectedContact() { return !!this._selId; }
    get selectedContact() {
        if (!this._selId) return null;
        return this._postProcess(this._contacts).find(c => c.Id === this._selId) || null;
    }

    // ── FIX: each tab boolean is a clean independent getter ───────────────
    get isInfoTab()        { return this._panelTab === 'info'; }
    get isTeamTab()        { return this._panelTab === 'team'; }
    get isAttributesTab()  { return this._panelTab === 'attrs'; }
    get isConnectionsTab() { return this._panelTab === 'connections'; }

    // ── FIX: tab CSS classes built as full strings, no string concatenation
    //         that could return undefined and silently break LWC rendering ──
    get infoTabClass() {
        return this._panelTab === 'info' ? 'arm-ptab arm-ptab-on' : 'arm-ptab';
    }
    get teamTabClass() {
        return this._panelTab === 'team' ? 'arm-ptab arm-ptab-on' : 'arm-ptab';
    }
    get attrsTabClass() {
        return this._panelTab === 'attrs' ? 'arm-ptab arm-ptab-on' : 'arm-ptab';
    }
    get connTabClass() {
        return this._panelTab === 'connections'
            ? 'arm-ptab arm-ptab-conn arm-ptab-on'
            : 'arm-ptab arm-ptab-conn';
    }
    get connTabLabel() {
        const n = this.connectionsList.length;
        return n > 0 ? 'Connections (' + n + ')' : 'Connections';
    }

    // ── Connections list ──────────────────────────────────────────────────
    get connectionsList() {
        if (!this._selId) return [];
        const auto = (this._connections && this._connections.connections
            ? this._connections.connections : []).map(conn => ({
            ...conn,
            strengthStyle   : `width:${conn.connectionStrength}%;background:${this._engColor(conn.connectionStrength)}`,
            strengthValStyle: `color:${this._engColor(conn.connectionStrength)}`,
            strengthPct     : conn.connectionStrength,
            avatarStyle     : `background:${DEPT_COLORS[conn.contactDepartment] || '#888'}`,
            ringStyle       : `border-color:${this._ringColor(conn.connectionStrength)}`,
            initials        : this._initials(conn.contactName),
            titleDisplay    : conn.contactTitle || 'No title',
            hasOpps         : (conn.sharedOpportunities || []).length > 0,
            hasActivities   : (conn.sharedActivityCount || 0) > 0,
            sharedOppsLabel : (conn.sharedOpportunities || []).length + ' shared opp',
            sharedActsLabel : (conn.sharedActivityCount || 0) + ' activities',
            pillClass       : 'arm-pill ' + this._pillCls(conn.connectionStrength),
            engLabel        : this._engLabel(conn.connectionStrength),
            connType        : null
        }));
        const manual = (this._manualConns[this._selId] || []).map(conn => ({
            ...conn,
            strengthStyle   : `width:${conn.connectionStrength}%;background:${this._engColor(conn.connectionStrength)}`,
            strengthValStyle: `color:${this._engColor(conn.connectionStrength)}`,
            strengthPct     : conn.connectionStrength,
            avatarStyle     : `background:${DEPT_COLORS[conn.contactDepartment] || '#888'}`,
            ringStyle       : `border-color:${this._ringColor(conn.connectionStrength)}`,
            initials        : this._initials(conn.contactName),
            titleDisplay    : conn.contactTitle || 'No title',
            hasOpps: false, hasActivities: false, sharedOppsLabel: '', sharedActsLabel: '',
            pillClass: 'arm-pill ' + this._pillCls(conn.connectionStrength),
            engLabel : this._engLabel(conn.connectionStrength)
        }));
        return [...auto, ...manual];
    }
    get hasConnections()   { return !this._connLoading && this.connectionsList.length > 0; }
    get hasNoConnections() { return !this._connLoading && this.connectionsList.length === 0; }

    // ── FIX: Account team getters — guard against undefined/null safely ───
    get hasAccountTeam()  { return Array.isArray(this._accountTeam) && this._accountTeam.length > 0; }
    get noAccountTeam()   { return !this.hasAccountTeam; }
    get accountTeamCount(){ return Array.isArray(this._accountTeam) ? this._accountTeam.length : 0; }

    get teamMembersFormatted() {
        if (!Array.isArray(this._accountTeam)) return [];
        return this._accountTeam.map(m => ({
            ...m,
            initials   : this._initials(m.userName || ''),
            avatarStyle: `background:${this._teamColor(m.role || '')}`
        }));
    }

    get selectedContactTeamOwner() {
        const c = this.selectedContact;
        if (!c || !c.teamTouched || !c.ownerName) return null;
        return {
            ownerName  : c.ownerName,
            ownerRole  : c.ownerRole || '',
            initials   : this._initials(c.ownerName),
            avatarStyle: `background:${this._teamColor(c.ownerRole || '')}`
        };
    }
    get hasTeamOwner()   { return !!this.selectedContactTeamOwner; }
    get noTeamCoverage() { return !this.hasTeamOwner; }

    // Role pills always visible in panel header
    get selectedRoleBadges() {
        const c = this.selectedContact;
        return c ? this._roleBadges(c.roles || []) : [];
    }
    get hasRoleBadges() { return this.selectedRoleBadges.length > 0; }

    // ── FIX: Attributes tab getters — seniority/dept options now guard
    //         against undefined selectedContact before mapping ─────────────
    get roleToggles() {
        const c = this.selectedContact;
        if (!c) return [];
        return Object.entries(ROLES).map(([key, r]) => {
            const on = (c.roles || []).includes(key);
            return {
                key,
                label   : r.label,
                btnClass: on ? ROLE_TOGGLE_ON[key] : 'arm-role-toggle'
            };
        });
    }
    get seniorityOptions() {
        const c = this.selectedContact;
        if (!c) return [];
        return LEVELS.map(l => ({ value: l, label: l, selected: (c.seniority || 'Individual') === l }));
    }
    get deptOptions() {
        const c = this.selectedContact;
        if (!c) return [];
        return DEPTS.map(d => ({ value: d, label: d, selected: (c.Department || '') === d }));
    }
    get reportsToOptions() {
        const c = this.selectedContact;
        if (!c) return [];
        const desc = this._getDescendants(c.Id);
        const opts = [{ value: '', label: '— None —', selected: !c.ReportsToId }];
        this._contacts
            .filter(x => x.Id !== c.Id && !desc.includes(x.Id))
            .forEach(x => opts.push({ value: x.Id, label: x.Name, selected: c.ReportsToId === x.Id }));
        return opts;
    }

    // ── Create Contact ────────────────────────────────────────────────────
    get ccModalFields() {
        const base = CC_BASE_FIELDS.map(f => {
            let opts = f.options ? [...f.options] : [];
            if (f.key === 'ReportsToId') {
                opts = [{ value: '', label: '— None —' },
                    ...this._contacts.map(c => ({ value: c.Id, label: c.Name }))];
            }
            return {
                ...f,
                value     : this._ccFields[f.key] || '',
                inputClass: 'arm-cc-input' + (f.required ? ' arm-cc-required' : ''),
                options   : opts,
                isText    : f.type === 'text' || f.type === 'email' || f.type === 'tel',
                isSelect  : f.type === 'select' || f.type === 'lookup'
            };
        });
        const extra = (this._ccExtraFields || []).map(f => ({
            key       : f.apiName,
            label     : f.label,
            required  : true,
            type      : f.fieldType === 'PICKLIST' ? 'select' : 'text',
            value     : this._ccFields[f.apiName] || '',
            inputClass: 'arm-cc-input arm-cc-required',
            options   : (f.picklistOptions || []).map(p => ({ value: p.value, label: p.label })),
            isText    : f.fieldType !== 'PICKLIST' && f.fieldType !== 'MULTIPICKLIST',
            isSelect  : f.fieldType === 'PICKLIST' || f.fieldType === 'MULTIPICKLIST'
        }));
        return [...base, ...extra];
    }
    get ccSaveDisabled() {
        if (this._ccSaving) return true;
        return this.ccModalFields.filter(f => f.required).some(f => !(this._ccFields[f.key] || '').trim());
    }
    get ccSaveLabel() { return this._ccSaving ? 'Saving…' : 'Save & Add to Map'; }

    // ── Quick Connect ─────────────────────────────────────────────────────
    get qcFromContact() {
        if (!this._qcFrom) return null;
        const c = this._contacts.find(x => x.Id === this._qcFrom);
        if (!c) return null;
        return {
            ...c,
            avatarStyle : `background:${DEPT_COLORS[c.Department] || '#888'}`,
            ringStyle   : `border-color:${this._ringColor(c.engagementScore || 0)}`,
            titleDisplay: c.Title || 'No title'
        };
    }
    get qcToContact() {
        if (!this._qcTo) return null;
        const c = this._contacts.find(x => x.Id === this._qcTo);
        if (!c) return null;
        return {
            ...c,
            avatarStyle : `background:${DEPT_COLORS[c.Department] || '#888'}`,
            ringStyle   : `border-color:${this._ringColor(c.engagementScore || 0)}`,
            titleDisplay: c.Title || 'No title'
        };
    }
    get qcArrowLabel()  { return '\u2195 ' + this._qcType + ' \u2195'; }
    get qcConnTypes()   {
        return CONN_TYPES.map(t => ({
            label   : t,
            btnClass: this._qcType === t ? 'arm-qc-type-btn arm-qc-type-on' : 'arm-qc-type-btn'
        }));
    }
    get qcCandidates() {
        const q = (this._qcSearch || '').toLowerCase();
        return this._contacts
            .filter(c => c.Id !== this._qcFrom)
            .filter(c => !q || c.Name.toLowerCase().includes(q))
            .map(c => ({
                ...c,
                avatarStyle : `background:${DEPT_COLORS[c.Department] || '#888'}`,
                ringStyle   : `border-color:${this._ringColor(c.engagementScore || 0)}`,
                titleDisplay: c.Title || 'No title',
                deptDisplay : c.Department || 'Standalone',
                isQCSelected: c.Id === this._qcTo,
                qcItemClass : c.Id === this._qcTo ? 'arm-qc-item arm-qc-item-sel' : 'arm-qc-item'
            }));
    }
    get qcNoResults()    { return this.qcCandidates.length === 0; }
    // ── FIX: qcSaveDisabled was blocking save — now uses explicit boolean ──
    get qcSaveDisabled() {
        return this._qcFrom == null || this._qcTo == null;
    }
    get hasQCFrom() { return !!this._qcFrom; }
    get hasQCTo()   { return !!this._qcTo; }

    // ── Connections loader ────────────────────────────────────────────────
    _loadConnections(contactId) {
        this._connLoading = true;
        this._connections = null;
        getContactConnections({ contactId, accountId: this.recordId })
            .then(r  => { this._connections = r; this._connLoading = false; })
            .catch(() => { this._connLoading = false; });
    }

    // ── Tree ──────────────────────────────────────────────────────────────
    renderedCallback() {
        if (this._view === 'tree') {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => this._renderTree(), 0);
        }
    }

    _renderTree() {
        const container = this.template.querySelector('.arm-tree-root');
        if (!container) return;
        const f = this._filtered;
        if (!f.length) { container.innerHTML = '<div class="arm-empty-state"><p>No contacts match.</p></div>'; return; }
        const ids = new Set(f.map(c => c.Id));
        const ch  = {}; f.forEach(c => { ch[c.Id] = []; });
        const roots = [], stand = [];
        f.forEach(c => {
            if (c.isStandalone) stand.push(c);
            else if (c.ReportsToId && ids.has(c.ReportsToId)) ch[c.ReportsToId].push(c.Id);
            else roots.push(c.Id);
        });
        const byId   = id => f.find(c => c.Id === id);
        const mkCard = (id, depth) => {
            const c = byId(id); if (!c) return '';
            const sel    = this._selId === id;
            const rolesH = (c.roles || []).map(r => ROLES[r] ? `<span class="${ROLES[r].cls}">${ROLES[r].label}</span>` : '').join('');
            return `<div class="arm-nc${sel ? ' arm-nc-sel' : ''}" data-id="${id}">
              <div class="arm-nc-acc" style="background:${c.deptColor}"></div>
              <div class="arm-nc-b">
                <div class="arm-nc-lv">${LEVELS[Math.min(depth, 4)]}</div>
                <div class="arm-nc-row">
                  <div class="arm-av-wrap" style="width:24px;height:24px;flex-shrink:0">
                    <div class="arm-av arm-av-24" style="background:${c.deptColor}">${c.initials}</div>
                    <div class="arm-av-ring" style="border-color:${c.ringColor}"></div>
                  </div>
                  <div style="min-width:0">
                    <div class="arm-nc-nm">${c.Name}</div>
                    <div class="arm-nc-tt">${c.titleDisplay}</div>
                  </div>
                </div>
                <div class="arm-nc-foot">
                  <span class="arm-nc-dp">${c.deptDisplay}</span>
                  <span class="arm-pill ${this._pillCls(c.engagementScore)}">${this._engLabel(c.engagementScore)}</span>
                </div>
                <div class="arm-nc-roles">${rolesH}</div>
              </div>
            </div>`;
        };
        const subtree = (id, depth) => {
            const kids = ch[id] || [];
            if (!kids.length) return `<div class="arm-tree-branch">${mkCard(id, depth)}</div>`;
            const n = kids.length;
            const cDivs = kids.map((k, i) => `<div class="arm-tree-branch">
              <div class="arm-h-row">
                <div class="arm-h-seg${i === 0 ? ' arm-h-hide' : ''}"></div>
                <div class="arm-v-line"></div>
                <div class="arm-h-seg${i === n - 1 ? ' arm-h-hide' : ''}"></div>
              </div>${subtree(k, depth + 1)}</div>`).join('');
            return `<div class="arm-tree-branch">${mkCard(id, depth)}<div class="arm-v-line"></div><div style="display:flex;align-items:flex-start">${cDivs}</div></div>`;
        };
        let html = '<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;min-width:max-content;padding-bottom:16px">';
        roots.forEach(r => { html += subtree(r, 0); });
        html += '</div>';
        if (stand.length) {
            html += '<div class="arm-standalone-sec"><div class="arm-standalone-lbl">Standalone contacts</div><div style="display:flex;flex-wrap:wrap;gap:8px">';
            stand.forEach(c => { html += mkCard(c.Id, 4); });
            html += '</div></div>';
        }
        container.innerHTML = html;
        container.querySelectorAll('.arm-nc[data-id]').forEach(el => {
            el.addEventListener('click', () => this._selectContact(el.dataset.id));
            el.setAttribute('draggable', 'true');
            el.addEventListener('dragstart', e => this._onDragStart(e, el.dataset.id));
            el.addEventListener('dragover',  e => this._onDragOver(e, el.dataset.id));
            el.addEventListener('dragleave', e => this._onDragLeave(e));
            el.addEventListener('drop',      e => this._onDrop(e, el.dataset.id));
        });
    }

    // ── Event handlers ────────────────────────────────────────────────────
    handleViewList()    { this._view = 'list'; }
    handleViewGrid()    { this._view = 'grid'; }
    handleViewTree()    { this._view = 'tree'; }
    handleSearch(e)     { this._search = e.target.value; }
    handleDeptFilter(e) { this._deptFilter = e.currentTarget.dataset.dept; }
    handleAZFilter(e)   { const l = e.currentTarget.dataset.letter; this._azFilter = this._azFilter === l ? '' : l; }
    handleResetFilters(){ this._search = ''; this._deptFilter = 'All'; this._azFilter = ''; }
    handleThemeToggle() {
        this._dark = !this._dark;
        try { localStorage.setItem('arm-theme', this._dark ? 'dark' : 'light'); } catch(e) { /* */ }
    }

    handleContactClick(e)   { this._selectContact(e.currentTarget.dataset.id); }
    handleClosePanel()      { this._selId = null; this._connections = null; this._panelTab = 'info'; }
    handleViewConnection(e) { this._selectContact(e.currentTarget.dataset.id); }

    // ── FIX: handlePanelTab now correctly maps data-tab values ────────────
    handlePanelTab(e) {
        const tab = e.currentTarget.dataset.tab;
        this._panelTab = tab;
        if (tab === 'connections' && this._selId && !this._connections && !this._connLoading) {
            this._loadConnections(this._selId);
        }
    }

    // ── FIX: Role toggle — optimistic update + Apex persist ───────────────
    handleRoleToggle(e) {
        const id   = e.currentTarget.dataset.id;
        const role = e.currentTarget.dataset.role;
        const idx  = this._contacts.findIndex(c => c.Id === id);
        if (idx < 0) return;
        const roles = [...(this._contacts[idx].roles || [])];
        const i = roles.indexOf(role);
        if (i >= 0) roles.splice(i, 1); else roles.push(role);
        // Optimistic local update
        this._contacts[idx] = { ...this._contacts[idx], roles, roleBadges: this._roleBadges(roles) };
        this._contacts = [...this._contacts];
        // Persist
        saveContactRoles({ contactId: id, roles })
            .then(() => { this._showToast('Role saved'); })
            .catch(err => { this._fireError('Failed to save role', err); });
    }

    handleAttrChange(e) {
        const id  = e.currentTarget.dataset.id;
        const key = e.currentTarget.dataset.key;
        const val = key === 'engagementScore' ? parseInt(e.target.value, 10) : e.target.value;
        this._updateContact(id, { [key]: val });
        if (key !== 'engagementScore') {
            saveContactAttribute({ contactId: id, fieldApiName: key, value: String(val || '') })
                .then(() => { this._showToast('Saved'); })
                .catch(err => { this._fireError('Failed to save', err); });
        } else {
            this._showToast('Score updated locally');
        }
    }

    handleReportsToChange(e) {
        const id  = e.currentTarget.dataset.id;
        const tid = e.target.value;
        const c   = this._contacts.find(x => x.Id === id);
        if (!c) return;
        if (tid && this._getDescendants(id).includes(tid)) {
            this._showToast('Cannot create circular reporting chain!'); return;
        }
        const target = tid ? this._contacts.find(x => x.Id === tid) : null;
        this._updateContact(id, { ReportsToId: tid || null, ReportsToName: target ? target.Name : null });
        saveContactAttribute({ contactId: id, fieldApiName: 'ReportsToId', value: tid || '' })
            .then(() => { this._showToast(target ? c.Name + ' now reports to ' + target.Name : c.Name + ' reports to no one'); })
            .catch(err => { this._fireError('Failed to save', err); });
    }

    handleViewRecord() {
        if (!this._selId) return;
        this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: this._selId, actionName: 'view' } });
    }
    handleLogActivity() {
        if (!this._selId) return;
        this[NavigationMixin.Navigate]({ type: 'standard__objectPage', attributes: { objectApiName: 'Task', actionName: 'new' }, state: { defaultFieldValues: 'WhoId=' + this._selId } });
    }

    // ── FIX: Quick Connect handlers — _qcFrom now always set correctly ────
    handleOpenQC() {
        this._qcFrom   = this._selId || null;
        this._qcTo     = null;
        this._qcSearch = '';
        this.qcOpen    = true;
    }
    handleOpenQCFromPanel() { this.handleOpenQC(); }
    handleCloseQC()         { this.qcOpen = false; this._qcFrom = null; this._qcTo = null; this._qcSearch = ''; }
    handleModalBackdrop(e)  { if (e.target === e.currentTarget) this.handleCloseQC(); }
    handleQCType(e)         { this._qcType = e.currentTarget.dataset.type; }
    handleQCSearch(e)       { this._qcSearch = e.target.value; }
    handleQCSelect(e) {
        const id = e.currentTarget.dataset.id;
        // If no "from" contact yet, first selection becomes "from"
        if (!this._qcFrom) {
            this._qcFrom = id;
        } else {
            this._qcTo = this._qcTo === id ? null : id;
        }
    }
    handleSaveQC() {
        if (!this._qcFrom || !this._qcTo) return;
        const from = this._contacts.find(c => c.Id === this._qcFrom);
        const to   = this._contacts.find(c => c.Id === this._qcTo);
        if (!from || !to) return;
        if (!this._manualConns[this._qcFrom]) this._manualConns[this._qcFrom] = [];
        if (this._manualConns[this._qcFrom].some(c => c.contactId === this._qcTo)) {
            this._showToast('Connection already exists'); return;
        }
        this._manualConns[this._qcFrom].push({
            contactId          : this._qcTo,
            contactName        : to.Name,
            contactTitle       : to.Title || 'No title',
            contactDepartment  : to.Department || '',
            connectionStrength : Math.round(((from.engagementScore || 0) + (to.engagementScore || 0)) / 2),
            sharedOpportunities: [],
            sharedActivityCount: 0,
            sameDepartment     : from.Department === to.Department,
            connType           : this._qcType
        });
        this._showToast('Connected: ' + from.Name + ' \u2192 ' + this._qcType + ' \u2192 ' + to.Name);
        this.handleCloseQC();
    }

    // ── Create Contact ────────────────────────────────────────────────────
    handleOpenCC() {
        this._ccFields = { AccountId: this.recordId };
        this.ccOpen    = true;
    }
    handleCloseCCBackdrop(e) { if (e.target === e.currentTarget) this.handleCloseCC(); }
    handleCloseCC()          { this.ccOpen = false; this._ccFields = {}; this._ccSaving = false; }
    handleCCFieldChange(e)   {
        const key = e.currentTarget.dataset.key;
        this._ccFields = { ...this._ccFields, [key]: e.target.value };
    }
    handleSaveCC() {
        if (this.ccSaveDisabled) return;
        this._ccSaving = true;
        createContact({ fields: this._ccFields })
            .then(() => {
                this._ccSaving = false;
                this.ccOpen    = false;
                this._ccFields = {};
                this._showToast('Contact created successfully');
                return refreshApex(this._wiredContacts);
            })
            .catch(err => {
                this._ccSaving = false;
                const msg = err && err.body && err.body.message ? err.body.message : 'Failed to create contact';
                this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
            });
    }

    // ── Drag ─────────────────────────────────────────────────────────────
    handleDragStart(e) { this._onDragStart(e, e.currentTarget.dataset.id); }
    handleDragOver(e)  { this._onDragOver(e, e.currentTarget.dataset.id); }
    handleDragLeave(e) { this._onDragLeave(e); }
    handleDrop(e)      { this._onDrop(e, e.currentTarget.dataset.id); }

    _onDragStart(e, id) {
        this._dragId = id;
        e.dataTransfer.effectAllowed = 'move';
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const el = this.template.querySelector('[data-id="' + id + '"]');
            if (el) el.classList.add('arm-dragging');
        }, 0);
    }
    _onDragOver(e, id) {
        if (this._dragId && this._dragId !== id) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const el = this.template.querySelector('[data-id="' + id + '"]');
            if (el) el.classList.add('arm-drag-over');
        }
    }
    _onDragLeave(e) { e.currentTarget.classList.remove('arm-drag-over'); }
    _onDrop(e, tid) {
        e.preventDefault();
        this.template.querySelectorAll('.arm-drag-over,.arm-dragging').forEach(el => el.classList.remove('arm-drag-over', 'arm-dragging'));
        if (!this._dragId || this._dragId === tid) { this._dragId = null; return; }
        const src = this._contacts.find(c => c.Id === this._dragId);
        const tgt = this._contacts.find(c => c.Id === tid);
        if (!src || !tgt) { this._dragId = null; return; }
        if (this._getDescendants(this._dragId).includes(tid)) {
            this._showToast('Cannot create circular chain!');
            this._dragId = null; return;
        }
        const deptChanged = src.Department !== tgt.Department;
        this._updateContact(this._dragId, {
            ReportsToId  : tid,
            ReportsToName: tgt.Name,
            ...(deptChanged ? { Department: tgt.Department } : {})
        });
        this._showToast(deptChanged
            ? src.Name + ' \u2192 ' + tgt.Name + ' \u00b7 moved to ' + tgt.Department
            : src.Name + ' now reports to ' + tgt.Name);
        this._dragId = null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _selectContact(id) {
        if (this._selId === id) {
            this._selId = null; this._connections = null; this._panelTab = 'info';
        } else {
            this._selId = id; this._connections = null; this._panelTab = 'info';
        }
    }
    _updateContact(id, fields) {
        const idx = this._contacts.findIndex(c => c.Id === id);
        if (idx < 0) return;
        this._contacts = [
            ...this._contacts.slice(0, idx),
            this._enrich({ ...this._contacts[idx], ...fields }),
            ...this._contacts.slice(idx + 1)
        ];
    }
    _getDescendants(id) {
        const kids = this._contacts.filter(c => c.ReportsToId === id).map(c => c.Id);
        return kids.reduce((acc, k) => [...acc, ...this._getDescendants(k)], [...kids]);
    }
    _showToast(msg) {
        this.toastMessage = msg;
        this.toastVisible = true;
        clearTimeout(this._toastTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._toastTimer = setTimeout(() => { this.toastVisible = false; }, 2800);
    }
    _fireError(title, err) {
        const msg = err && err.body && err.body.message ? err.body.message : title;
        this.dispatchEvent(new ShowToastEvent({ title, message: msg, variant: 'error' }));
    }
    _teamColor(role) {
        if (!role) return '#888';
        const r = role.toLowerCase();
        if (r.includes('executive') || r.includes('ae')) return '#0176d3';
        if (r.includes('engineer')  || r.includes('se')) return '#534AB7';
        if (r.includes('success')   || r.includes('csm')) return '#0F6E56';
        return '#854F0B';
    }
    _initials(name)    { return (name || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
    _engLabel(s)       { s = s || 0; return s >= 70 ? 'High' : s >= 40 ? 'Med' : 'Low'; }
    _pillCls(s)        { s = s || 0; return s >= 70 ? 'arm-phi' : s >= 40 ? 'arm-phm' : 'arm-phl'; }
    _engColor(s)       { s = s || 0; return s >= 70 ? '#0F6E56' : s >= 40 ? '#854F0B' : '#A32D2D'; }
    _ringColor(s)      { s = s || 0; return s >= 70 ? RING_COLORS.high : s >= 40 ? RING_COLORS.medium : RING_COLORS.low; }
    _tlColor(t)        { return ({ email: '#0176d3', meeting: '#534AB7', call: '#EF9F27', task: '#888780' })[t] || '#888780'; }
    _tlChar(t)         { return ({ email: '\u2709', meeting: '\u25F7', call: '\u260E', task: '\u2713' })[t] || '\u00b7'; }
    _roleBadges(roles) { return (roles || []).map(r => ROLES[r] ? { key: r, label: ROLES[r].label, cls: ROLES[r].cls } : null).filter(Boolean); }
}