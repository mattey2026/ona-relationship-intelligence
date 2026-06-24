trigger ONAHandoverTrigger on Opportunity (after update) {
    for (Opportunity opp : Trigger.new) {
        Opportunity old = Trigger.oldMap.get(opp.Id);
        if (opp.OwnerId != old.OwnerId && opp.AccountId != null) {
            ONAHandoverTriggerHelper.enqueueHandover(
                opp.Id, opp.AccountId,
                opp.OwnerId, old.OwnerId,
                opp.Name, opp.Amount
            );
            break;
        }
    }
}