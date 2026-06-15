/**
 * ============================================================
 * ONA Relationship Intelligence — Version 4.2
 * ============================================================
 * Author      : Sumit Mattey
 * Organisation: Genpact — Salesforce Practice
 * GitHub      : https://github.com/mattey2026/ona-relationship-intelligence
 * Updated     : 15 June 2026
 * ------------------------------------------------------------
 * Description :
 *   Salesforce-native Organisational Network Analysis platform.
 *   Maps, scores and trends every relationship inside your key
 *   accounts using 11 graph algorithms — 100% Apex + LWC + D3.
 * ------------------------------------------------------------
 * Features (v4.1):
 *   - 11 Graph algorithms (Strength, Influence, Centrality,
 *     Betweenness, Decay, Velocity, BFS, Whitespace, Coverage,
 *     Multi-thread Risk, Recommendation Engine)
 *   - Analytics Pane: Timeline, Power Map, Impact Simulator,
 *     Risk Radar
 *   - Relationship Summary Bell Popup
 *   - Portfolio View with GNews external signals
 *   - 100% Apex test coverage (42 test methods)
 * ------------------------------------------------------------
 * v4.2 (15 June 2026):
 *   - No changes to this class's logic. Version bumped to align
 *     with the new Agentforce action layer (ONAAgentUtils v1.3,
 *     ONAAgentFindAccount, 5 ONAAgentGet* invocable actions) which
 *     reuses this controller's Account/Contact data model and is
 *     versioned/dated together for traceability in git history.
 * ============================================================
 */
public with sharing class ONAController {

    private static final Integer MAX_CONTACTS    = 50;
    private static final Integer MAX_ACCOUNTS    = 20;
    private static final Integer ACTIVITY_MONTHS = 12;
    // ── Activity weight constants ────────────────────────────────────────────────
    // Used by Alg 1 (Relationship Strength), Alg 5 (Decay),
    // Alg 6 (Velocity), and Alg 11 (Multi-thread HHI).
    // Higher weight = stronger signal of a real relationship.
    private static final Integer W_EMAIL_MSG     = 4; // Real email (EmailMessage) — highest email signal
    private static final Integer W_EMAIL         = 3; // Manual Task email log
    private static final Integer W_MEETING       = 5; // Event / meeting — strongest signal
    private static final Integer W_TASK          = 2; // Non-email Task (call log, follow-up)
    private static final Integer W_OPP           = 4; // Shared Opportunity
    private static final Integer WHITESPACE_THRESHOLD = 3;

    // ── Entry points ──────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=false)
    public static String getAccountGraph(Id accountId) {
        try {
            Account acc = [SELECT Id, Name FROM Account WHERE Id = :accountId LIMIT 1];
            List<Contact> raw      = fetchAccountContacts(accountId);
            Map<Id,Integer> aScore = activityScores(toIdSet(raw));
            List<Contact> selected = topContacts(raw, aScore, MAX_CONTACTS);
            List<ONAModels.ContactNode> nodes = buildNodes(selected);
            populateSharedMaps(nodes);
            populatePhase2ActivityMaps(nodes); // decay + velocity data
            List<ONAModels.EdgeResult> edges = inferEdges(nodes);
            Integer clusters = applyCentrality(nodes, edges);
            applyInfluence(nodes);
            applyPhase2Scores(nodes, edges); // alg 5, 6, 7
            populateLastActivity(nodes);      // v4.1 — last activity badge
            ONAModels.AccountIntelligence ai = buildAccountIntelligence(nodes);
            return JSON.serialize(buildPayload(nodes, edges, 'account', acc.Name, clusters, ai));
        } catch (Exception e) {
            throw new AuraHandledException('ONA error: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static String getCrossAccountGraph(String industry, Id anchorId) {
        try {
            List<Account> accounts = topAccounts(industry, anchorId);
            Set<Id> acctIds        = toAccountIdSet(accounts);
            List<Contact> raw      = fetchMultiAccountContacts(acctIds);
            Map<Id,Integer> aScore = activityScores(toIdSet(raw));
            List<Contact> selected = topContacts(raw, aScore, MAX_CONTACTS * 4);
            List<ONAModels.ContactNode> nodes = buildNodes(selected);
            populateSharedMaps(nodes);
            populatePhase2ActivityMaps(nodes);
            List<ONAModels.EdgeResult> edges = inferEdges(nodes);
            Integer clusters = applyCentrality(nodes, edges);
            applyInfluence(nodes);
            applyPhase2Scores(nodes, edges);
            populateLastActivity(nodes); // v4.1 — last activity badge
            for (ONAModels.ContactNode n : nodes)
                if (n.nodeType != 'hub' && n.accountId != anchorId) n.nodeType = 'bridge';
            ONAModels.AccountIntelligence ai = buildAccountIntelligence(nodes);
            String label = (industry != null && industry != '')
                ? industry + ' — Cross-Account' : 'Cross-Account View';
            return JSON.serialize(buildPayload(nodes, edges, 'global', label, clusters, ai));
        } catch (Exception e) {
            throw new AuraHandledException('ONA error: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=false)
    public static String getContactInsight(Id contactId, String graphJson) {
        try {
            ONAModels.GraphPayload graph =
                (ONAModels.GraphPayload) JSON.deserialize(graphJson, ONAModels.GraphPayload.class);
            ONAModels.ContactNode src = null;
            for (ONAModels.ContactNode n : graph.nodes)
                if (n.contactId == contactId) { src = n; break; }
            if (src == null) throw new AuraHandledException('Contact not found in graph.');

            ONAModels.InsightPayload p = new ONAModels.InsightPayload();
            p.contact        = src;
            p.recentActivity = fetchTimeline(contactId, 8);
            p.recommendations= alg4Recommend(src, graph.nodes, graph.edges, 5);
            p.networkRole    = networkRole(src);
            p.introPaths     = alg8BFSPaths(src, graph.nodes, graph.edges, 3); // Phase 2
            return JSON.serialize(p);
        } catch (Exception e) {
            throw new AuraHandledException('ONA error: ' + e.getMessage());
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<Account> searchAccounts(String searchTerm) {
        String q = '%' + (searchTerm != null ? searchTerm : '') + '%';
        return [SELECT Id, Name, Industry, BillingCity FROM Account
                WHERE Name LIKE :q AND IsDeleted = false ORDER BY Name LIMIT 20];
    }

    // ── Unified search — Accounts AND Contacts (v4.3) ────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Map<String,Object>> searchAccountsAndContacts(String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.length() < 2)
            return new List<Map<String,Object>>();
        String term = '%' + searchTerm + '%';
        List<Map<String,Object>> results = new List<Map<String,Object>>();

        // Accounts
        for (Account a : [
            SELECT Id, Name, Industry
            FROM   Account
            WHERE  Name LIKE :term AND IsDeleted = false
            ORDER  BY Name LIMIT 8
        ]) {
            results.add(new Map<String,Object>{
                'id'        => a.Id,
                'name'      => a.Name,
                'subtitle'  => String.isBlank(a.Industry) ? 'Account' : a.Industry,
                'type'      => 'account',
                'accountId' => a.Id,
                'accountName'=> a.Name,
                'initial'   => a.Name.left(1).toUpperCase()
            });
        }

        // Contacts
        for (Contact ct : [
            SELECT Id, Name, Title, AccountId, Account.Name
            FROM   Contact
            WHERE  Name LIKE :term AND AccountId != null
            ORDER  BY Name LIMIT 8
        ]) {
            String sub = '';
            if (!String.isBlank(ct.Title)) sub += ct.Title;
            if (ct.Account != null && !String.isBlank(ct.Account.Name))
                sub += (String.isBlank(sub) ? '' : ' · ') + ct.Account.Name;
            results.add(new Map<String,Object>{
                'id'         => ct.Id,
                'name'       => ct.Name,
                'subtitle'   => sub,
                'type'       => 'contact',
                'accountId'  => ct.AccountId,
                'accountName'=> ct.Account != null ? ct.Account.Name : '',
                'initial'    => ct.Name.left(1).toUpperCase()
            });
        }
        return results;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1 ALGORITHMS
    // ═══════════════════════════════════════════════════════════════════════════

    // Alg 1 — Relationship Strength
    // ── Alg 1 — Relationship Strength ───────────────────────────────────────────
    // Computes the weight of the edge between two contacts.
    // Weight drives line thickness on the graph — thick gold = strong relationship.
    //
    // Data sources:
    //   sharedEmailMessages — real emails (EmailMessage object, Einstein Activity Capture)
    //   sharedEmails        — manual Task emails logged by sellers
    //   sharedMeetings      — Events where both contacts were attendees
    //   sharedOpps          — Opportunities where both contacts have a role
    //   sharedTasks         — shared non-email Tasks
    //
    // Formula: Σ (shared_count × weight)
    //   EmailMessage: ×4 — most reliable email signal (auto-captured)
    //   Task Email:   ×3 — manual log (less reliable, may be summary)
    //   Meeting:      ×5 — highest quality (both parties committed time)
    //   Opportunity:  ×4 — shared business context
    //   Task:         ×2 — lowest weight (admin logging)
    //   Same account: +1 — baseline same-account affinity
    private static Integer alg1Strength(ONAModels.ContactNode a, ONAModels.ContactNode b) {
        // Active signal: manual Task emails (×3), Events/meetings (×5),
        // Opportunity contact roles (×4), non-email Tasks (×2), same-account baseline (+1)
        Integer base =  safeGet(a.sharedEmails,   b.contactId) * W_EMAIL
                      + safeGet(a.sharedMeetings, b.contactId) * W_MEETING
                      + safeGet(a.sharedTasks,    b.contactId) * W_TASK
                      + safeGet(a.sharedOpps,     b.contactId) * W_OPP
                      + (a.accountId == b.accountId ? 1 : 0);

        /* ─── BEGIN EAC PATCH — ALG 1 RELATIONSHIP STRENGTH (EmailMessage) ──────
         * Adds real email signal (weight ×4) to edge weight.
         * sharedEmailMessages is populated by populateSharedMaps() once EAC is on.
         * Weight ×4 > manual Task email ×3 because it is automatically captured.
         * Requires: ONAModels EAC PATCH (sharedEmailMessages field) also uncommented.
         *
        base += safeGet(a.sharedEmailMessages, b.contactId) * W_EMAIL_MSG;
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        return base;
    }

    // Alg 2 — Influence Score
    private static Integer alg2Influence(ONAModels.ContactNode n) {
        Integer conn = Math.min(n.connectionCount, 15) * 2;
        Integer act  = Math.min(n.totalActivities, 20) * 3;
        Integer role = roleWeight(n.title);
        return normalise(conn + act + role, 0, 100);
    }

    private static Integer roleWeight(String title) {
        if (title == null) return 2;
        String t = title.toLowerCase();
        if (t.contains('chief') || t.contains('ceo') || t.contains('cto') ||
            t.contains('cfo') || t.contains('president'))                  return 10;
        if (t.contains('vice president') || t.contains(' vp') ||
            t.startsWith('vp '))                                           return 8;
        if (t.contains('director') || t.contains('head of') ||
            t.contains('principal'))                                       return 6;
        if (t.contains('manager') || t.contains('lead') ||
            t.contains('senior'))                                          return 4;
        return 2;
    }

    // Alg 3 — Network Centrality + Union-Find Clusters
    private static Integer applyCentrality(
        List<ONAModels.ContactNode> nodes,
        List<ONAModels.EdgeResult>  edges
    ) {
        Map<Id,Integer> deg = new Map<Id,Integer>();
        Map<Id,Integer> wt  = new Map<Id,Integer>();
        for (ONAModels.ContactNode n : nodes) { deg.put(n.contactId,0); wt.put(n.contactId,0); }
        for (ONAModels.EdgeResult e : edges) {
            deg.put(e.sourceId, deg.get(e.sourceId)+1);
            deg.put(e.targetId, deg.get(e.targetId)+1);
            wt.put(e.sourceId,  wt.get(e.sourceId)+e.weight);
            wt.put(e.targetId,  wt.get(e.targetId)+e.weight);
        }
        Integer maxD = maxOf(deg.values()); if (maxD==0) maxD=1;
        Integer maxW = maxOf(wt.values());  if (maxW==0) maxW=1;
        Map<Id,Id> parent = new Map<Id,Id>();
        for (ONAModels.ContactNode n : nodes) parent.put(n.contactId, n.contactId);
        for (ONAModels.EdgeResult e : edges) {
            Id ra = ufFind(parent,e.sourceId), rb = ufFind(parent,e.targetId);
            if (ra!=rb) parent.put(ra,rb);
        }
        Map<Id,Integer> clIdx = new Map<Id,Integer>(); Integer ci=0;
        for (ONAModels.ContactNode n : nodes) {
            Id root = ufFind(parent,n.contactId);
            if (!clIdx.containsKey(root)) clIdx.put(root,ci++);
            n.clusterId = clIdx.get(root);
            Integer d = deg.get(n.contactId)!=null ? deg.get(n.contactId) : 0;
            Integer w = wt.get(n.contactId) !=null ? wt.get(n.contactId)  : 0;
            Decimal dc = Decimal.valueOf(d)/maxD, wc = Decimal.valueOf(w)/maxW;
            n.centralityScore  = ((dc*0.6 + wc*0.4)*100).intValue();
            n.degreeCentrality = (dc*100).intValue();
            n.connectionCount  = d;
            n.nodeType = n.centralityScore>=70 ? 'hub' : n.centralityScore>=35 ? 'connector' : 'low';
        }
        return ci;
    }

    private static Id ufFind(Map<Id,Id> p, Id x) {
        if (p.get(x)==x) return x;
        Id root = ufFind(p, p.get(x)); p.put(x,root); return root;
    }

    // Alg 4 — Recommendation Engine
    private static List<ONAModels.RecommendationResult> alg4Recommend(
        ONAModels.ContactNode        src,
        List<ONAModels.ContactNode>  allNodes,
        List<ONAModels.EdgeResult>   edges,
        Integer                      topN
    ) {
        Set<Id> connected = new Set<Id>{ src.contactId };
        for (ONAModels.EdgeResult e : edges) {
            if (e.sourceId==src.contactId) connected.add(e.targetId);
            if (e.targetId==src.contactId) connected.add(e.sourceId);
        }
        Map<Id,Integer> paths2  = new Map<Id,Integer>();
        Map<Id,Id>      bridgeId = new Map<Id,Id>();
        for (ONAModels.EdgeResult e : edges) {
            for (Id[] pair : new List<Id[]>{
                new Id[]{e.sourceId,e.targetId},
                new Id[]{e.targetId,e.sourceId}
            }) {
                if (connected.contains(pair[0]) && !connected.contains(pair[1])) {
                    paths2.put(pair[1], (paths2.containsKey(pair[1]) ? paths2.get(pair[1]) : 0)+1);
                    if (!bridgeId.containsKey(pair[1])) bridgeId.put(pair[1], pair[0]);
                }
            }
        }
        Map<Id,ONAModels.ContactNode> nm = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : allNodes) nm.put(n.contactId,n);
        List<ONAModels.RecommendationResult> res = new List<ONAModels.RecommendationResult>();
        for (ONAModels.ContactNode c : allNodes) {
            if (connected.contains(c.contactId)) continue;
            Integer p2 = paths2.containsKey(c.contactId) ? paths2.get(c.contactId) : 0;
            Integer sc = c.influenceScore + c.centralityScore + (p2*10)
                       + (c.clusterId==src.clusterId ? 12 : 0);
            String reason;
            if (c.nodeType=='hub')
                reason = c.name+' is a network hub ('+c.connectionCount+' connections) — not yet reached.';
            else if (c.betweennessScore >= 50)
                reason = c.name+' is a key gatekeeper (betweenness '+c.betweennessScore+') — bridges multiple clusters.';
            else if (p2>0) {
                ONAModels.ContactNode br = nm.get(bridgeId.get(c.contactId));
                reason = 'Reach '+c.name+' through '+(br!=null?br.name:'a shared contact')+' — warm intro path exists.';
            } else
                reason = c.name+' ('+c.title+') is active in '+c.department+' but not yet in your network.';
            res.add(new ONAModels.RecommendationResult(c, sc, reason));
        }
        res.sort(new ONAModels.RecoSorter());
        List<ONAModels.RecommendationResult> out = new List<ONAModels.RecommendationResult>();
        for (Integer i=0; i<Math.min(topN,res.size()); i++) out.add(res[i]);
        return out;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2 ALGORITHMS
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Alg 5 — Engagement Decay ─────────────────────────────────────────────
    // Formula: score = Σ( activityWeight × e^(−λ × monthsAgo) ) where λ = 0.18
    // Approximated in two bands to avoid per-record date arithmetic in Apex:
    //   • Last 90 days (recent)  → full weight (factor 1.0)
    //   • 90–180 days (mid)      → decayed weight (factor 0.45, ≈ e^(−0.18 × 4.5))
    // Output: 0–100 normalised score.
    //   70+  = Warm     (seller has active, recent engagement)
    //   40-69 = Cooling  (engagement exists but fading — act soon)
    //   0-39  = Cold     (near-zero recent signal — restart from scratch)
    private static void applyDecay(List<ONAModels.ContactNode> nodes) {
        for (ONAModels.ContactNode n : nodes) {

            // ── Recent (last 90 days) — full weight ────────────────────────
            // Uses Task email count + Event count in the 90-day window.
            Decimal recent = (n.emailCount90 * W_EMAIL) + (n.meetingCount90 * W_MEETING);

            /* ─── BEGIN EAC PATCH — ALG 5 DECAY (recent 90-day window) ───────────
             * Adds real email signal to the recent decay window.
             * emailMessageCount90 = EmailMessage records for this contact in last 90 days.
             * W_EMAIL_MSG (4) > W_EMAIL (3) because real emails are auto-captured.
             *
            recent += (n.emailMessageCount90 * W_EMAIL_MSG);
             *
             * ─── END EAC PATCH ─────────────────────────────────────────────── */

            // ── Mid-range (90–180 days) — decay factor 0.45 ───────────────
            // Activities older than 90 days contribute less to the score.
            Decimal mid = ((n.emailCount - n.emailCount90) * W_EMAIL
                         + (n.meetingCount - n.meetingCount90) * W_MEETING) * 0.45;

            /* ─── BEGIN EAC PATCH — ALG 5 DECAY (prior 90-day window) ───────────
             * Adds real email signal to the mid-range decay window.
             * emailMessageCountPrior = EmailMessage records for this contact 90-180 days ago.
             *
            mid += ((n.emailMessageCount - n.emailMessageCount90) * W_EMAIL_MSG) * 0.45;
             *
             * ─── END EAC PATCH ─────────────────────────────────────────────── */

            Decimal total = recent + mid;
            n.decayScore  = normalise(total.intValue(), 0, 60);
        }
    }

    // ── Alg 6 — Velocity Scoring ─────────────────────────────────────────────
    // Compares engagement in the LAST 90 days vs the PRIOR 90 days (90–180d ago).
    // Formula: velocity = (last90 - prior90) / prior90
    //
    // Thresholds:
    //   velocity > +0.15  → ↑ Growing  (15%+ more activity than prior period)
    //   velocity < −0.15  → ↓ Cooling  (15%+ less activity than prior period)
    //   otherwise         → → Stable
    //
    // If prior = 0 and recent > 0: new relationship forming → velocity = 1.0 (max)
    private static void applyVelocity(List<ONAModels.ContactNode> nodes) {
        for (ONAModels.ContactNode n : nodes) {

            // ── Last 90 days — active data sources ────────────────────────
            Decimal recent = (n.emailCount90 * W_EMAIL) + (n.meetingCount90 * W_MEETING);

            // ── Prior 90 days (90–180 days ago) — active data sources ─────
            Decimal prior  = (n.emailCountPrior * W_EMAIL) + (n.meetingCountPrior * W_MEETING);

            /* ─── BEGIN EAC PATCH — ALG 6 VELOCITY ───────────────────────────────
             * Adds real email signal to both velocity windows.
             * Once EAC is active, emailMessageCount90 and emailMessageCountPrior
             * are populated by populatePhase2ActivityMaps() and will make velocity
             * scores more accurate (real emails vs manual log only).
             *
            recent += (n.emailMessageCount90    * W_EMAIL_MSG);
            prior  += (n.emailMessageCountPrior * W_EMAIL_MSG);
             *
             * ─── END EAC PATCH ─────────────────────────────────────────────── */

            Decimal vel = 0;
            if (prior > 0) {
                vel = (recent - prior) / prior;
            } else if (recent > 0) {
                vel = 1; // relationship is forming from zero — maximum growth signal
            }
            n.velocityRaw = vel.setScale(3);
            if      (vel >  0.15) { n.velocityArrow = '↑'; n.velocityLabel = 'Growing'; }
            else if (vel < -0.15) { n.velocityArrow = '↓'; n.velocityLabel = 'Cooling'; }
            else                  { n.velocityArrow = '→'; n.velocityLabel = 'Stable';  }
        }
    }

    // Alg 7 — Betweenness Centrality (Brandes algorithm)
    // For each node: count how many shortest paths between other pairs pass through it
    // High betweenness = gatekeeper / bridge between clusters
    private static void applyBetweenness(
        List<ONAModels.ContactNode> nodes,
        List<ONAModels.EdgeResult>  edges
    ) {
        // Build adjacency list
        Map<Id, List<Id>> adj = new Map<Id, List<Id>>();
        for (ONAModels.ContactNode n : nodes) adj.put(n.contactId, new List<Id>());
        for (ONAModels.EdgeResult e : edges) {
            adj.get(e.sourceId).add(e.targetId);
            adj.get(e.targetId).add(e.sourceId);
        }

        // Betweenness accumulator
        Map<Id, Decimal> bc = new Map<Id, Decimal>();
        for (ONAModels.ContactNode n : nodes) bc.put(n.contactId, 0);

        // Brandes BFS from each source
        for (ONAModels.ContactNode src : nodes) {
            List<Id>        stack  = new List<Id>();
            Map<Id,List<Id>>pred   = new Map<Id,List<Id>>();
            Map<Id,Integer> sigma  = new Map<Id,Integer>();
            Map<Id,Integer> dist   = new Map<Id,Integer>();
            Map<Id,Decimal> delta  = new Map<Id,Decimal>();

            for (ONAModels.ContactNode n : nodes) {
                pred.put(n.contactId,  new List<Id>());
                sigma.put(n.contactId, 0);
                dist.put(n.contactId,  -1);
                delta.put(n.contactId, 0);
            }
            sigma.put(src.contactId, 1);
            dist.put(src.contactId,  0);

            List<Id> queue = new List<Id>{ src.contactId };
            Integer  qi    = 0;
            while (qi < queue.size()) {
                Id v = queue[qi++];
                stack.add(v);
                for (Id w : adj.get(v)) {
                    if (dist.get(w) < 0) {
                        dist.put(w, dist.get(v)+1);
                        queue.add(w);
                    }
                    if (dist.get(w) == dist.get(v)+1) {
                        sigma.put(w, sigma.get(w)+sigma.get(v));
                        pred.get(w).add(v);
                    }
                }
            }
            // Back-propagation
            for (Integer i = stack.size()-1; i >= 0; i--) {
                Id w = stack[i];
                for (Id v : pred.get(w)) {
                    Decimal coeff = Decimal.valueOf(sigma.get(v))
                                  / Decimal.valueOf(sigma.get(w))
                                  * (1 + delta.get(w));
                    delta.put(v, delta.get(v) + coeff);
                }
                if (w != src.contactId) bc.put(w, bc.get(w) + delta.get(w));
            }
        }

        // Normalise 0-100
        Decimal maxBc = 0.001;
        for (Decimal v : bc.values()) if (v > maxBc) maxBc = v;
        for (ONAModels.ContactNode n : nodes)
            n.betweennessScore = ((bc.get(n.contactId) / maxBc) * 100).intValue();
    }

    // Alg 8 — BFS Shortest Path (warm intro route finder)
    // Returns up to topN intro paths from src to unconnected contacts
    private static List<ONAModels.IntroPath> alg8BFSPaths(
        ONAModels.ContactNode        src,
        List<ONAModels.ContactNode>  allNodes,
        List<ONAModels.EdgeResult>   edges,
        Integer                      topN
    ) {
        // Adjacency
        Map<Id, List<Id>> adj = new Map<Id, List<Id>>();
        for (ONAModels.ContactNode n : allNodes) adj.put(n.contactId, new List<Id>());
        for (ONAModels.EdgeResult e : edges) {
            adj.get(e.sourceId).add(e.targetId);
            adj.get(e.targetId).add(e.sourceId);
        }

        // Direct connections of src
        Set<Id> directConn = new Set<Id>{ src.contactId };
        for (ONAModels.EdgeResult e : edges) {
            if (e.sourceId == src.contactId) directConn.add(e.targetId);
            if (e.targetId == src.contactId) directConn.add(e.sourceId);
        }

        // Node map
        Map<Id,ONAModels.ContactNode> nm = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : allNodes) nm.put(n.contactId,n);

        List<ONAModels.IntroPath> result = new List<ONAModels.IntroPath>();

        // Run BFS to each unconnected high-value target
        for (ONAModels.ContactNode tgt : allNodes) {
            if (directConn.contains(tgt.contactId)) continue;
            if (result.size() >= topN) break;

            // BFS
            Map<Id,Id>    prevMap  = new Map<Id,Id>();
            Set<Id>       visited  = new Set<Id>{ src.contactId };
            List<Id>      queue    = new List<Id>{ src.contactId };
            Integer       qi       = 0;
            Boolean       found    = false;
            prevMap.put(src.contactId, null);

            while (qi < queue.size() && !found) {
                Id v = queue[qi++];
                for (Id w : adj.get(v)) {
                    if (!visited.contains(w)) {
                        visited.add(w);
                        prevMap.put(w, v);
                        if (w == tgt.contactId) { found = true; break; }
                        queue.add(w);
                    }
                }
            }

            if (!found) continue;

            // Reconstruct path
            List<Id> path = new List<Id>();
            Id cur = tgt.contactId;
            while (cur != null) { path.add(0, cur); cur = prevMap.get(cur); }

            // Only include 2-hop and 3-hop paths (meaningful intros)
            if (path.size() < 3 || path.size() > 4) continue;

            ONAModels.IntroPath ip = new ONAModels.IntroPath();
            ip.targetContactId = tgt.contactId;
            ip.targetName      = tgt.name;
            ip.pathIds         = path;
            ip.pathNames       = new List<String>();
            for (Id pid : path) {
                ONAModels.ContactNode pNode = nm.get(pid);
                ip.pathNames.add(pNode != null ? pNode.name : String.valueOf(pid));
            }
            ip.hopCount = path.size() - 1;
            result.add(ip);
        }
        return result;
    }

    // Alg 9 — Whitespace Analysis
    private static List<ONAModels.WhitespaceItem> alg9Whitespace(
        List<ONAModels.ContactNode> nodes
    ) {
        Map<String, Integer> deptContacts  = new Map<String, Integer>();
        Map<String, Integer> deptActivities= new Map<String, Integer>();
        for (ONAModels.ContactNode n : nodes) {
            String d = n.department != null && n.department != '' ? n.department : 'Unknown';
            deptContacts.put(d,   (deptContacts.containsKey(d)   ? deptContacts.get(d)   : 0) + 1);
            deptActivities.put(d, (deptActivities.containsKey(d) ? deptActivities.get(d) : 0) + n.totalActivities);
        }
        List<ONAModels.WhitespaceItem> ws = new List<ONAModels.WhitespaceItem>();
        for (String dept : deptContacts.keySet()) {
            ONAModels.WhitespaceItem item = new ONAModels.WhitespaceItem();
            item.department    = dept;
            item.contactCount  = deptContacts.get(dept);
            item.activityCount = deptActivities.containsKey(dept) ? deptActivities.get(dept) : 0;
            item.engaged       = item.activityCount >= WHITESPACE_THRESHOLD;
            ws.add(item);
        }
        return ws;
    }

    // Alg 10 — Coverage Score
    // deptCoverage×0.6 + seniorityCoverage×0.4
    private static Integer alg10Coverage(List<ONAModels.ContactNode> nodes) {
        Set<String> allDepts = new Set<String>();
        Set<String> engDepts = new Set<String>();
        Set<String> allSen   = new Set<String>();
        Set<String> engSen   = new Set<String>();
        for (ONAModels.ContactNode n : nodes) {
            String d = n.department != null && n.department != '' ? n.department : 'Unknown';
            String s = seniorityBucket(n.title);
            allDepts.add(d); allSen.add(s);
            if (n.totalActivities >= WHITESPACE_THRESHOLD) { engDepts.add(d); engSen.add(s); }
        }
        if (allDepts.isEmpty()) return 0;
        Decimal deptCov = Decimal.valueOf(engDepts.size()) / Decimal.valueOf(allDepts.size());
        Decimal senCov  = allSen.isEmpty() ? 0 : Decimal.valueOf(engSen.size()) / Decimal.valueOf(allSen.size());
        return ((deptCov * 0.6 + senCov * 0.4) * 100).intValue();
    }

    private static String seniorityBucket(String title) {
        if (title == null) return 'IC';
        String t = title.toLowerCase();
        if (t.contains('chief') || t.contains('ceo') || t.contains('cfo') || t.contains('cto') || t.contains('president')) return 'C-Level';
        if (t.contains('vp') || t.contains('vice') || t.contains('director') || t.contains('head')) return 'VP/Director';
        if (t.contains('manager') || t.contains('lead') || t.contains('senior')) return 'Manager';
        return 'IC';
    }

    // ── Alg 11 — Multi-thread Risk Score (Herfindahl-Hirschman Index, inverted) ──
    // HHI (from antitrust economics) measures how concentrated CRM activity is.
    //
    // Formula:
    //   HHI = Σ ( contact_activity_share² )   — higher = more concentrated = riskier
    //   Score = (1 − HHI) × 100               — inverted so 100 = safe, 0 = single-thread
    //
    // Each contact's activity = emailCount×3 + meetingCount×5 + taskCount×2
    // Share = that contact's activity / total activity across all contacts
    //
    // Interpretation:
    //   70–100 = Healthy (activity well distributed across the network)
    //   40–69  = Moderate risk (some concentration)
    //   0–39   = High risk (one contact dominates — losing them collapses the deal)
    private static Integer alg11MultiThread(List<ONAModels.ContactNode> nodes) {

        // ── Compute each contact's weighted activity total ─────────────────
        Decimal total = 0;
        for (ONAModels.ContactNode n : nodes)
            total += n.emailCount * W_EMAIL + n.meetingCount * W_MEETING + n.taskCount * W_TASK;

        /* ─── BEGIN EAC PATCH — ALG 11 MULTI-THREAD HHI ─────────────────────────
         * Adds real email count to the per-contact activity total.
         * Once EAC is active, emailMessageCount reflects actual email volume
         * and will make the HHI score more accurate.
         *
        for (ONAModels.ContactNode n : nodes)
            total += n.emailMessageCount * W_EMAIL_MSG;
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        if (total == 0) return 0;

        // ── Compute HHI = Σ(share²) ────────────────────────────────────────
        Decimal hhi = 0;
        for (ONAModels.ContactNode n : nodes) {
            Decimal act   = n.emailCount * W_EMAIL + n.meetingCount * W_MEETING + n.taskCount * W_TASK;

            /* ─── BEGIN EAC PATCH — ALG 11 SHARE CALCULATION ─────────────────────
             * Include real email signal in each contact's activity share.
             *
            act += n.emailMessageCount * W_EMAIL_MSG;
             *
             * ─── END EAC PATCH ─────────────────────────────────────────────── */

            Decimal share = act / total;
            hhi += share * share;
        }
        return ((1 - hhi) * 100).intValue();
    }

    // ── Phase 2 orchestrator ──────────────────────────────────────────────────
    private static void applyPhase2Scores(
        List<ONAModels.ContactNode> nodes,
        List<ONAModels.EdgeResult>  edges
    ) {
        applyDecay(nodes);
        applyVelocity(nodes);
        applyBetweenness(nodes, edges);
    }

    private static ONAModels.AccountIntelligence buildAccountIntelligence(
        List<ONAModels.ContactNode> nodes
    ) {
        ONAModels.AccountIntelligence ai = new ONAModels.AccountIntelligence();
        ai.whitespace      = alg9Whitespace(nodes);
        ai.coverageScore   = alg10Coverage(nodes);
        ai.multiThreadScore= alg11MultiThread(nodes);
        ai.coverageBadge   = ai.coverageScore   >= 70 ? 'Good'    : ai.coverageScore   >= 40 ? 'Moderate' : 'At Risk';
        ai.multiThreadBadge= ai.multiThreadScore >= 70 ? 'Healthy' : ai.multiThreadScore >= 40 ? 'Moderate' : 'High Risk';
        return ai;
    }

    // ── Edge inference ────────────────────────────────────────────────────────
    private static List<ONAModels.EdgeResult> inferEdges(List<ONAModels.ContactNode> nodes) {
        List<ONAModels.EdgeResult> edges = new List<ONAModels.EdgeResult>();
        Set<String> seen = new Set<String>();
        for (Integer i=0; i<nodes.size(); i++) {
            for (Integer j=i+1; j<nodes.size(); j++) {
                ONAModels.ContactNode a=nodes[i], b=nodes[j];
                String key = a.contactId+'_'+b.contactId;
                if (seen.contains(key)) continue; seen.add(key);
                Integer w = alg1Strength(a,b);
                if (w>=2) edges.add(new ONAModels.EdgeResult(a.contactId,b.contactId,w,normalise(w,0,30)));
            }
        }
        return edges;
    }

    // ── Shared activity maps ──────────────────────────────────────────────────
    // ── populateSharedMaps ────────────────────────────────────────────────────────
    // Builds shared-activity maps for Alg 1 (Relationship Strength) and
    // individual counts used by Alg 2 (Influence), Alg 10 (Coverage),
    // and Alg 11 (Multi-thread HHI).
    //
    // Data sources queried:
    //   Task(Type=Email)   — manually logged email tasks
    //   EmailMessage       — real emails captured via Einstein Activity Capture / Inbox
    //                        (returns 0 records if Einstein AC is not enabled)
    //   EventRelation      — meeting attendees (shared events between contacts)
    //   OpportunityContactRole — shared opportunities
    //   Task(aggregate)    — per-contact totals for all task types
    //   Event(aggregate)   — per-contact meeting counts
    private static void populateSharedMaps(List<ONAModels.ContactNode> nodes) {
        Set<Id> ids = new Set<Id>(); Map<Id,ONAModels.ContactNode> nm = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : nodes) { ids.add(n.contactId); nm.put(n.contactId,n); }
        Date cutoff = Date.today().addMonths(-ACTIVITY_MONTHS);

        // ── Collect account IDs from nodes (needed for EmailMessage RelatedToId filter)
        Set<Id> accountIds = new Set<Id>();
        for (ONAModels.ContactNode n : nodes) { if(n.accountId != null) accountIds.add(n.accountId); }

        // ── Task (Type=Email) — manual email logs ─────────────────────────────
        // Groups emails by Task ID so contacts on the same logged email are paired.
        // Drives sharedEmails map used in Alg 1 edge weight (×3).
        Map<String,Set<Id>> em = new Map<String,Set<Id>>();
        for (Task t : [SELECT Id,WhoId FROM Task WHERE WhoId IN :ids AND Type='Email'
                       AND ActivityDate>=:cutoff AND IsDeleted=false LIMIT 5000]) {
            String k=String.valueOf(t.Id).left(15);
            if(!em.containsKey(k)) em.put(k,new Set<Id>());
            em.get(k).add(t.WhoId);
        }
        pairInc(em, nm, 'email');

        /* ─── BEGIN EAC PATCH — populateSharedMaps (EmailMessage) ─────────────────
         * Queries real inbound/outbound emails from the EmailMessage object.
         * Requires Einstein Activity Capture to be enabled and seller Gmail/
         * Outlook accounts connected. Returns 0 records without EAC.
         *
         * What this does:
         *   - Queries all EmailMessage records linked to the account
         *   - Groups messages by ID so contacts on the same email are paired
         *   - Increments sharedEmailMessages map for Alg 1 (edge weight ×4)
         *   - Increments emailMessageCount per contact for Alg 5, 6, 11
         *   - Adds to totalActivities so these contacts rank higher in selection
         *
         * To activate: remove this opening slash-asterisk and the closing
         * asterisk-slash. Ensure ONAModels EAC PATCH fields are also uncommented.
         *
        if (!accountIds.isEmpty()) {
            DateTime cutoffDt = DateTime.newInstance(cutoff, Time.newInstance(0,0,0,0));
            Map<String,Set<Id>> emMsg = new Map<String,Set<Id>>();
            for (EmailMessage msg : [
                SELECT   Id, ToIds, CreatedById, CreatedBy.Name, MessageDate, Incoming
                FROM     EmailMessage
                WHERE    RelatedToId IN :accountIds
                AND      MessageDate >= :cutoffDt
                AND      Status      != 'Draft'
                ORDER BY MessageDate DESC
                LIMIT    5000
            ]) {
                String k = String.valueOf(msg.Id).left(15);
                if (!emMsg.containsKey(k)) emMsg.put(k, new Set<Id>());
                // ToIds is String[] — each entry is a recipient Contact or Lead ID
                for (String toId : msg.ToIds) {
                    try {
                        Id cId = (Id) toId;
                        if (ids.contains(cId)) {
                            emMsg.get(k).add(cId);
                            ONAModels.ContactNode n = nm.get(cId);
                            if (n != null) {
                                n.emailMessageCount++;  // total real email count
                                n.totalActivities++;    // included in coverage/whitespace
                            }
                        }
                    } catch (Exception ex) {
                        // Skip non-Contact IDs (Leads, Users) — safe to ignore
                    }
                }
            }
            // Pair contacts who appeared on the same email thread — drives Alg 1 ×4 weight
            pairInc(emMsg, nm, 'emailMsg');
        }
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        Map<String,Set<Id>> mt = new Map<String,Set<Id>>();
        for (EventRelation er : [SELECT EventId,RelationId FROM EventRelation
                                  WHERE RelationId IN :ids AND IsDeleted=false LIMIT 5000]) {
            String k=String.valueOf(er.EventId).left(15);
            if(!mt.containsKey(k)) mt.put(k,new Set<Id>());
            mt.get(k).add(er.RelationId);
        }
        pairInc(mt, nm, 'meeting');

        Map<String,Set<Id>> op = new Map<String,Set<Id>>();
        for (OpportunityContactRole ocr : [SELECT OpportunityId,ContactId FROM OpportunityContactRole
                                            WHERE ContactId IN :ids AND IsDeleted=false LIMIT 2000]) {
            String k=String.valueOf(ocr.OpportunityId).left(15);
            if(!op.containsKey(k)) op.put(k,new Set<Id>());
            op.get(k).add(ocr.ContactId);
        }
        pairInc(op, nm, 'opp');

        for (AggregateResult ar : [SELECT WhoId,Type,COUNT(Id) cnt FROM Task
                                    WHERE WhoId IN :ids AND ActivityDate>=:cutoff
                                    AND IsDeleted=false GROUP BY WhoId,Type]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            if(ar.get('Type')=='Email') n.emailCount+=cnt; else n.taskCount+=cnt;
            n.totalActivities+=cnt;
        }
        for (AggregateResult ar : [SELECT WhoId,COUNT(Id) cnt FROM Event
                                    WHERE WhoId IN :ids AND IsDeleted=false GROUP BY WhoId]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            n.meetingCount+=cnt; n.totalActivities+=cnt;
        }
    }

    // ── populatePhase2ActivityMaps ───────────────────────────────────────────────
    // Populates 90-day and prior-90-day windows for:
    //   Alg 5 (Engagement Decay) — needs recent vs mid-term activity split
    //   Alg 6 (Velocity Scoring) — compares last 90 days vs prior 90 days
    //
    // Windows:
    //   emailCount90 / emailMessageCount90 / meetingCount90  → last 90 days
    //   emailCountPrior / emailMessageCountPrior / meetingCountPrior → 90-180 days ago
    //
    // EmailMessage is included in both windows if Einstein Activity Capture is enabled.
    private static void populatePhase2ActivityMaps(List<ONAModels.ContactNode> nodes) {
        Set<Id> ids = new Set<Id>(); Map<Id,ONAModels.ContactNode> nm = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : nodes) { ids.add(n.contactId); nm.put(n.contactId,n); }
        Date d90   = Date.today().addDays(-90);
        Date d180  = Date.today().addDays(-180);

        // ── Collect account IDs for EmailMessage queries ──────────────────────
        Set<Id> accountIds = new Set<Id>();
        for (ONAModels.ContactNode n : nodes) { if(n.accountId != null) accountIds.add(n.accountId); }
        DateTime dt90  = DateTime.newInstance(d90,  Time.newInstance(0,0,0,0));
        DateTime dt180 = DateTime.newInstance(d180, Time.newInstance(0,0,0,0));

        // ── Task emails — last 90 days ────────────────────────────────────────
        for (AggregateResult ar : [SELECT WhoId,Type,COUNT(Id) cnt FROM Task
                                    WHERE WhoId IN :ids AND ActivityDate>=:d90
                                    AND IsDeleted=false GROUP BY WhoId,Type]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            if(ar.get('Type')=='Email') n.emailCount90+=cnt;
        }

        /* ─── BEGIN EAC PATCH — Phase 2 EmailMessage (last 90 days) ────────────────
         * Populates emailMessageCount90 — real emails in the last 90 days.
         * Used by Alg 5 (Decay) recent window and Alg 6 (Velocity) last-90 value.
         * Requires EAC. Returns 0 without it — safe to leave in commented state.
         *
        if (!accountIds.isEmpty()) {
            for (EmailMessage msg : [
                SELECT   ToIds
                FROM     EmailMessage
                WHERE    RelatedToId IN :accountIds
                AND      MessageDate >= :dt90
                AND      Status      != 'Draft'
                LIMIT    2000
            ]) {
                for (String toId : msg.ToIds) {
                    try {
                        Id cId = (Id) toId;
                        ONAModels.ContactNode n = nm.get(cId);
                        if (n != null) n.emailMessageCount90++;
                    } catch (Exception ex) {}
                }
            }
        }
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        // ── Meetings — last 90 days ───────────────────────────────────────────
        for (AggregateResult ar : [SELECT WhoId,COUNT(Id) cnt FROM Event
                                    WHERE WhoId IN :ids AND ActivityDate>=:d90
                                    AND IsDeleted=false GROUP BY WhoId]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            n.meetingCount90+=cnt;
        }
        // ── Prior 90 days (90-180 days ago) — Task emails ────────────────────────
        for (AggregateResult ar : [SELECT WhoId,Type,COUNT(Id) cnt FROM Task
                                    WHERE WhoId IN :ids AND ActivityDate>=:d180
                                    AND ActivityDate<:d90 AND IsDeleted=false
                                    GROUP BY WhoId,Type]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            if(ar.get('Type')=='Email') n.emailCountPrior+=cnt;
        }

        /* ─── BEGIN EAC PATCH — Phase 2 EmailMessage (prior 90 days, 90–180d ago) ──
         * Populates emailMessageCountPrior — real emails in the 90–180 day window.
         * Used by Alg 6 (Velocity) prior-90 value to compare against recent activity.
         * Requires EAC. Returns 0 without it.
         *
        if (!accountIds.isEmpty()) {
            for (EmailMessage msg : [
                SELECT   ToIds
                FROM     EmailMessage
                WHERE    RelatedToId IN :accountIds
                AND      MessageDate >= :dt180
                AND      MessageDate <  :dt90
                AND      Status      != 'Draft'
                LIMIT    2000
            ]) {
                for (String toId : msg.ToIds) {
                    try {
                        Id cId = (Id) toId;
                        ONAModels.ContactNode n = nm.get(cId);
                        if (n != null) n.emailMessageCountPrior++;
                    } catch (Exception ex) {}
                }
            }
        }
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        // ── Prior 90 days — Meetings (Events) ────────────────────────────────
        for (AggregateResult ar : [SELECT WhoId,COUNT(Id) cnt FROM Event
                                    WHERE WhoId IN :ids AND ActivityDate>=:d180
                                    AND ActivityDate<:d90 AND IsDeleted=false
                                    GROUP BY WhoId]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            n.meetingCountPrior+=cnt;
        }
    }

    // ── pairInc ───────────────────────────────────────────────────────────────
    // Helper: given a map of (activityId → Set<contactIds>), increments the
    // shared-activity counter between every pair of contacts in the same group.
    // Called by populateSharedMaps() for each activity type.
    //
    // type values:
    //   'email'    → increments sharedEmails    (Task Type=Email)
    //   'meeting'  → increments sharedMeetings  (EventRelation)
    //   'opp'      → increments sharedOpps      (OpportunityContactRole)
    //   'emailMsg' → increments sharedEmailMessages (EAC PATCH — commented below)
    private static void pairInc(Map<String,Set<Id>> actMap, Map<Id,ONAModels.ContactNode> nm, String type) {
        for (Set<Id> grp : actMap.values()) {
            if (grp.size() < 2) continue; // need at least 2 contacts to form a pair
            List<Id> gl = new List<Id>(grp);
            for (Integer i = 0; i < gl.size(); i++) {
                for (Integer j = i + 1; j < gl.size(); j++) {
                    Id a = gl[i], b = gl[j];
                    ONAModels.ContactNode na = nm.get(a), nb = nm.get(b);
                    if (na == null || nb == null) continue;

                    /* ─── BEGIN EAC PATCH — pairInc (emailMsg) ───────────────────────
                     * Increments sharedEmailMessages between contacts on the same email.
                     * Called from populateSharedMaps() EmailMessage block (also EAC PATCH).
                     * Requires ONAModels EAC PATCH (sharedEmailMessages field) uncommented.
                     *
                    if (type == 'emailMsg') {
                        na.sharedEmailMessages.put(b, inc(na.sharedEmailMessages, b));
                        nb.sharedEmailMessages.put(a, inc(nb.sharedEmailMessages, a));
                    } else
                     *
                     * ─── END EAC PATCH ─────────────────────────────────────────── */

                    if (type == 'email') {
                        na.sharedEmails.put(b, inc(na.sharedEmails, b));
                        nb.sharedEmails.put(a, inc(nb.sharedEmails, a));
                    } else if (type == 'meeting') {
                        na.sharedMeetings.put(b, inc(na.sharedMeetings, b));
                        nb.sharedMeetings.put(a, inc(nb.sharedMeetings, a));
                    } else if (type == 'opp') {
                        na.sharedOpps.put(b, inc(na.sharedOpps, b));
                        nb.sharedOpps.put(a, inc(nb.sharedOpps, a));
                    }
                }
            }
        }
    }

    // ── Dataset control ───────────────────────────────────────────────────────
    private static List<Contact> topContacts(List<Contact> all, Map<Id,Integer> scores, Integer lim) {
        List<ONAModels.ScoredContact> sc = new List<ONAModels.ScoredContact>();
        for (Contact c : all) sc.add(new ONAModels.ScoredContact(c, scores.containsKey(c.Id)?scores.get(c.Id):0));
        sc.sort(new ONAModels.ContactScoreSorter());
        List<Contact> res = new List<Contact>();
        for (Integer i=0; i<Math.min(lim,sc.size()); i++) res.add(sc[i].contact);
        return res;
    }

    // ── activityScores ────────────────────────────────────────────────────────
    // Computes a weighted activity score per contact used to select the top-N
    // most engaged contacts when loading a large account (>50 contacts).
    //
    // This is a PRE-FILTER only — it does not affect algorithm scores.
    // Contacts with the highest activity scores are selected first so the
    // graph shows the most relevant network rather than alphabetical contacts.
    //
    // Weights mirror the algorithm weights: Meeting (5) > Email (3) > Task (2)
    private static Map<Id,Integer> activityScores(Set<Id> ids) {
        Map<Id,Integer> s = new Map<Id,Integer>();
        for (Id id : ids) s.put(id, 0);
        Date cutoff = Date.today().addMonths(-ACTIVITY_MONTHS);

        // ── Task-based activity (manual logs) ─────────────────────────────
        for (AggregateResult ar : [
            SELECT WhoId, Type, COUNT(Id) cnt
            FROM   Task
            WHERE  WhoId       IN :ids
            AND    ActivityDate >= :cutoff
            AND    IsDeleted    = false
            GROUP  BY WhoId, Type
        ]) {
            Id      wid = (Id)     ar.get('WhoId');
            Integer cnt = ((Decimal)ar.get('cnt')).intValue();
            s.put(wid, s.get(wid) + cnt * (ar.get('Type') == 'Email' ? W_EMAIL : W_TASK));
        }

        // ── Event-based activity (meetings) ───────────────────────────────
        for (AggregateResult ar : [
            SELECT WhoId, COUNT(Id) cnt
            FROM   Event
            WHERE  WhoId IN :ids AND IsDeleted = false
            GROUP  BY WhoId
        ]) {
            Id      wid = (Id)     ar.get('WhoId');
            Integer cnt = ((Decimal)ar.get('cnt')).intValue();
            s.put(wid, s.get(wid) + cnt * W_MEETING);
        }

        /* ─── BEGIN EAC PATCH — ACTIVITY SCORES (EmailMessage) ───────────────────
         * Adds real email volume to the initial contact ranking score.
         * Once EAC is active, contacts who have exchanged more real emails
         * will rank higher in the top-N selection, improving graph quality.
         *
         * accountIds must be collected from the Contact records in scope before
         * calling this patch. Add this block after the Event aggregate query above.
         *
        Set<Id> accountIds = new Set<Id>();
        for (Contact c : [SELECT AccountId FROM Contact WHERE Id IN :ids AND AccountId != null])
            accountIds.add(c.AccountId);
        if (!accountIds.isEmpty()) {
            DateTime cutoffDt = DateTime.newInstance(cutoff, Time.newInstance(0,0,0,0));
            for (EmailMessage msg : [
                SELECT ToIds
                FROM   EmailMessage
                WHERE  RelatedToId IN :accountIds
                AND    MessageDate >= :cutoffDt
                AND    Status      != 'Draft'
                LIMIT  5000
            ]) {
                for (String toId : msg.ToIds) {
                    try {
                        Id cId = (Id) toId;
                        if (s.containsKey(cId)) s.put(cId, s.get(cId) + W_EMAIL_MSG);
                    } catch (Exception ex) {
                        // skip non-contact IDs (Leads, Users etc)
                    }
                }
            }
        }
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        return s;
    }

    // ── Data fetching ─────────────────────────────────────────────────────────
    private static List<Contact> fetchAccountContacts(Id accountId) {
        return [SELECT Id,Name,Title,Department,Email,AccountId,Account.Name,ReportsToId,MailingCountry
                FROM Contact WHERE AccountId=:accountId AND IsDeleted=false ORDER BY Name LIMIT 200];
    }

    private static List<Contact> fetchMultiAccountContacts(Set<Id> acctIds) {
        return [SELECT Id,Name,Title,Department,Email,AccountId,Account.Name,ReportsToId,MailingCountry
                FROM Contact WHERE AccountId IN :acctIds AND IsDeleted=false
                ORDER BY Account.Name,Name LIMIT 1000];
    }

    private static List<Account> topAccounts(String industry, Id anchorId) {
        Date cutoff = Date.today().addMonths(-ACTIVITY_MONTHS);
        Set<Id> ids = new Set<Id>(); if(anchorId!=null) ids.add(anchorId);
        for(AggregateResult ar:[SELECT AccountId id,COUNT(Id) cnt FROM Task
                                  WHERE ActivityDate>=:cutoff AND AccountId!=null
                                  GROUP BY AccountId ORDER BY COUNT(Id) DESC LIMIT :MAX_ACCOUNTS])
            ids.add((Id)ar.get('id'));
        return (industry!=null&&industry!='')
            ?[SELECT Id,Name FROM Account WHERE Id IN :ids AND Industry=:industry LIMIT :MAX_ACCOUNTS]
            :[SELECT Id,Name FROM Account WHERE Id IN :ids LIMIT :MAX_ACCOUNTS];
    }

    private static List<ONAModels.ActivityItem> fetchTimeline(Id contactId, Integer lim) {
        List<ONAModels.ActivityItem> items = new List<ONAModels.ActivityItem>();
        for(Task t:[SELECT Id,Subject,Type,ActivityDate,What.Name FROM Task
                    WHERE WhoId=:contactId AND IsDeleted=false
                    ORDER BY ActivityDate DESC NULLS LAST LIMIT :lim]){
            ONAModels.ActivityItem i=new ONAModels.ActivityItem();
            i.id=t.Id; i.subject=t.Subject!=null?t.Subject:'Task';
            i.activityType=t.Type=='Email'?'Email':'Task';
            i.activityDate=t.ActivityDate!=null?String.valueOf(t.ActivityDate):'';
            i.relatedTo=t.What!=null?t.What.Name:''; items.add(i);
        }
        for(Event e:[SELECT Id,Subject,ActivityDate,What.Name FROM Event
                     WHERE WhoId=:contactId AND IsDeleted=false
                     ORDER BY ActivityDate DESC NULLS LAST LIMIT :lim]){
            ONAModels.ActivityItem i=new ONAModels.ActivityItem();
            i.id=e.Id; i.subject=e.Subject!=null?e.Subject:'Meeting';
            i.activityType='Meeting';
            i.activityDate=e.ActivityDate!=null?String.valueOf(e.ActivityDate):'';
            i.relatedTo=e.What!=null?e.What.Name:''; items.add(i);
        }

        /* ─── BEGIN EAC PATCH — fetchTimeline (EmailMessage) ─────────────────────
         * Adds real sent/received emails to the Contact Insight Panel timeline.
         * Currently the timeline shows only manually logged Tasks and Events.
         * With EAC, it will also show actual email subjects and directions.
         *
         * Incoming=true  = email received FROM this contact to your seller
         * Incoming=false = email sent BY your seller TO this contact
         *
        for (EmailMessage msg : [
            SELECT   Id, Subject, MessageDate, Incoming, FromAddress, ToAddress
            FROM     EmailMessage
            WHERE    Activity.WhoId = :contactId
            AND      Status         != 'Draft'
            ORDER BY MessageDate DESC NULLS LAST
            LIMIT    :lim
        ]) {
            ONAModels.ActivityItem i = new ONAModels.ActivityItem();
            i.id           = msg.Id;
            i.subject      = msg.Subject != null ? msg.Subject : '(No Subject)';
            i.activityType = msg.Incoming ? 'Email Received' : 'Email Sent';
            i.activityDate = String.valueOf(msg.MessageDate.date());
            i.relatedTo    = msg.Incoming ? msg.FromAddress : msg.ToAddress;
            items.add(i);
        }
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        return items;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LAST ACTIVITY BADGE (v4.1)
    // Queries last Task and Event date per contact.
    // Two aggregate SOQL queries only — no extra per-contact callouts.
    // ══════════════════════════════════════════════════════════════════════════
    // ── populateLastActivity + sellerInteractions (v4.2) ────────────────────────
    // Both features share the same Task/Event queries — avoids extra callouts.
    private static void populateLastActivity(List<ONAModels.ContactNode> nodes) {
        if (nodes == null || nodes.isEmpty()) return;

        Set<Id> ids = new Set<Id>();
        Map<Id,ONAModels.ContactNode> nodeMap = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : nodes) {
            ids.add(n.contactId);
            nodeMap.put(n.contactId, n);
        }

        Map<Id,Date>    lastDates   = new Map<Id,Date>();
        // Seller maps: contactId → (repId → {lastDate, count, repName})
        Map<Id, Map<Id, Date>>    sellerLast  = new Map<Id, Map<Id, Date>>();
        Map<Id, Map<Id, Integer>> sellerCount = new Map<Id, Map<Id, Integer>>();
        Map<Id, Map<Id, String>>  sellerName  = new Map<Id, Map<Id, String>>();
        Date cutoff = Date.today().addYears(-2);

        // Tasks
        for (Task t : [
            SELECT WhoId, OwnerId, Owner.Name, ActivityDate
            FROM   Task
            WHERE  WhoId        IN :ids
            AND    IsDeleted     = false
            AND    ActivityDate >= :cutoff
            ORDER  BY ActivityDate DESC
            LIMIT  2000
        ]) {
            if (t.ActivityDate == null) continue;
            // Last activity badge
            if (!lastDates.containsKey(t.WhoId) || lastDates.get(t.WhoId) < t.ActivityDate)
                lastDates.put(t.WhoId, t.ActivityDate);
            // Seller tracking
            if (!sellerLast.containsKey(t.WhoId))  sellerLast.put(t.WhoId,  new Map<Id,Date>());
            if (!sellerCount.containsKey(t.WhoId)) sellerCount.put(t.WhoId, new Map<Id,Integer>());
            if (!sellerName.containsKey(t.WhoId))  sellerName.put(t.WhoId,  new Map<Id,String>());
            Map<Id,Date>    sl = sellerLast.get(t.WhoId);
            Map<Id,Integer> sc = sellerCount.get(t.WhoId);
            Map<Id,String>  sn = sellerName.get(t.WhoId);
            if (!sl.containsKey(t.OwnerId) || sl.get(t.OwnerId) < t.ActivityDate)
                sl.put(t.OwnerId, t.ActivityDate);
            Integer cnt = sc.containsKey(t.OwnerId) ? sc.get(t.OwnerId) : 0;
            sc.put(t.OwnerId, cnt + 1);
            if (!sn.containsKey(t.OwnerId)) sn.put(t.OwnerId, t.Owner.Name);
        }

        // Events
        for (Event e : [
            SELECT WhoId, OwnerId, Owner.Name, ActivityDate
            FROM   Event
            WHERE  WhoId        IN :ids
            AND    IsDeleted     = false
            AND    ActivityDate >= :cutoff
            ORDER  BY ActivityDate DESC
            LIMIT  2000
        ]) {
            if (e.ActivityDate == null) continue;
            if (!lastDates.containsKey(e.WhoId) || lastDates.get(e.WhoId) < e.ActivityDate)
                lastDates.put(e.WhoId, e.ActivityDate);
            if (!sellerLast.containsKey(e.WhoId))  sellerLast.put(e.WhoId,  new Map<Id,Date>());
            if (!sellerCount.containsKey(e.WhoId)) sellerCount.put(e.WhoId, new Map<Id,Integer>());
            if (!sellerName.containsKey(e.WhoId))  sellerName.put(e.WhoId,  new Map<Id,String>());
            Map<Id,Date>    sl = sellerLast.get(e.WhoId);
            Map<Id,Integer> sc = sellerCount.get(e.WhoId);
            Map<Id,String>  sn = sellerName.get(e.WhoId);
            if (!sl.containsKey(e.OwnerId) || sl.get(e.OwnerId) < e.ActivityDate)
                sl.put(e.OwnerId, e.ActivityDate);
            Integer cnt = sc.containsKey(e.OwnerId) ? sc.get(e.OwnerId) : 0;
            sc.put(e.OwnerId, cnt + 1);
            if (!sn.containsKey(e.OwnerId)) sn.put(e.OwnerId, e.Owner.Name);
        }

        /* ─── BEGIN EAC PATCH — populateLastActivity (EmailMessage) ───────────────
         * Adds real email MessageDate as a candidate for the Last Activity badge
         * and includes the email sender (CreatedById) in the seller interactions list.
         *
         * Without EAC: the badge shows the last Task or Event date only.
         * With EAC:    the badge also considers the last real email send/receive date,
         *              which may be more recent than a manually logged Task.
         *
         * Also adds EmailMessage interactions to the seller interaction panel —
         * a seller who sends emails but never creates Tasks will currently show
         * as having zero interactions. EAC fixes this.
         *
        // ── EmailMessage — last activity date + seller interactions ───────
        Set<Id> emailAccountIds = new Set<Id>();
        for (ONAModels.ContactNode n : nodes) {
            if (n.accountId != null) emailAccountIds.add(n.accountId);
        }
        if (!emailAccountIds.isEmpty()) {
            DateTime emailCutoff = DateTime.newInstance(cutoff, Time.newInstance(0,0,0,0));
            for (EmailMessage msg : [
                SELECT   ToIds, CreatedById, CreatedBy.Name, MessageDate, Incoming, Subject
                FROM     EmailMessage
                WHERE    RelatedToId IN :emailAccountIds
                AND      MessageDate >= :emailCutoff
                AND      Status      != 'Draft'
                ORDER BY MessageDate DESC
                LIMIT    2000
            ]) {
                Date msgDate = msg.MessageDate.date();
                for (String toId : msg.ToIds) {
                    try {
                        Id cId = (Id) toId;
                        if (!ids.contains(cId)) continue;

                        // Update last activity badge
                        if (!lastDates.containsKey(cId) || lastDates.get(cId) < msgDate)
                            lastDates.put(cId, msgDate);

                        // Track seller interactions from EmailMessage
                        Id repId = msg.CreatedById;
                        if (!sellerLast.containsKey(cId))  sellerLast.put(cId,  new Map<Id,Date>());
                        if (!sellerCount.containsKey(cId)) sellerCount.put(cId, new Map<Id,Integer>());
                        if (!sellerName.containsKey(cId))  sellerName.put(cId,  new Map<Id,String>());
                        Map<Id,Date>    sl = sellerLast.get(cId);
                        Map<Id,Integer> sc = sellerCount.get(cId);
                        Map<Id,String>  sn = sellerName.get(cId);
                        if (!sl.containsKey(repId) || sl.get(repId) < msgDate)
                            sl.put(repId, msgDate);
                        Integer cnt = sc.containsKey(repId) ? sc.get(repId) : 0;
                        sc.put(repId, cnt + 1);
                        if (!sn.containsKey(repId)) sn.put(repId, msg.CreatedBy.Name);
                    } catch (Exception ex) {
                        // skip non-contact ToIds (Leads, Users etc)
                    }
                }
            }
        }
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        // Assign to nodes
        for (ONAModels.ContactNode n : nodes) {
            Id cid = n.contactId;

            // Last activity badge
            if (lastDates.containsKey(cid)) {
                Date    lastDate = lastDates.get(cid);
                Integer days     = lastDate.daysBetween(Date.today());
                n.lastActivityDate  = String.valueOf(lastDate);
                n.daysSinceActivity = days;
                if (days <= 30)       { n.activityBadgeLabel = days + 'd';                 n.activityBadgeColor = '#059669'; }
                else if (days <= 90)  { n.activityBadgeLabel = Math.round(days/7)  + 'w';  n.activityBadgeColor = '#B45309'; }
                else if (days <= 365) { n.activityBadgeLabel = Math.round(days/30) + 'm';  n.activityBadgeColor = '#DC2626'; }
                else                  { n.activityBadgeLabel = Math.round(days/365)+ 'y+'; n.activityBadgeColor = '#475569'; }
            } else {
                n.daysSinceActivity = 9999; n.activityBadgeLabel = 'None'; n.activityBadgeColor = '#94A3B8';
            }

            // Seller interactions — build sorted list
            if (sellerLast.containsKey(cid)) {
                Map<Id,Date>    sl = sellerLast.get(cid);
                Map<Id,Integer> sc = sellerCount.get(cid);
                Map<Id,String>  sn = sellerName.get(cid);
                List<ONAModels.SellerInteraction> sis = new List<ONAModels.SellerInteraction>();
                for (Id repId : sl.keySet()) {
                    Date    rd    = sl.get(repId);
                    Integer days  = rd.daysBetween(Date.today());
                    Integer cnt   = sc.containsKey(repId) ? sc.get(repId) : 0;
                    String  color = days <= 30 ? '#059669' : days <= 90 ? '#B45309' : '#DC2626';
                    String  whenLbl = days <= 30  ? days + 'd ago'
                                  : days <= 90  ? Math.round(days/7)  + 'w ago'
                                  : days <= 365 ? Math.round(days/30) + 'm ago'
                                  : Math.round(days/365) + 'y+ ago';
                    ONAModels.SellerInteraction si = new ONAModels.SellerInteraction();
                    si.repName   = sn.containsKey(repId) ? sn.get(repId) : 'Unknown';
                    si.daysSince = days;
                    si.whenLabel = whenLbl;
                    si.dotColor  = color;
                    si.dotStyle  = 'background:' + color + ';width:8px;height:8px;border-radius:50%;flex-shrink:0';
                    si.count     = cnt;
                    si.countLabel= cnt + ' interaction' + (cnt == 1 ? '' : 's');
                    sis.add(si);
                }
                // Sort by most recent
                sis.sort(new SellerInteractionSorter());
                // Cap at 5
                List<ONAModels.SellerInteraction> capped = new List<ONAModels.SellerInteraction>();
                for (Integer i = 0; i < Math.min(5, sis.size()); i++) capped.add(sis[i]);
                n.sellerInteractions = capped;
            }
        }
    }

    private class SellerInteractionSorter implements Comparator<ONAModels.SellerInteraction> {
        public Integer compare(ONAModels.SellerInteraction a, ONAModels.SellerInteraction b) {
            return a.daysSince - b.daysSince;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SELLER INTERACTION LAYER (v4.2)
    // Returns which Salesforce users have interacted with a contact,
    // how many times, and when their most recent interaction was.
    // Powers the hover tooltip seller panel on Network Map nodes.
    // ══════════════════════════════════════════════════════════════════════════
    @AuraEnabled(cacheable=true)
    public static List<Map<String,Object>> getContactSellerInteractions(Id contactId) {
        if (contactId == null) return new List<Map<String,Object>>();

        Date cutoff = Date.today().addYears(-2);

        // Collect all activity records for this contact
        Map<Id, Date>    lastByRep  = new Map<Id, Date>();
        Map<Id, Integer> countByRep = new Map<Id, Integer>();
        Map<Id, String>  nameByRep  = new Map<Id, String>();

        // Tasks
        for (Task t : [
            SELECT OwnerId, Owner.Name, ActivityDate
            FROM   Task
            WHERE  WhoId        = :contactId
            AND    IsDeleted    = false
            AND    ActivityDate >= :cutoff
            ORDER  BY ActivityDate DESC
            LIMIT  500
        ]) {
            if (!nameByRep.containsKey(t.OwnerId))
                nameByRep.put(t.OwnerId, t.Owner.Name);
            if (!lastByRep.containsKey(t.OwnerId) || lastByRep.get(t.OwnerId) < t.ActivityDate)
                lastByRep.put(t.OwnerId, t.ActivityDate);
            Integer tCnt = countByRep.containsKey(t.OwnerId) ? countByRep.get(t.OwnerId) : 0;
            countByRep.put(t.OwnerId, tCnt + 1);
        }

        // Events
        for (Event e : [
            SELECT OwnerId, Owner.Name, ActivityDate
            FROM   Event
            WHERE  WhoId        = :contactId
            AND    IsDeleted    = false
            AND    ActivityDate >= :cutoff
            ORDER  BY ActivityDate DESC
            LIMIT  500
        ]) {
            if (!nameByRep.containsKey(e.OwnerId))
                nameByRep.put(e.OwnerId, e.Owner.Name);
            if (!lastByRep.containsKey(e.OwnerId) || lastByRep.get(e.OwnerId) < e.ActivityDate)
                lastByRep.put(e.OwnerId, e.ActivityDate);
            Integer eCnt = countByRep.containsKey(e.OwnerId) ? countByRep.get(e.OwnerId) : 0;
            countByRep.put(e.OwnerId, eCnt + 1);
        }

        // Build result list
        List<Map<String,Object>> results = new List<Map<String,Object>>();
        for (Id repId : lastByRep.keySet()) {
            Date    lastDate = lastByRep.get(repId);
            Integer days     = lastDate.daysBetween(Date.today());
            String  color    = days <= 30 ? '#059669' : days <= 90 ? '#B45309' : '#DC2626';
            String  whenLbl  = days <= 30
                ? days + 'd ago'
                : days <= 90
                ? Math.round(days/7) + 'w ago'
                : days <= 365
                ? Math.round(days/30) + 'm ago'
                : Math.round(days/365) + 'y+ ago';

            Map<String,Object> row = new Map<String,Object>{
                'repId'    => repId,
                'repName'  => nameByRep.get(repId),
                'count'    => countByRep.get(repId),
                'daysSince'=> days,
                'whenLabel'=> whenLbl,
                'dotColor' => color,
                'dotStyle' => 'background:' + color + ';width:8px;height:8px;border-radius:50%;flex-shrink:0',
                'countLabel'=> countByRep.get(repId) + ' interaction' + (countByRep.get(repId) == 1 ? '' : 's')
            };
            results.add(row);
        }

        // Sort by most recent (daysSince ascending)
        results.sort(new SellerRepSorter());
        // subList() not supported on List<Map> — trim manually
        if (results.size() > 5) {
            List<Map<String,Object>> trimmed = new List<Map<String,Object>>();
            for (Integer i = 0; i < 5; i++) trimmed.add(results[i]);
            return trimmed;
        }
        return results;
    }

    // Sorter for seller interactions — most recent first
    private class SellerRepSorter implements Comparator<Map<String,Object>> {
        public Integer compare(Map<String,Object> a, Map<String,Object> b) {
            Integer dA = (Integer) a.get('daysSince');
            Integer dB = (Integer) b.get('daysSince');
            return dA - dB;
        }
    }

        // ── Helpers ───────────────────────────────────────────────────────────────
    private static void applyInfluence(List<ONAModels.ContactNode> nodes) {
        for(ONAModels.ContactNode n : nodes) n.influenceScore = alg2Influence(n);
    }

    private static List<ONAModels.ContactNode> buildNodes(List<Contact> contacts) {
        List<ONAModels.ContactNode> nodes = new List<ONAModels.ContactNode>();
        for(Contact c : contacts) nodes.add(new ONAModels.ContactNode(c));
        return nodes;
    }

    private static ONAModels.GraphPayload buildPayload(
        List<ONAModels.ContactNode> nodes, List<ONAModels.EdgeResult> edges,
        String mode, String label, Integer clusters, ONAModels.AccountIntelligence ai
    ) {
        ONAModels.GraphPayload p = new ONAModels.GraphPayload();
        p.nodes=nodes; p.edges=edges; p.mode=mode; p.accountName=label;
        p.totalContacts=nodes.size(); p.totalEdges=edges.size();
        p.clusterCount=clusters; p.hubCount=0;
        p.accountIntel = ai;
        for(ONAModels.ContactNode n : nodes) if(n.nodeType=='hub') p.hubCount++;
        return p;
    }

    private static String networkRole(ONAModels.ContactNode n) {
        if(n.nodeType=='hub')          return 'Network Hub — bridges multiple stakeholder groups';
        if(n.betweennessScore>=60)     return 'Gatekeeper — high betweenness, controls information flow';
        if(n.influenceScore>=75)       return 'Key Influencer — high seniority and engagement';
        if(n.centralityScore>=50)      return 'Central Communicator — well connected in account';
        if(n.velocityLabel=='Cooling') return 'Cooling Contact — engagement declining, act now';
        if(n.totalActivities<5)        return 'Low Engagement — limited recent CRM activity';
        return 'Active Contact — regular participant in account activity';
    }

    private static Integer normalise(Integer raw, Integer lo, Integer hi) {
        if(hi<=lo) return 0;
        return ((Math.max(lo,Math.min(hi,raw))-lo)*100)/(hi-lo);
    }
    private static Integer maxOf(List<Integer> vals) { Integer m=0;for(Integer v:vals)if(v>m)m=v;return m; }
    private static Integer safeGet(Map<Id,Integer> m, Id k) { return m!=null&&m.containsKey(k)?m.get(k):0; }
    private static Integer inc(Map<Id,Integer> m, Id k) { return(m.containsKey(k)?m.get(k):0)+1; }
    private static Set<Id> toIdSet(List<Contact> c) { Set<Id> s=new Set<Id>();for(Contact x:c)s.add(x.Id);return s; }
    private static Set<Id> toAccountIdSet(List<Account> a) { Set<Id> s=new Set<Id>();for(Account x:a)s.add(x.Id);return s; }

    // ── External news signals (GNews API) ────────────────────────────────────
    @AuraEnabled(cacheable=false)
    public static String getAccountNews(String accountName) {
        try {
            ONA_Settings__c settings = ONA_Settings__c.getInstance();
            String apiKey = settings.GNews_API_Key__c;
            if (String.isBlank(apiKey)) return '{"articles":[]}';

            String q = EncodingUtil.urlEncode(accountName, 'UTF-8');
            Http h = new Http();
            HttpRequest req = new HttpRequest();
            req.setEndpoint(
                'https://gnews.io/api/v4/search?q=' + q +
                '&token=' + apiKey +
                '&lang=en&max=5&sortby=publishedAt'
            );
            req.setMethod('GET');
            req.setTimeout(10000);
            HttpResponse res = h.send(req);
            if (res.getStatusCode() == 200) return res.getBody();
            return '{"articles":[]}';
        } catch (Exception e) {
            return '{"articles":[]}';
        }
    }

}
