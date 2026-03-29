/**
 * ONAModels.cls
 * Data wrapper classes for ONA Relationship Intelligence.
 */
public with sharing class ONAModels {

    public class ContactNode {
        @AuraEnabled public Id      contactId;
        @AuraEnabled public Id      accountId;
        @AuraEnabled public String  name;
        @AuraEnabled public String  initials;
        @AuraEnabled public String  title;
        @AuraEnabled public String  department;
        @AuraEnabled public String  accountName;
        @AuraEnabled public String  email;
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
        public Map<Id, Integer> sharedEmails   = new Map<Id, Integer>();
        public Map<Id, Integer> sharedMeetings = new Map<Id, Integer>();
        public Map<Id, Integer> sharedTasks    = new Map<Id, Integer>();
        public Map<Id, Integer> sharedOpps     = new Map<Id, Integer>();

        public ContactNode(Contact c) {
            this.contactId        = c.Id;
            this.accountId        = c.AccountId;
            this.name             = c.Name;
            this.initials         = buildInitials(c.Name);
            this.title            = c.Title        != null ? c.Title        : '';
            this.department       = c.Department   != null ? c.Department   : '';
            this.accountName      = c.Account      != null ? c.Account.Name : '';
            this.email            = c.Email        != null ? c.Email        : '';
            this.influenceScore   = 0;
            this.centralityScore  = 0;
            this.interactionScore = 0;
            this.degreeCentrality = 0;
            this.totalActivities  = 0;
            this.emailCount       = 0;
            this.meetingCount     = 0;
            this.taskCount        = 0;
            this.connectionCount  = 0;
            this.clusterId        = 0;
            this.nodeType         = 'connector';
        }

        private String buildInitials(String n) {
            if (n == null) return '??';
            List<String> p = n.split(' ');
            if (p.size() >= 2)
                return (p[0].substring(0,1) + p[p.size()-1].substring(0,1)).toUpperCase();
            return n.substring(0, Math.min(2, n.length())).toUpperCase();
        }
    }

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

    public class GraphPayload {
        @AuraEnabled public List<ContactNode> nodes;
        @AuraEnabled public List<EdgeResult>  edges;
        @AuraEnabled public Integer           totalContacts;
        @AuraEnabled public Integer           totalEdges;
        @AuraEnabled public Integer           hubCount;
        @AuraEnabled public Integer           clusterCount;
        @AuraEnabled public String            mode;
        @AuraEnabled public String            accountName;

        public GraphPayload() {
            this.nodes = new List<ContactNode>();
            this.edges = new List<EdgeResult>();
        }
    }

    public class InsightPayload {
        @AuraEnabled public ContactNode                 contact;
        @AuraEnabled public List<RecommendationResult> recommendations;
        @AuraEnabled public List<ActivityItem>          recentActivity;
        @AuraEnabled public String                      networkRole;
    }

    public class ActivityItem {
        @AuraEnabled public String id;
        @AuraEnabled public String subject;
        @AuraEnabled public String activityType;
        @AuraEnabled public String activityDate;
        @AuraEnabled public String relatedTo;
    }

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
