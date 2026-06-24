/**
 * ============================================================
 * ONA Relationship Intelligence — ONAModels.cls
 * ============================================================
 * Author      : Sumit Mattey
 * Organisation: Genpact — Salesforce Practice
 * GitHub      : https://github.com/mattey2026/ona-relationship-intelligence
 * Updated     : 15 June 2026
 * Version     : 4.4
 * ------------------------------------------------------------
 * Description :
 *   Data model classes (DTOs) for the ONA platform.
 *   All @AuraEnabled fields are serialised to JSON and consumed
 *   by the onaRelationshipMap LWC component via D3 rendering.
 *
 * ── Activity data sources tracked ──────────────────────────
 *  ACTIVE NOW:
 *   • Task (Type='Email')  → emailCount        — manual seller log
 *   • Event                → meetingCount      — meetings / calls
 *   • Task (other types)   → taskCount         — follow-ups, notes
 *
 *  EAC PATCH (commented — activate when Einstein Activity Capture enabled):
 *   • EmailMessage.Incoming=false → emailMessageCount — real outbound emails
 *   • EmailMessage.Incoming=true  → emailMessageCount — real inbound emails
 *
 * ── EAC PATCH activation instructions ──────────────────────
 *   1. Setup → Einstein Activity Capture → Enable
 *   2. Connect seller Gmail or Outlook accounts
 *   3. Wait 24 hours for initial email sync
 *   4. In this file : remove the opening slash-star and closing
 *      star-slash markers on each EAC PATCH block (search "EAC PATCH"
 *      to find them)
 *   5. In ONAController.cls : do the same
 *   6. Deploy both files
 * ------------------------------------------------------------
 * v4.4 (15 June 2026):
 *   - No changes to this class's logic. Version bumped to align
 *     with the new Agentforce action layer (ONAAgentUtils v1.3,
 *     ONAAgentFindAccount, 5 ONAAgentGet* invocable actions) which
 *     reuses these DTOs and is versioned/dated together for
 *     traceability in git history.
 * ============================================================
 */
public with sharing class ONAModels {

    // ══════════════════════════════════════════════════════════════════════════
    // CONTACT NODE
    // ══════════════════════════════════════════════════════════════════════════
    // Central DTO representing one contact in the relationship graph.
    // One instance per contact per graph load — all algorithms write into
    // the same node instance so the LWC receives a single coherent object.
    // ══════════════════════════════════════════════════════════════════════════
    public class ContactNode {

        // ── Identity ──────────────────────────────────────────────────────────
        @AuraEnabled public Id      contactId;    // Salesforce Contact record ID
        @AuraEnabled public Id      accountId;    // Parent Account ID
        @AuraEnabled public String  name;         // Full name — displayed on node label
        @AuraEnabled public String  initials;     // 2-char initials — displayed inside node circle
        @AuraEnabled public String  title;        // Job title — used in role weight (Alg 2)
        @AuraEnabled public String  department;   // Department — used in Coverage Score (Alg 10)
        @AuraEnabled public String  accountName;  // Account name — shown in hover tooltip
        @AuraEnabled public String  email;        // Email address
        @AuraEnabled public String  phone;        // Office phone
        @AuraEnabled public String  mobilePhone;  // Mobile phone
        @AuraEnabled public String  country;      // Mailing country
        @AuraEnabled public String  region;       // Derived region (Americas / APAC / EMEA)

        // ── Data Completeness (v4.5) ─────────────────────────────────────────
        // Plain field-presence check — NOT a "verified accurate" claim.
        // Used to flag contacts where ONA's scores may be less reliable
        // because core fields (phone/mobile, email, title) are missing.
        @AuraEnabled public String  completenessLevel; // 'complete' / 'partial' / 'incomplete'
        @AuraEnabled public Integer completenessCount; // 0-3, how many of the 3 checks passed

        // ── Champion Risk (v4.6) ──────────────────────────────────────────────
        // A "Champion" is inferred, not a stored field — high Influence Score
        // (senior + well-connected + previously engaged) whose engagement has
        // now flipped to Cooling. Computed live on every graph load; nothing
        // persisted, no Task created. See applyChampionRisk() in ONAController.
        @AuraEnabled public Boolean isChampionRisk;
        @AuraEnabled public String  championRiskReason;

        // ── Phase 1 Scores ────────────────────────────────────────────────────
        // Computed by algorithms 1-4. All normalised to 0-100.
        @AuraEnabled public Integer influenceScore;    // Alg 2 — connection count × activity × role weight
        @AuraEnabled public Integer centralityScore;   // Alg 3 — degree + weighted centrality
        @AuraEnabled public Integer interactionScore;  // Raw interaction total before normalisation
        @AuraEnabled public Integer degreeCentrality;  // Raw degree (number of direct connections)
        @AuraEnabled public String  nodeType;          // 'hub' / 'connector' / 'low' — drives node colour
        @AuraEnabled public Integer clusterId;         // Union-Find cluster ID (Alg 3)
        @AuraEnabled public Integer connectionCount;   // Direct edge count in graph

        // ── Activity Counts — ACTIVE DATA SOURCES ─────────────────────────────
        // These are populated by populateSharedMaps() in ONAController.cls.
        // Used by: Alg 5 (Decay), Alg 6 (Velocity), Alg 10 (Coverage),
        //          Alg 11 (Multi-thread HHI), Alg 2 (Influence).

        // totalActivities: sum of all activity types — drives coverage threshold
        @AuraEnabled public Integer totalActivities;

        // emailCount: Tasks logged with Type = 'Email' by sellers manually
        // Source: Task object, WHERE Type = 'Email'
        @AuraEnabled public Integer emailCount;

        // meetingCount: Events logged against this contact
        // Source: Event object
        @AuraEnabled public Integer meetingCount;

        // taskCount: Tasks that are NOT email type (calls, follow-ups, notes)
        // Source: Task object, WHERE Type != 'Email'
        @AuraEnabled public Integer taskCount;

        /* ─── BEGIN EAC PATCH ─────────────────────────────────────────────────
         * Requires Einstein Activity Capture (EAC) to be enabled.
         * These fields count real emails automatically synced from Gmail/Outlook.
         * They are declared but remain 0 until EAC is active.
         *
         * To activate: remove this opening comment block marker and the
         *              closing END EAC PATCH marker below.
         *
         * emailMessageCount: real emails (inbound + outbound) via EmailMessage object
         * Source: EmailMessage, WHERE RelatedToId = account AND Status != 'Draft'
         *
        @AuraEnabled public Integer emailMessageCount;
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        // ── Last Activity Badge ────────────────────────────────────────────────
        // Populated by populateLastActivity() — drives the ⊙ Last Activity toggle.
        @AuraEnabled public String  lastActivityDate   = '';  // ISO date string of most recent activity
        @AuraEnabled public Integer daysSinceActivity  = 9999; // Days since last Task or Event
        @AuraEnabled public String  activityBadgeLabel = 'None'; // Display label: '7d', '3w', '4m', etc.
        @AuraEnabled public String  activityBadgeColor = '#94A3B8'; // Green/Amber/Red/Grey

        // ── Phase 2 Scores ────────────────────────────────────────────────────
        // Computed by Alg 5 (Decay), Alg 6 (Velocity), Alg 7 (Betweenness).
        @AuraEnabled public Integer decayScore;       // 0-100: recency-weighted engagement level
        @AuraEnabled public Decimal velocityRaw;      // Raw ratio: (last90 - prior90) / prior90
        @AuraEnabled public String  velocityLabel;    // 'Growing' / 'Cooling' / 'Stable'
        @AuraEnabled public String  velocityArrow;    // '↑' / '↓' / '→'
        @AuraEnabled public Integer betweennessScore; // 0-100: gatekeeper index (Brandes algorithm)

        // ── Seller Interaction Layer (v4.2) ───────────────────────────────────
        // Pre-loaded by populateLastActivity() — shown in hover tooltip.
        // Each entry: which rep last contacted this contact, when, how many times.
        @AuraEnabled public List<SellerInteraction> sellerInteractions = new List<SellerInteraction>();

        // ── 90-day Activity Windows — NOT exposed to UI ────────────────────────
        // Internal fields used exclusively by Alg 5 (Decay) and Alg 6 (Velocity).
        // Populated by populatePhase2ActivityMaps() in ONAController.cls.
        public Integer emailCount90;      // Task emails in last 90 days
        public Integer meetingCount90;    // Events in last 90 days
        public Integer emailCountPrior;   // Task emails in prior 90 days (90-180d ago)
        public Integer meetingCountPrior; // Events in prior 90 days

        /* ─── BEGIN EAC PATCH ─────────────────────────────────────────────────
         * Additional 90-day windows for real email counts (EAC only).
         * Declared here so the constructor initialises them to 0.
         * populatePhase2ActivityMaps() will populate them when EAC is active.
         *
        public Integer emailMessageCount90;    // Real emails in last 90 days
        public Integer emailMessageCountPrior; // Real emails in prior 90 days
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        // ── Shared Activity Maps — NOT exposed to UI ───────────────────────────
        // Used by Alg 1 (Relationship Strength) to compute edge weights.
        // Key = other contact's ID.  Value = number of shared activities of that type.
        public Map<Id, Integer> sharedEmails   = new Map<Id, Integer>(); // shared Task(Email) events
        public Map<Id, Integer> sharedMeetings = new Map<Id, Integer>(); // shared Event attendances
        public Map<Id, Integer> sharedTasks    = new Map<Id, Integer>(); // shared non-email Tasks
        public Map<Id, Integer> sharedOpps     = new Map<Id, Integer>(); // shared Opportunity roles

        /* ─── BEGIN EAC PATCH ─────────────────────────────────────────────────
         * Shared EmailMessage map — counts how many real emails two contacts
         * were both involved in (both recipients of same email thread).
         * Used by Alg 1 with weight W_EMAIL_MSG = 4 (higher than manual log).
         *
        public Map<Id, Integer> sharedEmailMessages = new Map<Id, Integer>();
         *
         * ─── END EAC PATCH ─────────────────────────────────────────────────── */

        // ── Constructor ────────────────────────────────────────────────────────
        public ContactNode(Contact c) {
            this.contactId         = c.Id;
            this.accountId         = c.AccountId;
            this.name              = c.Name;
            this.initials          = buildInitials(c.Name);
            this.title             = c.Title      != null ? c.Title      : '';
            this.department        = c.Department != null ? c.Department : '';
            this.accountName       = c.Account    != null ? c.Account.Name : '';
            this.email             = c.Email      != null ? c.Email      : '';
            this.phone             = c.Phone      != null ? c.Phone      : '';
            this.mobilePhone       = c.MobilePhone != null ? c.MobilePhone : '';
            this.country           = c.MailingCountry != null ? c.MailingCountry : '';
            this.region            = ONAModels.deriveRegion(c.MailingCountry);

            // Completeness check: Phone-OR-Mobile, Email, Title — 3 checks total.
            // Phone and Mobile count as ONE check (satisfied by either) since
            // most orgs populate one or the other, not both.
            Integer completeCount = 0;
            if (String.isNotBlank(c.Phone) || String.isNotBlank(c.MobilePhone)) completeCount++;
            if (String.isNotBlank(c.Email)) completeCount++;
            if (String.isNotBlank(c.Title)) completeCount++;
            this.completenessCount = completeCount;
            this.completenessLevel = completeCount == 3 ? 'complete'
                                    : completeCount >= 1 ? 'partial'
                                    : 'incomplete';
            // Champion Risk — computed later in ONAController.applyChampionRisk()
            // once influenceScore, velocityLabel, and decayScore are all final.
            this.isChampionRisk     = false;
            this.championRiskReason = '';
            // Scores — all start at 0, populated by algorithms
            this.influenceScore    = 0;
            this.centralityScore   = 0;
            this.interactionScore  = 0;
            this.degreeCentrality  = 0;
            this.connectionCount   = 0;
            this.clusterId         = 0;
            this.nodeType          = 'connector';
            this.decayScore        = 0;
            this.velocityRaw       = 0;
            this.velocityLabel     = 'Stable';
            this.velocityArrow     = '→';
            this.betweennessScore  = 0;
            // Activity counts — populated by populateSharedMaps()
            this.totalActivities        = 0;
            this.emailCount             = 0;
            this.meetingCount           = 0;
            this.taskCount              = 0;
            // 90-day windows — populated by populatePhase2ActivityMaps()
            this.emailCount90           = 0;
            this.meetingCount90         = 0;
            this.emailCountPrior        = 0;
            this.meetingCountPrior      = 0;

            /* ─── BEGIN EAC PATCH ─────────────────────────────────────────────
             * Initialise EmailMessage counters to 0.
             * Remove comment markers when EAC is active.
             *
            this.emailMessageCount      = 0;
            this.emailMessageCount90    = 0;
            this.emailMessageCountPrior = 0;
             *
             * ─── END EAC PATCH ─────────────────────────────────────────────── */
        }

        // Builds 2-character initials from full name (e.g. "Sumit Mattey" → "SM")
        private String buildInitials(String n) {
            if (n == null) return '??';
            List<String> p = n.split(' ');
            if (p.size() >= 2)
                return (p[0].substring(0,1) + p[p.size()-1].substring(0,1)).toUpperCase();
            return n.substring(0, Math.min(2, n.length())).toUpperCase();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SELLER INTERACTION
    // ══════════════════════════════════════════════════════════════════════════
    // One entry per seller who has interacted with a contact.
    // Pre-loaded by populateLastActivity() in ONAController.
    // Shown in the hover tooltip "Team Interactions" section.
    // ══════════════════════════════════════════════════════════════════════════
    public class SellerInteraction {
        @AuraEnabled public String  repName    = ''; // Seller's full name
        @AuraEnabled public Integer daysSince  = 0;  // Days since their last interaction
        @AuraEnabled public String  whenLabel  = ''; // Human-readable: '3d ago', '6w ago', etc.
        @AuraEnabled public String  dotColor   = '#94A3B8'; // Green / Amber / Red based on recency
        @AuraEnabled public String  dotStyle   = ''; // Inline CSS for the colour dot in the UI
        @AuraEnabled public Integer count      = 0;  // Total interactions (Tasks + Events) by this rep
        @AuraEnabled public String  countLabel = ''; // '8 interactions' / '1 interaction'
    }

    // ══════════════════════════════════════════════════════════════════════════
    // EDGE RESULT
    // ══════════════════════════════════════════════════════════════════════════
    // Represents a relationship edge between two contacts.
    // Weight drives D3 line thickness: weak=dashed, medium=thin, strong=thick gold.
    // ══════════════════════════════════════════════════════════════════════════
    public class EdgeResult {
        @AuraEnabled public Id      sourceId;         // First contact ID
        @AuraEnabled public Id      targetId;         // Second contact ID
        @AuraEnabled public Integer weight;           // Raw Alg 1 score (sum of shared activities × weights)
        @AuraEnabled public Integer normalisedWeight; // 0-100 normalised for D3 line thickness
        @AuraEnabled public String  edgeType;         // 'strong' (≥15) / 'medium' (6-14) / 'weak' (<6)

        public EdgeResult(Id src, Id tgt, Integer w, Integer nw) {
            this.sourceId         = src;
            this.targetId         = tgt;
            this.weight           = w;
            this.normalisedWeight = nw;
            this.edgeType         = w >= 15 ? 'strong' : w >= 6 ? 'medium' : 'weak';
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RECOMMENDATION RESULT
    // ══════════════════════════════════════════════════════════════════════════
    // Output of Alg 4 — represents one recommended contact for the seller
    // to engage with, with a score and a human-readable reason.
    // ══════════════════════════════════════════════════════════════════════════
    public class RecommendationResult {
        @AuraEnabled public ContactNode candidate; // The recommended contact
        @AuraEnabled public Integer     recoScore; // Composite score (influence + centrality + paths)
        @AuraEnabled public String      reason;    // Plain-English explanation for the seller
        @AuraEnabled public String      priority;  // 'Critical' / 'High' / 'Medium' / 'Low'

        public RecommendationResult(ContactNode c, Integer score, String r) {
            this.candidate = c;
            this.recoScore = score;
            this.reason    = r;
            this.priority  = score >= 130 ? 'Critical'
                           : score >=  80 ? 'High'
                           : score >=  50 ? 'Medium' : 'Low';
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INTRO PATH (Alg 8 — BFS Warm Introduction)
    // ══════════════════════════════════════════════════════════════════════════
    // Represents the shortest path between a seller and an unconnected contact.
    // Shown in the Contact Insight Panel as a chain: You → Person A → Target.
    // ══════════════════════════════════════════════════════════════════════════
    public class IntroPath {
        @AuraEnabled public Id           targetContactId; // ID of the unconnected target
        @AuraEnabled public String       targetName;      // Name of the unconnected target
        @AuraEnabled public List<Id>     pathIds;         // Ordered list of contact IDs in the path
        @AuraEnabled public List<String> pathNames;       // Ordered list of contact names in the path
        @AuraEnabled public Integer      hopCount;        // Number of steps (2 = one intermediary)
    }

    // ══════════════════════════════════════════════════════════════════════════
    // WHITESPACE ITEM (Alg 9 — Whitespace Analysis)
    // ══════════════════════════════════════════════════════════════════════════
    // One entry per department detected in the account contacts.
    // engaged=false means fewer than WHITESPACE_THRESHOLD interactions
    // — a coverage gap that needs to be filled before renewal.
    // ══════════════════════════════════════════════════════════════════════════
    public class WhitespaceItem {
        @AuraEnabled public String  department;    // Department name from Contact.Department
        @AuraEnabled public Boolean engaged;       // true = ≥3 interactions, false = gap
        @AuraEnabled public Integer contactCount;  // How many contacts are in this department
        @AuraEnabled public Integer activityCount; // Total activities across all contacts in dept
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ACCOUNT INTELLIGENCE (Alg 10 + Alg 11 + Alg 9)
    // ══════════════════════════════════════════════════════════════════════════
    // Computed once per graph load and shown in the Bell Summary popup,
    // Portfolio View, and Relationship Handover Pack PDF.
    // ══════════════════════════════════════════════════════════════════════════
    public class AccountIntelligence {
        @AuraEnabled public Integer              coverageScore;    // Alg 10: 0-100 breadth across depts + seniority
        @AuraEnabled public String               coverageBadge;    // 'Good' / 'Moderate' / 'At Risk'
        @AuraEnabled public Integer              multiThreadScore; // Alg 11: 0-100 (100=safe, 0=single-thread)
        @AuraEnabled public String               multiThreadBadge; // 'Healthy' / 'Moderate' / 'High Risk'
        @AuraEnabled public List<WhitespaceItem> whitespace;       // Alg 9: per-department coverage detail
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GRAPH PAYLOAD
    // ══════════════════════════════════════════════════════════════════════════
    // Top-level response object returned by getAccountGraph() and
    // getCrossAccountGraph(). Serialised to JSON and parsed by the LWC.
    // ══════════════════════════════════════════════════════════════════════════
    public class GraphPayload {
        @AuraEnabled public List<ContactNode>    nodes;         // All contact nodes
        @AuraEnabled public List<EdgeResult>     edges;         // All relationship edges
        @AuraEnabled public Integer              totalContacts; // Count of nodes
        @AuraEnabled public Integer              totalEdges;    // Count of edges
        @AuraEnabled public Integer              hubCount;      // Nodes with nodeType='hub'
        @AuraEnabled public Integer              clusterCount;  // Unique clusters from Union-Find
        @AuraEnabled public String               mode;          // 'account' or 'global'
        @AuraEnabled public String               accountName;   // Display label for the graph
        @AuraEnabled public AccountIntelligence  accountIntel;  // Alg 9-11 combined results

        public GraphPayload() {
            this.nodes = new List<ContactNode>();
            this.edges = new List<EdgeResult>();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // INSIGHT PAYLOAD
    // ══════════════════════════════════════════════════════════════════════════
    // Response from getContactInsight() — shown in the Contact Insight Panel
    // when a seller clicks on a node in the graph.
    // ══════════════════════════════════════════════════════════════════════════
    public class InsightPayload {
        @AuraEnabled public ContactNode                contact;         // Full node data for clicked contact
        @AuraEnabled public List<RecommendationResult> recommendations; // Alg 4 top-5 next contacts
        @AuraEnabled public List<ActivityItem>         recentActivity;  // Timeline of last 8 activities
        @AuraEnabled public String                     networkRole;     // Plain English role description
        @AuraEnabled public List<IntroPath>            introPaths;      // Alg 8 BFS intro paths
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ACTIVITY ITEM
    // ══════════════════════════════════════════════════════════════════════════
    // One entry in the Contact Insight Panel timeline.
    // Sourced from Task and Event records against the contact.
    // ══════════════════════════════════════════════════════════════════════════
    public class ActivityItem {
        @AuraEnabled public String id;           // Record ID (Task or Event)
        @AuraEnabled public String subject;      // Subject line of the activity
        @AuraEnabled public String activityType; // 'Email' / 'Meeting' / 'Task'
        @AuraEnabled public String activityDate; // ISO date string
        @AuraEnabled public String relatedTo;    // Related Account or Opportunity name
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SORTERS AND HELPERS
    // ══════════════════════════════════════════════════════════════════════════

    // Wrapper used to sort contacts by activity score before selecting top N
    public class ScoredContact {
        public Contact contact;
        public Integer score;
        public ScoredContact(Contact c, Integer s) { this.contact = c; this.score = s; }
    }

    // Sorts recommendations highest score first (Alg 4)
    public class RecoSorter implements Comparator<RecommendationResult> {
        public Integer compare(RecommendationResult a, RecommendationResult b) {
            return b.recoScore - a.recoScore;
        }
    }

    // Sorts contacts highest activity score first (for top-N selection)
    public class ContactScoreSorter implements Comparator<ScoredContact> {
        public Integer compare(ScoredContact a, ScoredContact b) {
            return b.score - a.score;
        }
    }

    // ── Utility: derive region from ISO country code ──────────────────────────
    // Used to populate ContactNode.region for geographic filtering in the LWC.
    public static String deriveRegion(String country) {
        if (country == null || country == '') return 'Unknown';
        Set<String> americas = new Set<String>{'US','CA','BR','MX','AR','CO','CL'};
        Set<String> apac     = new Set<String>{'IN','SG','AU','JP','CN','HK','MY','TH','NZ','KR','ID','PH'};
        if (americas.contains(country)) return 'Americas';
        if (apac.contains(country))     return 'APAC';
        return 'EMEA';
    }
}
