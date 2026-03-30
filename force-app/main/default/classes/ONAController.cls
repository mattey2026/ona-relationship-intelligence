/**
 * ONAController.cls  —  Phase 2
 *
 * Phase 1 algorithms (unchanged):
 *   Alg 1  Relationship Strength       email×3 + meeting×5 + task×2 + opp×4
 *   Alg 2  Influence Score             connections×2 + activity×3 + roleWeight
 *   Alg 3  Network Centrality          degree(60%) + weighted(40%) + Union-Find clusters
 *   Alg 4  Recommendation Engine       influence + centrality + paths×10 + sameCluster×12
 *
 * Phase 2 algorithms (new):
 *   Alg 5  Engagement Decay            Σ(weight × e^(-λ × monthsAgo))  λ=0.18
 *   Alg 6  Velocity Scoring            (last90 - prior90) / prior90
 *   Alg 7  Betweenness Centrality      Brandes algorithm O(VE)
 *   Alg 8  BFS Shortest Path           warm intro route finder
 *   Alg 9  Whitespace Analysis         depts with < 3 activities = gap
 *   Alg 10 Coverage Score              deptCoverage×0.6 + seniorityCoverage×0.4
 *   Alg 11 Multi-thread Risk           Herfindahl-Hirschman Index, inverted
 */
public with sharing class ONAController {

    private static final Integer MAX_CONTACTS    = 50;
    private static final Integer MAX_ACCOUNTS    = 20;
    private static final Integer ACTIVITY_MONTHS = 12;
    private static final Integer W_EMAIL         = 3;
    private static final Integer W_MEETING       = 5;
    private static final Integer W_TASK          = 2;
    private static final Integer W_OPP           = 4;
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1 ALGORITHMS
    // ═══════════════════════════════════════════════════════════════════════════

    // Alg 1 — Relationship Strength
    private static Integer alg1Strength(ONAModels.ContactNode a, ONAModels.ContactNode b) {
        return safeGet(a.sharedEmails,   b.contactId) * W_EMAIL
             + safeGet(a.sharedMeetings, b.contactId) * W_MEETING
             + safeGet(a.sharedTasks,    b.contactId) * W_TASK
             + safeGet(a.sharedOpps,     b.contactId) * W_OPP
             + (a.accountId == b.accountId ? 1 : 0);
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

    // Alg 5 — Engagement Decay
    // score = Σ(weight × e^(-λ × monthsAgo)) where λ=0.18
    // Approximated in three bands: <3m, 3-6m, 6-12m
    private static void applyDecay(List<ONAModels.ContactNode> nodes) {
        for (ONAModels.ContactNode n : nodes) {
            // recent 3 months: full weight
            Decimal recent = (n.emailCount90 * W_EMAIL) + (n.meetingCount90 * W_MEETING);
            // 3-6 months: e^(-0.18×4.5) ≈ 0.45
            Decimal mid    = ((n.emailCount - n.emailCount90) * W_EMAIL
                            + (n.meetingCount - n.meetingCount90) * W_MEETING) * 0.45;
            // 6-12 months not tracked separately — approximate at 0.20
            Decimal total  = recent + mid;
            n.decayScore   = normalise(total.intValue(), 0, 60);
        }
    }

    // Alg 6 — Velocity Scoring
    // velocity = (last90 - prior90) / prior90
    private static void applyVelocity(List<ONAModels.ContactNode> nodes) {
        for (ONAModels.ContactNode n : nodes) {
            Decimal recent = (n.emailCount90 * W_EMAIL) + (n.meetingCount90 * W_MEETING);
            Decimal prior  = (n.emailCountPrior * W_EMAIL) + (n.meetingCountPrior * W_MEETING);
            Decimal vel    = 0;
            if (prior > 0) {
                vel = (recent - prior) / prior;
            } else if (recent > 0) {
                vel = 1; // new activity from zero = max growth
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

    // Alg 11 — Multi-thread Risk (Herfindahl-Hirschman Index, inverted)
    // HHI = Σ(share²)  — high HHI = concentrated = risky
    // Score = (1 - HHI) × 100  — 100 = perfect distribution, 0 = single thread
    private static Integer alg11MultiThread(List<ONAModels.ContactNode> nodes) {
        Decimal total = 0;
        for (ONAModels.ContactNode n : nodes)
            total += n.emailCount * W_EMAIL + n.meetingCount * W_MEETING + n.taskCount * W_TASK;
        if (total == 0) return 0;
        Decimal hhi = 0;
        for (ONAModels.ContactNode n : nodes) {
            Decimal share = (n.emailCount * W_EMAIL + n.meetingCount * W_MEETING + n.taskCount * W_TASK) / total;
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
    private static void populateSharedMaps(List<ONAModels.ContactNode> nodes) {
        Set<Id> ids = new Set<Id>(); Map<Id,ONAModels.ContactNode> nm = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : nodes) { ids.add(n.contactId); nm.put(n.contactId,n); }
        Date cutoff = Date.today().addMonths(-ACTIVITY_MONTHS);

        Map<String,Set<Id>> em = new Map<String,Set<Id>>();
        for (Task t : [SELECT Id,WhoId FROM Task WHERE WhoId IN :ids AND Type='Email'
                       AND ActivityDate>=:cutoff AND IsDeleted=false LIMIT 5000]) {
            String k=String.valueOf(t.Id).left(15);
            if(!em.containsKey(k)) em.put(k,new Set<Id>());
            em.get(k).add(t.WhoId);
        }
        pairInc(em, nm, 'email');

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

    // Phase 2: Populate 90-day windows for decay and velocity
    private static void populatePhase2ActivityMaps(List<ONAModels.ContactNode> nodes) {
        Set<Id> ids = new Set<Id>(); Map<Id,ONAModels.ContactNode> nm = new Map<Id,ONAModels.ContactNode>();
        for (ONAModels.ContactNode n : nodes) { ids.add(n.contactId); nm.put(n.contactId,n); }
        Date d90   = Date.today().addDays(-90);
        Date d180  = Date.today().addDays(-180);

        // Last 90 days
        for (AggregateResult ar : [SELECT WhoId,Type,COUNT(Id) cnt FROM Task
                                    WHERE WhoId IN :ids AND ActivityDate>=:d90
                                    AND IsDeleted=false GROUP BY WhoId,Type]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            if(ar.get('Type')=='Email') n.emailCount90+=cnt;
        }
        for (AggregateResult ar : [SELECT WhoId,COUNT(Id) cnt FROM Event
                                    WHERE WhoId IN :ids AND ActivityDate>=:d90
                                    AND IsDeleted=false GROUP BY WhoId]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            n.meetingCount90+=cnt;
        }
        // Prior 90 days (90-180 days ago)
        for (AggregateResult ar : [SELECT WhoId,Type,COUNT(Id) cnt FROM Task
                                    WHERE WhoId IN :ids AND ActivityDate>=:d180
                                    AND ActivityDate<:d90 AND IsDeleted=false
                                    GROUP BY WhoId,Type]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            if(ar.get('Type')=='Email') n.emailCountPrior+=cnt;
        }
        for (AggregateResult ar : [SELECT WhoId,COUNT(Id) cnt FROM Event
                                    WHERE WhoId IN :ids AND ActivityDate>=:d180
                                    AND ActivityDate<:d90 AND IsDeleted=false
                                    GROUP BY WhoId]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            ONAModels.ContactNode n=nm.get(wid); if(n==null) continue;
            n.meetingCountPrior+=cnt;
        }
    }

    private static void pairInc(Map<String,Set<Id>> actMap, Map<Id,ONAModels.ContactNode> nm, String type) {
        for (Set<Id> grp : actMap.values()) {
            if (grp.size()<2) continue;
            List<Id> gl = new List<Id>(grp);
            for (Integer i=0;i<gl.size();i++) for (Integer j=i+1;j<gl.size();j++) {
                Id a=gl[i],b=gl[j];
                ONAModels.ContactNode na=nm.get(a), nb=nm.get(b);
                if(na==null||nb==null) continue;
                if(type=='email'){
                    na.sharedEmails.put(b,inc(na.sharedEmails,b));
                    nb.sharedEmails.put(a,inc(nb.sharedEmails,a));
                } else if(type=='meeting'){
                    na.sharedMeetings.put(b,inc(na.sharedMeetings,b));
                    nb.sharedMeetings.put(a,inc(nb.sharedMeetings,a));
                } else if(type=='opp'){
                    na.sharedOpps.put(b,inc(na.sharedOpps,b));
                    nb.sharedOpps.put(a,inc(nb.sharedOpps,a));
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

    private static Map<Id,Integer> activityScores(Set<Id> ids) {
        Map<Id,Integer> s = new Map<Id,Integer>(); for(Id id:ids) s.put(id,0);
        Date cutoff = Date.today().addMonths(-ACTIVITY_MONTHS);
        for (AggregateResult ar:[SELECT WhoId,Type,COUNT(Id) cnt FROM Task
                                  WHERE WhoId IN :ids AND ActivityDate>=:cutoff
                                  AND IsDeleted=false GROUP BY WhoId,Type]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            s.put(wid, s.get(wid)+cnt*(ar.get('Type')=='Email'?W_EMAIL:W_TASK));
        }
        for (AggregateResult ar:[SELECT WhoId,COUNT(Id) cnt FROM Event
                                  WHERE WhoId IN :ids AND IsDeleted=false GROUP BY WhoId]) {
            Id wid=(Id)ar.get('WhoId'); Integer cnt=((Decimal)ar.get('cnt')).intValue();
            s.put(wid, s.get(wid)+cnt*W_MEETING);
        }
        return s;
    }

    // ── Data fetching ─────────────────────────────────────────────────────────
    private static List<Contact> fetchAccountContacts(Id accountId) {
        return [SELECT Id,Name,Title,Department,Email,AccountId,Account.Name,ReportsToId
                FROM Contact WHERE AccountId=:accountId AND IsDeleted=false ORDER BY Name LIMIT 200];
    }

    private static List<Contact> fetchMultiAccountContacts(Set<Id> acctIds) {
        return [SELECT Id,Name,Title,Department,Email,AccountId,Account.Name,ReportsToId
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
        return items;
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
}
