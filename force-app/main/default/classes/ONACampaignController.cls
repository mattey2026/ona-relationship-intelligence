/**
 * ============================================================
 * ONA Relationship Intelligence — ONACampaignController.cls
 * ============================================================
 * Author      : Sumit Mattey
 * Organisation: Genpact — Salesforce Practice
 * GitHub      : https://github.com/mattey2026/ona-relationship-intelligence
 * Created     : 19 June 2026
 * Version     : 1.0
 * ------------------------------------------------------------
 * Apex controller for the ONA Campaign Creator (Analytics tab).
 * Three @AuraEnabled methods:
 *   getRecentCampaigns()       — 20 most recent Campaigns for the
 *                                 "use existing" dropdown
 *   createCampaign(...)        — creates a new Campaign inline
 *   addContactsToCampaign(...) — inserts CampaignMember records,
 *                                 skips duplicates gracefully,
 *                                 returns a toast-ready summary
 * ============================================================
 */
public with sharing class ONACampaignController {

    @AuraEnabled(cacheable=false)
    public static List<Campaign> getRecentCampaigns() {
        return [
            SELECT Id, Name, Type, Status, StartDate, EndDate
            FROM   Campaign
            WHERE  IsDeleted = false
            ORDER  BY LastModifiedDate DESC
            LIMIT  20
        ];
    }

    @AuraEnabled
    public static String createCampaign(
        String campName,
        String campType,
        String campStatus,
        Date   startDate,
        Date   endDate
    ) {
        if (String.isBlank(campName)) throw new AuraHandledException('Campaign name is required.');
        Campaign c  = new Campaign();
        c.Name      = campName.trim();
        c.Type      = String.isNotBlank(campType)   ? campType   : 'Other';
        c.Status    = String.isNotBlank(campStatus) ? campStatus : 'Planning';
        c.StartDate = startDate;
        c.EndDate   = endDate;
        c.IsActive  = true;
        insert c;
        return c.Id;
    }

    @AuraEnabled
    public static String addContactsToCampaign(
        String campaignId,
        String contactIdsJson,
        String memberStatus
    ) {
        if (String.isBlank(campaignId))    throw new AuraHandledException('Campaign ID is required.');
        if (String.isBlank(contactIdsJson)) throw new AuraHandledException('No contacts selected.');

        List<Object> rawIds = (List<Object>) JSON.deserializeUntyped(contactIdsJson);
        List<Id> contactIds = new List<Id>();
        for (Object o : rawIds) contactIds.add((Id) String.valueOf(o));
        if (contactIds.isEmpty()) throw new AuraHandledException('No contacts selected.');

        String status = String.isNotBlank(memberStatus) ? memberStatus : 'Sent';

        Set<Id> existing = new Set<Id>();
        for (CampaignMember cm : [
            SELECT ContactId FROM CampaignMember
            WHERE  CampaignId = :campaignId AND ContactId IN :contactIds
        ]) existing.add(cm.ContactId);

        List<CampaignMember> toInsert = new List<CampaignMember>();
        for (Id cId : contactIds) {
            if (!existing.contains(cId)) {
                CampaignMember cm = new CampaignMember();
                cm.CampaignId = campaignId;
                cm.ContactId  = cId;
                cm.Status     = status;
                toInsert.add(cm);
            }
        }

        if (toInsert.isEmpty()) {
            Integer sk = existing.size();
            return sk + ' contact' + (sk==1?'':'s') + ' already member' + (sk==1?'':'s') + ' — nothing added.';
        }

        insert toInsert;
        String added = String.valueOf(toInsert.size());
        String skip  = existing.isEmpty() ? '' : ' (' + existing.size() + ' already member' + (existing.size()>1?'s':'')+', skipped)';
        return added + ' contact' + (toInsert.size()==1?'':'s') + ' added' + skip + '.';
    }
}