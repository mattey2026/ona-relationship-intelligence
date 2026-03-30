/**
 * ONAModels.cls  —  Phase 2
 * Data wrapper classes for ONA Relationship Intelligence.
 */
public with sharing class ONAModels {

    // ── Contact node ─────────────────────────────────────────────────────────
    public class ContactNode {
        @AuraEnabled public Id      contactId;
        @AuraEnabled public Id      accountId;
        @AuraEnabled public String  name;
        @AuraEnabled public String  initials;
        @AuraEnabled public String  title;
        @AuraEnabled public String  department;
        @AuraEnabled public String  accountName;
        @AuraEnabled public String  email;

        // Phase 1 scores
        @AuraEnabled public Integer influenceScore;
        @AuraEnabled public Integer centralityScore;
        @AuraEnabled public Integer interactionScore;
        @AuraEnabled public Integer degreeCentrality;
        @AuraEnabled public String  nodeType;
        @AuraEnabled public Integer clusterId;
        @AuraEnabled public Integer connectionCount;
        @AuraEnabled public Integer totalActivities;
        @AuraEnabled public Integer emailCount;
        @AuraEnabled public Integer meetingCount;
        @AuraEnabled public Integer taskCount;
        @AuraEnabled public String  lastActivityDate;

        // Phase 2 scores
        @AuraEnabled public Integer decayScore;       // Engagement Decay
        @AuraEnabled public Decimal velocityRaw;      // Velocity raw ratio
        @AuraEnabled public String  velocityLabel;    // Growing / Cooling / Stable
        @AuraEnabled public String  velocityArrow;    // ↑ ↓ →
        @AuraEnabled public Integer betweennessScore; // Betweenness Centrality

        // For decay/velocity calculation (not exposed to UI)
        public Integer emailCount90;     // emails in last 90 days
        public Integer meetingCount90;   // meetings in last 90 days
        public Integer emailCountPrior;  // emails in prior 90 days
        public Integer meetingCountPrior;// meetings in prior 90 days

        // Shared activity maps (for edge inference)
        public Map<Id, Integer> sharedEmails   = new Map<Id, Integer>();
        public Map<Id, Integer> sharedMeetings = new Map<Id, Integer>();
        public Map<Id, Integer> sharedTasks    = new Map<Id, Integer>();
        public Map<Id, Integer> sharedOpps     = new Map<Id, Integer>();

        public ContactNode(Contact c) {
            this.contactId         = c.Id;
            this.accountId         = c.AccountId;
            this.name              = c.Name;
            this.initials          = buildInitials(c.Name);
            this.title             = c.Title      != null ? c.Title      : '';
            this.department        = c.Department != null ? c.Department : '';
            this.accountName       = c.Account    != null ? c.Account.Name : '';
            this.email             = c.Email      != null ? c.Email      : '';
            this.influenceScore    = 0;
            this.centralityScore   = 0;
            this.interactionScore  = 0;
            this.degreeCentrality  = 0;
            this.totalActivities   = 0;
            this.emailCount        = 0;
            this.meetingCount      = 0;
            this.taskCount         = 0;
            this.connectionCount   = 0;
            this.clusterId         = 0;
            this.nodeType          = 'connector';
            this.decayScore        = 0;
            this.velocityRaw       = 0;
            this.velocityLabel     = 'Stable';
            this.velocityArrow     = '→';
            this.betweennessScore  = 0;
            this.emailCount90      = 0;
            this.meetingCount90    = 0;
            this.emailCountPrior   = 0;
            this.meetingCountPrior = 0;
        }

        private String buildInitials(String n) {
            if (n == null) return '??';
            List<String> p = n.split(' ');
            if (p.size() >= 2)
                return (p[0].substring(0,1) + p[p.size()-1].substring(0,1)).toUpperCase();
            return n.substring(0, Math.min(2, n.length())).toUpperCase();
        }
    }

    // ── Edge ─────────────────────────────────────────────────────────────────
    public class EdgeResult {
        @AuraEnabled public Id      sourceId;
        @AuraEnabled public Id      targetId;
        @AuraEnabled public Integer weight;
        @AuraEnabled public Integer normalisedWeight;
        @AuraEnabled public String  edgeType;

        public EdgeResult(Id src, Id tgt, Integer w, Integer nw) {
            this.sourceId         = src;
            this.targetId         = tgt;
            this.weight           = w;
            this.normalisedWeight = nw;
            this.edgeType         = w >= 15 ? 'strong' : w >= 6 ? 'medium' : 'weak';
        }
    }

    // ── Recommendation ───────────────────────────────────────────────────────
    public class RecommendationResult {
        @AuraEnabled public ContactNode candidate;
        @AuraEnabled public Integer     recoScore;
        @AuraEnabled public String      reason;
        @AuraEnabled public String      priority;

        public RecommendationResult(ContactNode c, Integer score, String r) {
            this.candidate = c;
            this.recoScore = score;
            this.reason    = r;
            this.priority  = score >= 130 ? 'Critical'
                           : score >=  80 ? 'High'
                           : score >=  50 ? 'Medium' : 'Low';
        }
    }

    // ── Phase 2: Intro path ──────────────────────────────────────────────────
    public class IntroPath {
        @AuraEnabled public Id          targetContactId;
        @AuraEnabled public String      targetName;
        @AuraEnabled public List<Id>    pathIds;
        @AuraEnabled public List<String>pathNames;
        @AuraEnabled public Integer     hopCount;
    }

    // ── Phase 2: Whitespace item ─────────────────────────────────────────────
    public class WhitespaceItem {
        @AuraEnabled public String  department;
        @AuraEnabled public Boolean engaged;
        @AuraEnabled public Integer contactCount;
        @AuraEnabled public Integer activityCount;
    }

    // ── Phase 2: Account Intelligence ───────────────────────────────────────
    public class AccountIntelligence {
        @AuraEnabled public Integer             coverageScore;
        @AuraEnabled public String              coverageBadge;
        @AuraEnabled public Integer             multiThreadScore;
        @AuraEnabled public String              multiThreadBadge;
        @AuraEnabled public List<WhitespaceItem>whitespace;
    }

    // ── Graph payload ─────────────────────────────────────────────────────────
    public class GraphPayload {
        @AuraEnabled public List<ContactNode>   nodes;
        @AuraEnabled public List<EdgeResult>    edges;
        @AuraEnabled public Integer             totalContacts;
        @AuraEnabled public Integer             totalEdges;
        @AuraEnabled public Integer             hubCount;
        @AuraEnabled public Integer             clusterCount;
        @AuraEnabled public String              mode;
        @AuraEnabled public String              accountName;
        @AuraEnabled public AccountIntelligence accountIntel; // Phase 2

        public GraphPayload() {
            this.nodes = new List<ContactNode>();
            this.edges = new List<EdgeResult>();
        }
    }

    // ── Insight payload ───────────────────────────────────────────────────────
    public class InsightPayload {
        @AuraEnabled public ContactNode                  contact;
        @AuraEnabled public List<RecommendationResult>   recommendations;
        @AuraEnabled public List<ActivityItem>           recentActivity;
        @AuraEnabled public String                       networkRole;
        @AuraEnabled public List<IntroPath>              introPaths; // Phase 2
    }

    // ── Activity item ─────────────────────────────────────────────────────────
    public class ActivityItem {
        @AuraEnabled public String id;
        @AuraEnabled public String subject;
        @AuraEnabled public String activityType;
        @AuraEnabled public String activityDate;
        @AuraEnabled public String relatedTo;
    }

    // ── Sorters ───────────────────────────────────────────────────────────────
    public class ScoredContact {
        public Contact contact;
        public Integer score;
        public ScoredContact(Contact c, Integer s) { this.contact = c; this.score = s; }
    }

    public class RecoSorter implements Comparator<RecommendationResult> {
        public Integer compare(RecommendationResult a, RecommendationResult b) {
            return b.recoScore - a.recoScore;
        }
    }

    public class ContactScoreSorter implements Comparator<ScoredContact> {
        public Integer compare(ScoredContact a, ScoredContact b) {
            return b.score - a.score;
        }
    }
}
