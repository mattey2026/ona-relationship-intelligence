public with sharing class AccountRelationshipMapController {

    // ── Scoring constants ─────────────────────────────────────────────────
    private static final Integer DAYS_WINDOW      = 90;
    private static final Integer TASK_PTS         = 8;
    private static final Integer MEETING_PTS      = 10;
    private static final Integer CALL_PTS         = 5;
    private static final Integer EMAIL_PTS        = 2;
    private static final Integer OPP_REL_PTS      = 10;
    private static final Integer ACCT_TEAM_BOOST  = 10;
    private static final Integer CONN_OPP_PTS     = 25;
    private static final Integer CONN_ACT_PTS     = 5;
    private static final Integer CONN_DEPT_PTS    = 15;

    // ─────────────────────────────────────────────────────────────────────
    // 1. GET ACCOUNT CONTACTS
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<ContactWrapper> getAccountContacts(Id accountId) {
        Date cutoff = Date.today().addDays(-DAYS_WINDOW);

        List<Contact> contacts = [
            SELECT Id, Name, Title, Department, Email, Phone,
                   ReportsToId, ReportsTo.Name
            FROM   Contact
            WHERE  AccountId = :accountId
            AND    IsDeleted  = false
            ORDER BY Name ASC
        ];
        Set<Id> contactIds = new Map<Id,Contact>(contacts).keySet();

        // Account team members
        Map<Id,String> teamRoles = new Map<Id,String>();
        Map<Id,String> teamNames = new Map<Id,String>();
        for (AccountTeamMember atm : [
            SELECT UserId, User.Name, TeamMemberRole
            FROM   AccountTeamMember
            WHERE  AccountId = :accountId
        ]) {
            teamRoles.put(atm.UserId, atm.TeamMemberRole);
            teamNames.put(atm.UserId, atm.User.Name);
        }
        Set<Id> teamUserIds = teamRoles.keySet();

        // Completed tasks (90-day window)
        Map<Id,Integer> taskMap = new Map<Id,Integer>();
        for (AggregateResult ar : [
            SELECT WhoId, COUNT(Id) cnt FROM Task
            WHERE  WhoId IN :contactIds AND Status = 'Completed'
            AND    ActivityDate >= :cutoff GROUP BY WhoId
        ]) { taskMap.put((Id)ar.get('WhoId'), (Integer)ar.get('cnt')); }

        // Calls
        Map<Id,Integer> callMap = new Map<Id,Integer>();
        for (AggregateResult ar : [
            SELECT WhoId, COUNT(Id) cnt FROM Task
            WHERE  WhoId IN :contactIds AND TaskSubtype = 'Call'
            AND    ActivityDate >= :cutoff GROUP BY WhoId
        ]) { callMap.put((Id)ar.get('WhoId'), (Integer)ar.get('cnt')); }

        // Emails
        Map<Id,Integer> emailMap = new Map<Id,Integer>();
        for (AggregateResult ar : [
            SELECT WhoId, COUNT(Id) cnt FROM Task
            WHERE  WhoId IN :contactIds AND TaskSubtype = 'Email'
            AND    ActivityDate >= :cutoff GROUP BY WhoId
        ]) { emailMap.put((Id)ar.get('WhoId'), (Integer)ar.get('cnt')); }

        // Meetings — from Event object
        Map<Id,Integer> meetingMap = new Map<Id,Integer>();
        for (AggregateResult ar : [
            SELECT WhoId, COUNT(Id) cnt FROM Event
            WHERE  WhoId IN :contactIds
            AND    ActivityDate >= :cutoff GROUP BY WhoId
        ]) { meetingMap.put((Id)ar.get('WhoId'), (Integer)ar.get('cnt')); }

        // Account team touch
        Set<Id> teamTouched = new Set<Id>();
        Map<Id,String> contactOwnerName = new Map<Id,String>();
        Map<Id,String> contactOwnerRole = new Map<Id,String>();
        if (!teamUserIds.isEmpty()) {
            for (Task t : [
                SELECT WhoId, OwnerId FROM Task
                WHERE  WhoId IN :contactIds AND OwnerId IN :teamUserIds
                AND    ActivityDate >= :cutoff ORDER BY ActivityDate DESC NULLS LAST
            ]) {
                teamTouched.add(t.WhoId);
                if (!contactOwnerName.containsKey(t.WhoId) && teamNames.containsKey(t.OwnerId)) {
                    contactOwnerName.put(t.WhoId, teamNames.get(t.OwnerId));
                    contactOwnerRole.put(t.WhoId, teamRoles.get(t.OwnerId));
                }
            }
            for (Event e : [
                SELECT WhoId, OwnerId FROM Event
                WHERE  WhoId IN :contactIds AND OwnerId IN :teamUserIds
                AND    ActivityDate >= :cutoff ORDER BY ActivityDate DESC NULLS LAST
            ]) {
                teamTouched.add(e.WhoId);
                if (!contactOwnerName.containsKey(e.WhoId) && teamNames.containsKey(e.OwnerId)) {
                    contactOwnerName.put(e.WhoId, teamNames.get(e.OwnerId));
                    contactOwnerRole.put(e.WhoId, teamRoles.get(e.OwnerId));
                }
            }
        }

        // Timeline — tasks + events, last 5 per contact
        Map<Id,List<ActivityWrapper>> timelineMap = new Map<Id,List<ActivityWrapper>>();
        for (Task t : [
            SELECT WhoId, Subject, ActivityDate, TaskSubtype FROM Task
            WHERE  WhoId IN :contactIds AND ActivityDate >= :cutoff
            ORDER BY ActivityDate DESC NULLS LAST LIMIT 500
        ]) {
            if (!timelineMap.containsKey(t.WhoId)) timelineMap.put(t.WhoId, new List<ActivityWrapper>());
            if (timelineMap.get(t.WhoId).size() < 5) {
                String sub = t.TaskSubtype != null ? t.TaskSubtype.toLowerCase() : 'task';
                timelineMap.get(t.WhoId).add(new ActivityWrapper(
                    t.Subject,
                    t.ActivityDate != null ? t.ActivityDate.format() : '',
                    sub
                ));
            }
        }
        for (Event e : [
            SELECT WhoId, Subject, ActivityDate FROM Event
            WHERE  WhoId IN :contactIds AND ActivityDate >= :cutoff
            ORDER BY ActivityDate DESC NULLS LAST LIMIT 500
        ]) {
            if (!timelineMap.containsKey(e.WhoId)) timelineMap.put(e.WhoId, new List<ActivityWrapper>());
            if (timelineMap.get(e.WhoId).size() < 5) {
                timelineMap.get(e.WhoId).add(new ActivityWrapper(
                    e.Subject,
                    e.ActivityDate != null ? e.ActivityDate.format() : '',
                    'meeting'
                ));
            }
        }

        // Opportunities
        Map<Id,List<OpportunityWrapper>> oppMap = new Map<Id,List<OpportunityWrapper>>();
        for (OpportunityContactRole ocr : [
            SELECT ContactId, Opportunity.Name, Opportunity.StageName,
                   Opportunity.Amount, Opportunity.Probability
            FROM   OpportunityContactRole
            WHERE  ContactId IN :contactIds AND Opportunity.IsClosed = false
        ]) {
            if (!oppMap.containsKey(ocr.ContactId)) oppMap.put(ocr.ContactId, new List<OpportunityWrapper>());
            oppMap.get(ocr.ContactId).add(new OpportunityWrapper(
                ocr.Opportunity.Name, ocr.Opportunity.StageName,
                ocr.Opportunity.Amount,
                ocr.Opportunity.Probability != null ? ocr.Opportunity.Probability.intValue() : 0
            ));
        }

        // Build wrappers
        List<ContactWrapper> result = new List<ContactWrapper>();
        for (Contact c : contacts) {
            Integer tasks    = taskMap.containsKey(c.Id)    ? taskMap.get(c.Id)    : 0;
            Integer meetings = meetingMap.containsKey(c.Id) ? meetingMap.get(c.Id) : 0;
            Integer calls    = callMap.containsKey(c.Id)    ? callMap.get(c.Id)    : 0;
            Integer emails   = emailMap.containsKey(c.Id)   ? emailMap.get(c.Id)   : 0;

            Integer score = Math.min(100,
                tasks    * TASK_PTS    +
                meetings * MEETING_PTS +
                calls    * CALL_PTS    +
                emails   * EMAIL_PTS   +
                (teamTouched.contains(c.Id) ? ACCT_TEAM_BOOST : 0)
            );
            Integer relStr = Math.min(100,
                score + (oppMap.containsKey(c.Id) ? oppMap.get(c.Id).size() * OPP_REL_PTS : 0)
            );

            ContactWrapper w          = new ContactWrapper();
            w.Id                      = c.Id;
            w.Name                    = c.Name;
            w.Title                   = c.Title;
            w.Department              = c.Department;
            w.Email                   = c.Email;
            w.Phone                   = c.Phone;
            w.ReportsToId             = c.ReportsToId;
            w.ReportsToName           = c.ReportsTo != null ? c.ReportsTo.Name : null;
            w.engagementScore         = score;
            w.relationshipStrength    = relStr;
            w.taskCount               = tasks;
            w.eventCount              = meetings;
            w.callCount               = calls;
            w.emailCount              = emails;
            w.seniority               = deriveSeniority(c.Title);
            w.roles                   = new List<String>();
            w.timeline                = timelineMap.containsKey(c.Id) ? timelineMap.get(c.Id) : new List<ActivityWrapper>();
            w.opportunities           = oppMap.containsKey(c.Id)      ? oppMap.get(c.Id)      : new List<OpportunityWrapper>();
            w.ownerName               = contactOwnerName.containsKey(c.Id) ? contactOwnerName.get(c.Id) : null;
            w.ownerRole               = contactOwnerRole.containsKey(c.Id) ? contactOwnerRole.get(c.Id) : null;
            w.teamTouched             = teamTouched.contains(c.Id);
            result.add(w);
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. GET ACCOUNT TEAM
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static AccountTeamResult getAccountTeam(Id accountId) {
        AccountTeamResult res = new AccountTeamResult();
        res.members = new List<TeamMemberWrapper>();
        for (AccountTeamMember atm : [
            SELECT UserId, User.Name, User.Title, User.Email,
                   User.SmallPhotoUrl, TeamMemberRole, AccountAccessLevel
            FROM   AccountTeamMember
            WHERE  AccountId = :accountId
            ORDER BY TeamMemberRole ASC
        ]) {
            TeamMemberWrapper w = new TeamMemberWrapper();
            w.userId      = atm.UserId;
            w.userName    = atm.User.Name;
            w.userTitle   = atm.User.Title;
            w.userEmail   = atm.User.Email;
            w.photoUrl    = atm.User.SmallPhotoUrl;
            w.role        = atm.TeamMemberRole;
            w.accessLevel = atm.AccountAccessLevel;
            res.members.add(w);
        }
        res.totalMembers = res.members.size();
        return res;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. GET CONTACT CONNECTIONS
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static ConnectionResult getContactConnections(Id contactId, Id accountId) {
        ConnectionResult result = new ConnectionResult();
        result.connections = new List<ConnectionWrapper>();
        Date cutoff = Date.today().addDays(-DAYS_WINDOW);

        Set<Id> srcOppIds = new Set<Id>();
        Map<Id,Set<String>> contactOppNames = new Map<Id,Set<String>>();
        for (OpportunityContactRole ocr : [
            SELECT OpportunityId, Opportunity.Name FROM OpportunityContactRole
            WHERE  ContactId = :contactId
        ]) { srcOppIds.add(ocr.OpportunityId); }

        if (!srcOppIds.isEmpty()) {
            for (OpportunityContactRole ocr : [
                SELECT ContactId, Opportunity.Name FROM OpportunityContactRole
                WHERE  OpportunityId IN :srcOppIds AND ContactId != :contactId
            ]) {
                if (!contactOppNames.containsKey(ocr.ContactId))
                    contactOppNames.put(ocr.ContactId, new Set<String>());
                contactOppNames.get(ocr.ContactId).add(ocr.Opportunity.Name);
            }
        }

        Map<Id,Integer> sharedActMap = new Map<Id,Integer>();
        Set<Id> taskWhatIds  = new Set<Id>();
        Set<Id> eventWhatIds = new Set<Id>();
        for (Task t : [
            SELECT WhatId FROM Task WHERE WhoId = :contactId
            AND WhatId != null AND ActivityDate >= :cutoff
        ]) { taskWhatIds.add(t.WhatId); }
        for (Event e : [
            SELECT WhatId FROM Event WHERE WhoId = :contactId
            AND WhatId != null AND ActivityDate >= :cutoff
        ]) { eventWhatIds.add(e.WhatId); }

        Set<Id> acctCIds = new Map<Id,Contact>([
            SELECT Id FROM Contact WHERE AccountId = :accountId AND Id != :contactId
        ]).keySet();

        if (!taskWhatIds.isEmpty()) {
            for (Task t : [
                SELECT WhoId FROM Task WHERE WhatId IN :taskWhatIds AND WhoId IN :acctCIds
            ]) {
                sharedActMap.put(t.WhoId, (sharedActMap.containsKey(t.WhoId) ? sharedActMap.get(t.WhoId) : 0) + 1);
            }
        }
        if (!eventWhatIds.isEmpty()) {
            for (Event e : [
                SELECT WhoId FROM Event WHERE WhatId IN :eventWhatIds AND WhoId IN :acctCIds
            ]) {
                sharedActMap.put(e.WhoId, (sharedActMap.containsKey(e.WhoId) ? sharedActMap.get(e.WhoId) : 0) + 1);
            }
        }

        Contact src = [SELECT Department FROM Contact WHERE Id = :contactId LIMIT 1];
        Set<Id> relatedIds = new Set<Id>();
        relatedIds.addAll(contactOppNames.keySet());
        relatedIds.addAll(sharedActMap.keySet());
        if (relatedIds.isEmpty()) { result.totalConnections = 0; return result; }

        for (Contact c : [
            SELECT Id, Name, Title, Department FROM Contact WHERE Id IN :relatedIds
        ]) {
            List<String> oppNames = contactOppNames.containsKey(c.Id)
                ? new List<String>(contactOppNames.get(c.Id)) : new List<String>();
            Integer actCount = sharedActMap.containsKey(c.Id) ? sharedActMap.get(c.Id) : 0;
            Boolean sameDept = src.Department != null && src.Department == c.Department;
            Integer strength = Math.min(100,
                oppNames.size() * CONN_OPP_PTS +
                actCount        * CONN_ACT_PTS  +
                (sameDept       ? CONN_DEPT_PTS : 0)
            );
            ConnectionWrapper conn   = new ConnectionWrapper();
            conn.contactId           = c.Id;
            conn.contactName         = c.Name;
            conn.contactTitle        = c.Title;
            conn.contactDepartment   = c.Department;
            conn.connectionStrength  = strength;
            conn.sharedOpportunities = oppNames;
            conn.sharedActivityCount = actCount;
            conn.sameDepartment      = sameDept;
            conn.connectionReasons   = new List<String>();
            if (!oppNames.isEmpty()) conn.connectionReasons.add('Shared Opportunities');
            if (actCount > 0)        conn.connectionReasons.add('Shared Activities');
            if (sameDept)            conn.connectionReasons.add('Same Department');
            result.connections.add(conn);
        }
        result.connections.sort();
        result.totalConnections = result.connections.size();
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. CREATE CONTACT
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static Id createContact(Map<String,Object> fields) {
        Contact c = new Contact();
        if (fields.containsKey('FirstName'))  c.FirstName  = (String)fields.get('FirstName');
        if (fields.containsKey('LastName'))   c.LastName   = (String)fields.get('LastName');
        if (fields.containsKey('Title'))      c.Title      = (String)fields.get('Title');
        if (fields.containsKey('Department')) c.Department = (String)fields.get('Department');
        if (fields.containsKey('Email'))      c.Email      = (String)fields.get('Email');
        if (fields.containsKey('Phone'))      c.Phone      = (String)fields.get('Phone');
        if (fields.containsKey('AccountId'))  c.AccountId  = (Id)fields.get('AccountId');
        if (fields.containsKey('ReportsToId') && fields.get('ReportsToId') != null
            && String.valueOf(fields.get('ReportsToId')) != '')
            c.ReportsToId = (Id)fields.get('ReportsToId');
        insert c;
        return c.Id;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. SAVE CONTACT ROLES
    // FIX: Buyer_Roles__c removed — roles stored in Description field
    //      as a delimited string so no custom field is required.
    //      Replace Description with your custom field once created.
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static void saveContactRoles(Id contactId, List<String> roles) {
        // Validate allowed role keys to prevent injection
        Set<String> allowed = new Set<String>{'dm','ch','inf','eu','ev'};
        List<String> safe = new List<String>();
        for (String r : roles) {
            if (allowed.contains(r)) safe.add(r);
        }
        // Store as semicolon-delimited value in Description until
        // Buyer_Roles__c custom field is created.
        // To use a real multi-select picklist field, replace the line below:
        //   c.Buyer_Roles__c = String.join(safe, ';');
        Contact c = new Contact(Id = contactId);
        c.Description = 'ARM_ROLES:' + String.join(safe, ';');
        update c;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. SAVE CONTACT ATTRIBUTE
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static void saveContactAttribute(Id contactId, String fieldApiName, String value) {
        Set<String> allowed = new Set<String>{'Title','Department','ReportsToId'};
        if (!allowed.contains(fieldApiName)) {
            throw new AuraHandledException('Field not allowed: ' + fieldApiName);
        }
        Contact c = new Contact(Id = contactId);
        if (fieldApiName == 'ReportsToId') {
            c.ReportsToId = (value != null && value != '') ? (Id)value : null;
        } else if (fieldApiName == 'Title') {
            c.Title = value;
        } else if (fieldApiName == 'Department') {
            c.Department = value;
        }
        update c;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. GET REQUIRED FIELDS (dynamic Create Contact modal)
    // FIX: Inner class PicklistEntry moved OUT of RequiredFieldWrapper
    //      to avoid "Inner types are not allowed to have inner types" error.
    //      PicklistOption is now a top-level inner class of the controller.
    // ─────────────────────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<RequiredFieldWrapper> getContactRequiredFields() {
        List<RequiredFieldWrapper> result = new List<RequiredFieldWrapper>();
        Set<String> builtIn = new Set<String>{
            'lastname','firstname','accountid','title',
            'department','email','phone','reportstoid'
        };
        Map<String,Schema.SObjectField> fieldMap = Schema.SObjectType.Contact.fields.getMap();
        for (String apiName : fieldMap.keySet()) {
            Schema.DescribeFieldResult f = fieldMap.get(apiName).getDescribe();
            if (!f.isNillable() && !f.isDefaultedOnCreate()
                && f.isAccessible() && f.isCreateable()
                && !builtIn.contains(apiName.toLowerCase())) {

                RequiredFieldWrapper w = new RequiredFieldWrapper();
                w.apiName   = apiName;
                w.label     = f.getLabel();
                w.fieldType = String.valueOf(f.getType());
                w.maxLength = f.getLength();

                // FIX: Use PicklistOption (top-level inner class) instead of
                //      RequiredFieldWrapper.PicklistEntry (nested inner class)
                List<PicklistOption> opts = new List<PicklistOption>();
                if (f.getType() == Schema.DisplayType.PICKLIST ||
                    f.getType() == Schema.DisplayType.MULTIPICKLIST) {
                    for (Schema.PicklistEntry pe : f.getPicklistValues()) {
                        if (pe.isActive()) {
                            PicklistOption opt = new PicklistOption();
                            opt.value = pe.getValue();
                            opt.label = pe.getLabel();
                            opts.add(opt);
                        }
                    }
                }
                w.picklistOptions = opts;
                result.add(w);
            }
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────
    private static String deriveSeniority(String title) {
        if (title == null) return 'Individual';
        String t = title.toLowerCase();
        if (t.contains('chief') || t.contains('ceo') || t.contains('cto') ||
            t.contains('cfo')   || t.contains('coo') || t.contains('cro') ||
            t.contains('president')) return 'C-Suite';
        if (t.contains('vp') || t.contains('vice president')) return 'VP Level';
        if (t.contains('director'))                            return 'Director';
        if (t.contains('manager') || t.contains('lead'))      return 'Manager';
        return 'Individual';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Wrapper classes
    // ─────────────────────────────────────────────────────────────────────
    public class ContactWrapper {
        @AuraEnabled public Id      Id;
        @AuraEnabled public String  Name;
        @AuraEnabled public String  Title;
        @AuraEnabled public String  Department;
        @AuraEnabled public String  Email;
        @AuraEnabled public String  Phone;
        @AuraEnabled public Id      ReportsToId;
        @AuraEnabled public String  ReportsToName;
        @AuraEnabled public Integer engagementScore;
        @AuraEnabled public Integer relationshipStrength;
        @AuraEnabled public Integer taskCount;
        @AuraEnabled public Integer eventCount;
        @AuraEnabled public Integer callCount;
        @AuraEnabled public Integer emailCount;
        @AuraEnabled public String  seniority;
        @AuraEnabled public List<String>             roles;
        @AuraEnabled public List<ActivityWrapper>    timeline;
        @AuraEnabled public List<OpportunityWrapper> opportunities;
        @AuraEnabled public String  ownerName;
        @AuraEnabled public String  ownerRole;
        @AuraEnabled public Boolean teamTouched;
    }

    public class ActivityWrapper {
        @AuraEnabled public String subject;
        @AuraEnabled public String activityDate;
        @AuraEnabled public String subtype;
        public ActivityWrapper(String s, String d, String t) {
            subject = s; activityDate = d; subtype = t;
        }
    }

    public class OpportunityWrapper {
        @AuraEnabled public String  name;
        @AuraEnabled public String  stageName;
        @AuraEnabled public Decimal amount;
        @AuraEnabled public Integer probability;
        public OpportunityWrapper(String n, String s, Decimal a, Integer p) {
            name = n; stageName = s; amount = a; probability = p;
        }
    }

    public class AccountTeamResult {
        @AuraEnabled public List<TeamMemberWrapper> members;
        @AuraEnabled public Integer totalMembers;
    }

    public class TeamMemberWrapper {
        @AuraEnabled public Id     userId;
        @AuraEnabled public String userName;
        @AuraEnabled public String userTitle;
        @AuraEnabled public String userEmail;
        @AuraEnabled public String photoUrl;
        @AuraEnabled public String role;
        @AuraEnabled public String accessLevel;
    }

    public class ConnectionResult {
        @AuraEnabled public List<ConnectionWrapper> connections;
        @AuraEnabled public Integer totalConnections;
    }

    public class ConnectionWrapper implements Comparable {
        @AuraEnabled public Id      contactId;
        @AuraEnabled public String  contactName;
        @AuraEnabled public String  contactTitle;
        @AuraEnabled public String  contactDepartment;
        @AuraEnabled public Integer connectionStrength;
        @AuraEnabled public List<String> sharedOpportunities;
        @AuraEnabled public Integer sharedActivityCount;
        @AuraEnabled public Boolean sameDepartment;
        @AuraEnabled public List<String> connectionReasons;
        public Integer compareTo(Object other) {
            return ((ConnectionWrapper)other).connectionStrength - this.connectionStrength;
        }
    }

    public class RequiredFieldWrapper {
        @AuraEnabled public String  apiName;
        @AuraEnabled public String  label;
        @AuraEnabled public String  fieldType;
        @AuraEnabled public Integer maxLength;
        // FIX: uses PicklistOption (top-level) instead of nested inner class
        @AuraEnabled public List<PicklistOption> picklistOptions;
    }

    // FIX: Promoted from nested inner class to top-level inner class.
    // Apex does not allow inner classes to have their own inner classes.
    // AuraEnabled fields also do not support Schema.PicklistEntry directly.
    public class PicklistOption {
        @AuraEnabled public String value;
        @AuraEnabled public String label;
    }
}