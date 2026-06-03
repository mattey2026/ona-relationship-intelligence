/**
 * ONAModelsTest.cls
 * 100% test coverage for ONAModels — all inner classes, constructors, sorters.
 */
@isTest
private class ONAModelsTest {

    // ══════════════════════════════════════════════════════════════════════════
    // ContactNode constructor — all field assignments
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testContactNode_fullContact() {
        Account acc = new Account(Name='Test Account');
        insert acc;
        Contact c = new Contact(
            FirstName   = 'John',
            LastName    = 'Smith',
            Title       = 'VP Engineering',
            Department  = 'Engineering',
            Email       = 'john@test.com',
            AccountId   = acc.Id,
            MailingCountry = 'US'
        );
        insert c;
        // Reload with Account.Name
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name,
                    ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];

        Test.startTest();
        ONAModels.ContactNode node = new ONAModels.ContactNode(c);
        Test.stopTest();

        System.assertEquals(c.Id,          node.contactId);
        System.assertEquals(c.AccountId,   node.accountId);
        System.assertEquals('John Smith',  node.name);
        System.assertEquals('JS',          node.initials);
        System.assertEquals('VP Engineering', node.title);
        System.assertEquals('Engineering', node.department);
        System.assertEquals('Test Account',node.accountName);
        System.assertEquals('john@test.com', node.email);
        System.assertEquals('US',          node.country);
        System.assertEquals('Americas',    node.region);
        System.assertEquals(0,             node.influenceScore);
        System.assertEquals(0,             node.decayScore);
        System.assertEquals('Stable',      node.velocityLabel);
        System.assertEquals('→',           node.velocityArrow);
        System.assertEquals('connector',   node.nodeType);
    }

    @isTest
    static void testContactNode_nullFields() {
        Account acc = new Account(Name='Null Test Account');
        insert acc;
        // Contact with minimal fields — title, department, email, country all null
        Contact c = new Contact(LastName='Doe', AccountId=acc.Id);
        insert c;
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name,
                    ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];

        Test.startTest();
        ONAModels.ContactNode node = new ONAModels.ContactNode(c);
        Test.stopTest();

        System.assertEquals('',        node.title);
        System.assertEquals('',        node.department);
        System.assertEquals('',        node.email);
        System.assertEquals('',        node.country);
        System.assertEquals('Unknown', node.region);
    }

    @isTest
    static void testContactNode_singleWordName() {
        Account acc = new Account(Name='Single Name Account');
        insert acc;
        Contact c = new Contact(LastName='Madonna', AccountId=acc.Id);
        insert c;
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name,
                    ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];

        Test.startTest();
        ONAModels.ContactNode node = new ONAModels.ContactNode(c);
        Test.stopTest();

        System.assertEquals(2, node.initials.length(), 'Single name should produce 2-char initials');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // deriveRegion — all region branches
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testDeriveRegion_americas() {
        System.assertEquals('Americas', ONAModels.deriveRegion('US'));
        System.assertEquals('Americas', ONAModels.deriveRegion('CA'));
        System.assertEquals('Americas', ONAModels.deriveRegion('BR'));
        System.assertEquals('Americas', ONAModels.deriveRegion('MX'));
        System.assertEquals('Americas', ONAModels.deriveRegion('AR'));
        System.assertEquals('Americas', ONAModels.deriveRegion('CO'));
        System.assertEquals('Americas', ONAModels.deriveRegion('CL'));
    }

    @isTest
    static void testDeriveRegion_apac() {
        System.assertEquals('APAC', ONAModels.deriveRegion('IN'));
        System.assertEquals('APAC', ONAModels.deriveRegion('SG'));
        System.assertEquals('APAC', ONAModels.deriveRegion('AU'));
        System.assertEquals('APAC', ONAModels.deriveRegion('JP'));
        System.assertEquals('APAC', ONAModels.deriveRegion('CN'));
        System.assertEquals('APAC', ONAModels.deriveRegion('HK'));
        System.assertEquals('APAC', ONAModels.deriveRegion('MY'));
        System.assertEquals('APAC', ONAModels.deriveRegion('TH'));
        System.assertEquals('APAC', ONAModels.deriveRegion('NZ'));
        System.assertEquals('APAC', ONAModels.deriveRegion('KR'));
        System.assertEquals('APAC', ONAModels.deriveRegion('ID'));
        System.assertEquals('APAC', ONAModels.deriveRegion('PH'));
    }

    @isTest
    static void testDeriveRegion_emea() {
        System.assertEquals('EMEA', ONAModels.deriveRegion('UK'));
        System.assertEquals('EMEA', ONAModels.deriveRegion('DE'));
        System.assertEquals('EMEA', ONAModels.deriveRegion('AE'));
        System.assertEquals('EMEA', ONAModels.deriveRegion('FR'));
        System.assertEquals('EMEA', ONAModels.deriveRegion('ZA'));
    }

    @isTest
    static void testDeriveRegion_nullAndEmpty() {
        System.assertEquals('Unknown', ONAModels.deriveRegion(null));
        System.assertEquals('Unknown', ONAModels.deriveRegion(''));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // EdgeResult constructor
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testEdgeResult_strong() {
        Account a = new Account(Name='Edge Account'); insert a;
        Contact c1 = new Contact(LastName='Source', AccountId=a.Id); insert c1;
        Contact c2 = new Contact(LastName='Target', AccountId=a.Id); insert c2;

        Test.startTest();
        ONAModels.EdgeResult strong = new ONAModels.EdgeResult(c1.Id, c2.Id, 20, 80);
        ONAModels.EdgeResult medium = new ONAModels.EdgeResult(c1.Id, c2.Id, 10, 40);
        ONAModels.EdgeResult weak   = new ONAModels.EdgeResult(c1.Id, c2.Id,  3, 10);
        Test.stopTest();

        System.assertEquals('strong', strong.edgeType);
        System.assertEquals('medium', medium.edgeType);
        System.assertEquals('weak',   weak.edgeType);
        System.assertEquals(c1.Id,    strong.sourceId);
        System.assertEquals(c2.Id,    strong.targetId);
        System.assertEquals(20,       strong.weight);
        System.assertEquals(80,       strong.normalisedWeight);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RecommendationResult constructor — all priority branches
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testRecommendationResult_allPriorities() {
        Account a = new Account(Name='Reco Account'); insert a;
        Contact c = new Contact(LastName='Candidate', AccountId=a.Id); insert c;
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name,
                    ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];
        ONAModels.ContactNode cn = new ONAModels.ContactNode(c);

        Test.startTest();
        ONAModels.RecommendationResult critical = new ONAModels.RecommendationResult(cn, 140, 'Critical reason');
        ONAModels.RecommendationResult high     = new ONAModels.RecommendationResult(cn, 100, 'High reason');
        ONAModels.RecommendationResult medium   = new ONAModels.RecommendationResult(cn,  60, 'Medium reason');
        ONAModels.RecommendationResult low      = new ONAModels.RecommendationResult(cn,  20, 'Low reason');
        Test.stopTest();

        System.assertEquals('Critical', critical.priority);
        System.assertEquals('High',     high.priority);
        System.assertEquals('Medium',   medium.priority);
        System.assertEquals('Low',      low.priority);
        System.assertEquals(cn,         critical.candidate);
        System.assertEquals('Critical reason', critical.reason);
        System.assertEquals(140,        critical.recoScore);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ScoredContact constructor
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testScoredContact() {
        Account a = new Account(Name='Score Account'); insert a;
        Contact c = new Contact(LastName='Scored', AccountId=a.Id); insert c;

        Test.startTest();
        ONAModels.ScoredContact sc = new ONAModels.ScoredContact(c, 85);
        Test.stopTest();

        System.assertEquals(c.Id, sc.contact.Id);
        System.assertEquals(85,   sc.score);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // RecoSorter — compare (descending by score)
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testRecoSorter() {
        Account a = new Account(Name='Sort Account'); insert a;
        Contact c1 = new Contact(LastName='High', AccountId=a.Id); insert c1;
        Contact c2 = new Contact(LastName='Low',  AccountId=a.Id); insert c2;
        c1 = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name, ReportsToId, MailingCountry FROM Contact WHERE Id=:c1.Id];
        c2 = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name, ReportsToId, MailingCountry FROM Contact WHERE Id=:c2.Id];
        ONAModels.ContactNode cn1 = new ONAModels.ContactNode(c1);
        ONAModels.ContactNode cn2 = new ONAModels.ContactNode(c2);

        ONAModels.RecommendationResult r1 = new ONAModels.RecommendationResult(cn1, 120, 'High');
        ONAModels.RecommendationResult r2 = new ONAModels.RecommendationResult(cn2,  40, 'Low');

        // Test the Comparator contract directly (inner-class Comparator + external test = restriction)
        ONAModels.RecoSorter sorter = new ONAModels.RecoSorter();

        Test.startTest();
        Integer cmp1 = sorter.compare(r1, r2); // r1=120, r2=40 → negative (higher first)
        Integer cmp2 = sorter.compare(r2, r1); // r2=40, r1=120 → positive
        Test.stopTest();

        System.assert(cmp1 < 0,  'Higher scored reco should come first');
        System.assert(cmp2 > 0,  'Lower scored reco should come second');
    }

    @isTest
    static void testRecoSorter_equalScores() {
        Account a = new Account(Name='Equal Sort Account'); insert a;
        Contact c = new Contact(LastName='Equal', AccountId=a.Id); insert c;
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name, ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];
        ONAModels.ContactNode cn = new ONAModels.ContactNode(c);
        ONAModels.RecommendationResult r1 = new ONAModels.RecommendationResult(cn, 50, 'A');
        ONAModels.RecommendationResult r2 = new ONAModels.RecommendationResult(cn, 50, 'B');

        Test.startTest();
        Integer result = new ONAModels.RecoSorter().compare(r1, r2);
        Test.stopTest();
        System.assertEquals(0, result);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ContactScoreSorter — compare (descending by score)
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testContactScoreSorter() {
        Account a = new Account(Name='Score Sort Account'); insert a;
        Contact c1 = new Contact(LastName='ScoreHigh', AccountId=a.Id); insert c1;
        Contact c2 = new Contact(LastName='ScoreLow',  AccountId=a.Id); insert c2;

        ONAModels.ScoredContact sc1 = new ONAModels.ScoredContact(c1, 90);
        ONAModels.ScoredContact sc2 = new ONAModels.ScoredContact(c2, 30);

        // 'list' is reserved in Apex — use scList
        // List.sort(Comparator) on inner-class types from external test classes
        // must be tested by calling compare() directly and verifying the contract
        ONAModels.ContactScoreSorter sorter = new ONAModels.ContactScoreSorter();

        Test.startTest();
        Integer result = sorter.compare(sc1, sc2); // sc1=90, sc2=30 → negative (sc1 higher)
        Integer result2 = sorter.compare(sc2, sc1); // sc2=30, sc1=90 → positive (sc2 lower)
        Test.stopTest();

        System.assert(result < 0,  'Higher score should sort first (compare returns negative)');
        System.assert(result2 > 0, 'Lower score should sort second (compare returns positive)');
    }

    @isTest
    static void testContactScoreSorter_equalScores() {
        Account a = new Account(Name='Equal CSS Account'); insert a;
        Contact c = new Contact(LastName='SameScore', AccountId=a.Id); insert c;
        ONAModels.ScoredContact sc1 = new ONAModels.ScoredContact(c, 50);
        ONAModels.ScoredContact sc2 = new ONAModels.ScoredContact(c, 50);
        Test.startTest();
        Integer result = new ONAModels.ContactScoreSorter().compare(sc1, sc2);
        Test.stopTest();
        System.assertEquals(0, result);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GraphPayload constructor
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testGraphPayload() {
        Test.startTest();
        ONAModels.GraphPayload p = new ONAModels.GraphPayload();
        Test.stopTest();

        System.assertNotEquals(null, p.nodes);
        System.assertNotEquals(null, p.edges);
        System.assertEquals(0, p.nodes.size());
        System.assertEquals(0, p.edges.size());
    }

    // ══════════════════════════════════════════════════════════════════════════
    // IntroPath, WhitespaceItem, AccountIntelligence, InsightPayload, ActivityItem
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testInnerClassInstantiation() {
        Test.startTest();
        ONAModels.IntroPath ip = new ONAModels.IntroPath();
        ip.hopCount = 2;
        ip.targetName = 'Target';
        ip.pathIds = new List<Id>();
        ip.pathNames = new List<String>{'A','B'};

        ONAModels.WhitespaceItem wi = new ONAModels.WhitespaceItem();
        wi.department = 'Legal';
        wi.engaged = false;
        wi.contactCount = 0;
        wi.activityCount = 0;

        ONAModels.AccountIntelligence ai = new ONAModels.AccountIntelligence();
        ai.coverageScore   = 75;
        ai.coverageBadge   = 'Good';
        ai.multiThreadScore= 82;
        ai.multiThreadBadge= 'Healthy';
        ai.whitespace      = new List<ONAModels.WhitespaceItem>{wi};

        ONAModels.ActivityItem act = new ONAModels.ActivityItem();
        act.id           = 'act-1';
        act.subject      = 'Meeting';
        act.activityType = 'Meeting';
        act.activityDate = '2026-01-15';
        act.relatedTo    = 'Alpha Corp';

        ONAModels.InsightPayload ins = new ONAModels.InsightPayload();
        ins.networkRole      = 'Network Hub';
        ins.recommendations  = new List<ONAModels.RecommendationResult>();
        ins.recentActivity   = new List<ONAModels.ActivityItem>{act};
        ins.introPaths       = new List<ONAModels.IntroPath>{ip};
        Test.stopTest();

        System.assertEquals(2,       ip.hopCount);
        System.assertEquals('Legal', wi.department);
        System.assertEquals(75,      ai.coverageScore);
        System.assertEquals('Meeting', act.activityType);
        System.assertEquals('Network Hub', ins.networkRole);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ContactNode shared maps initialisation
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testContactNodeSharedMaps() {
        Account a = new Account(Name='Map Account'); insert a;
        Contact c = new Contact(LastName='MapTest', AccountId=a.Id); insert c;
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name,
                    ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];

        Test.startTest();
        ONAModels.ContactNode node = new ONAModels.ContactNode(c);
        // Shared maps should be initialised and empty
        node.sharedEmails.put(c.Id, 5);
        node.sharedMeetings.put(c.Id, 3);
        node.sharedTasks.put(c.Id, 2);
        node.sharedOpps.put(c.Id, 1);
        Test.stopTest();

        System.assertEquals(5, node.sharedEmails.get(c.Id));
        System.assertEquals(3, node.sharedMeetings.get(c.Id));
        System.assertEquals(2, node.sharedTasks.get(c.Id));
        System.assertEquals(1, node.sharedOpps.get(c.Id));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Phase 2 fields on ContactNode
    // ══════════════════════════════════════════════════════════════════════════

    @isTest
    static void testContactNodePhase2Fields() {
        Account a = new Account(Name='Phase2 Account'); insert a;
        Contact c = new Contact(LastName='P2', AccountId=a.Id); insert c;
        c = [SELECT Id, Name, Title, Department, Email, AccountId, Account.Name,
                    ReportsToId, MailingCountry FROM Contact WHERE Id=:c.Id];

        Test.startTest();
        ONAModels.ContactNode node = new ONAModels.ContactNode(c);
        node.decayScore        = 65;
        node.velocityRaw       = 0.25;
        node.velocityLabel     = 'Growing';
        node.velocityArrow     = '↑';
        node.betweennessScore  = 42;
        node.emailCount90      = 3;
        node.meetingCount90    = 2;
        node.emailCountPrior   = 1;
        node.meetingCountPrior = 1;
        Test.stopTest();

        System.assertEquals(65,       node.decayScore);
        System.assertEquals(0.25,     node.velocityRaw);
        System.assertEquals('Growing',node.velocityLabel);
        System.assertEquals('↑',      node.velocityArrow);
        System.assertEquals(42,       node.betweennessScore);
        System.assertEquals(3,        node.emailCount90);
    }
}
