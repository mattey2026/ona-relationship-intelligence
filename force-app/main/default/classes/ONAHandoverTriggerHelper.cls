/**
 * ONAHandoverTriggerHelper.cls
 * Sends the Relationship Handover email + creates a Task when an
 * Opportunity is reassigned to a new rep.
 */
public with sharing class ONAHandoverTriggerHelper {

    public static void enqueueHandover(
        Id oppId, Id accountId,
        Id newOwnerId, Id oldOwnerId,
        String oppName, Decimal amount
    ) {
        sendHandoverAsync(oppId, accountId, newOwnerId, oldOwnerId, oppName, amount != null ? amount : 0);
    }

    @future
    private static void sendHandoverAsync(
        Id oppId, Id accountId,
        Id newOwnerId, Id oldOwnerId,
        String oppName, Decimal amount
    ) {
        try {
            // Get owner details
            Map<Id,User> users = new Map<Id,User>([
                SELECT Id, Name, Email FROM User
                WHERE  Id IN :new Set<Id>{ newOwnerId, oldOwnerId }
            ]);
            User newOwner = users.get(newOwnerId);
            User oldOwner = users.get(oldOwnerId);
            if (newOwner == null) return;

            // Get top contacts for this account
            List<Contact> contacts = [
                SELECT Id, Name, Title, Department,
                       (SELECT ActivityDate FROM ActivityHistories
                        ORDER BY ActivityDate DESC LIMIT 1)
                FROM   Contact
                WHERE  AccountId = :accountId
                ORDER  BY Name
                LIMIT  20
            ];
            if (contacts.isEmpty()) return;

            // Get account name
            List<Account> accts = [SELECT Name FROM Account WHERE Id = :accountId LIMIT 1];
            String acctName = accts.isEmpty() ? oppName : accts[0].Name;

            // Build email
            String fromName  = oldOwner != null ? oldOwner.Name : 'Previous rep';
            String emailBody = buildEmail(contacts, acctName, oppName, amount, fromName, newOwner.Name);

            // Send email
            Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
            mail.setToAddresses(new List<String>{ newOwner.Email });
            mail.setSubject('Account handover — ' + oppName + ' · £' + String.valueOf(amount.longValue()));
            mail.setHtmlBody(emailBody);
            mail.setSaveAsActivity(false);
            Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ mail });

            // Create Task
            Task t         = new Task();
            t.WhatId       = oppId;
            t.OwnerId      = newOwnerId;
            t.Subject      = 'Review ONA Handover Pack — ' + oppName;
            t.Description  = 'Handover pack sent to ' + newOwner.Email
                           + '. Open ONA Relationship Intelligence on the Account record to load the live graph and download the full PDF.';
            t.Status       = 'Not Started';
            t.Priority     = 'High';
            t.ActivityDate = Date.today().addDays(3);
            insert t;

        } catch (Exception e) {
            System.debug('[ONA Handover] Error: ' + e.getMessage());
        }
    }

    private static String buildEmail(
        List<Contact> contacts, String acctName,
        String oppName, Decimal amount,
        String fromRep, String toRep
    ) {
        String html = '<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#1A1F2E;max-width:640px;">';
        html += '<div style="background:#1B3560;padding:14px 20px;border-radius:6px 6px 0 0;">';
        html += '<h2 style="color:#fff;font-size:16px;margin:0;">ONA Relationship Handover Pack</h2>';
        html += '<p style="color:rgba(255,255,255,.6);font-size:11px;margin:4px 0 0;">' + oppName + ' · From ' + fromRep + ' to ' + toRep + '</p>';
        html += '</div><div style="border:1px solid #E2DDD6;border-top:none;padding:16px 20px;">';

        // Stats row
        html += '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">';
        html += '<tr>';
        html += kpi('Account',   acctName);
        html += kpi('Pipeline',  '£' + String.valueOf(amount.longValue()));
        html += kpi('Contacts',  String.valueOf(contacts.size()));
        html += '</tr></table>';

        // Contact table
        html += '<h3 style="font-size:12px;color:#1B3560;margin:0 0 8px;">Key Contacts</h3>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:14px;">';
        html += '<tr style="background:#1B3560;"><th style="padding:5px 8px;text-align:left;color:rgba(255,255,255,.7);">Name</th>';
        html += '<th style="padding:5px 8px;text-align:left;color:rgba(255,255,255,.7);">Title</th>';
        html += '<th style="padding:5px 8px;text-align:left;color:rgba(255,255,255,.7);">Last Contact</th></tr>';
        Integer cnt = 0;
        for (Contact c : contacts) {
            if (cnt++ > 7) break;
            Date last = (c.ActivityHistories != null && !c.ActivityHistories.isEmpty())
                ? c.ActivityHistories[0].ActivityDate : null;
            Integer days = last != null ? last.daysBetween(Date.today()) : 9999;
            String lastStr = days >= 9999 ? 'Never' : (days < 30 ? days + 'd ago' : (days/7) + 'w ago');
            String bg = days > 60 || days >= 9999 ? '#FFF8F0' : '#fff';
            html += '<tr style="background:' + bg + ';border-bottom:1px solid #E2DDD6;">';
            html += '<td style="padding:5px 8px;font-weight:bold;">' + c.Name + '</td>';
            html += '<td style="padding:5px 8px;color:#64778C;">' + (c.Title != null ? c.Title : '—') + '</td>';
            html += '<td style="padding:5px 8px;color:' + (days > 60 ? '#9E4610' : '#1A6840') + ';">' + lastStr + '</td></tr>';
        }
        html += '</table>';
        html += '<div style="background:#E6EEF8;padding:10px 14px;border-radius:4px;font-size:11.5px;">';
        html += '<b style="color:#1A4A96;">To view the full Handover Pack:</b><br/>';
        html += '1. Open the Account record → ONA Relationship Intelligence component<br/>';
        html += '2. Click the Bell icon → Download PDF';
        html += '</div></div></body></html>';
        return html;
    }

    private static String kpi(String lbl, String val) {
        return '<td style="padding:8px;background:#F7F5F1;border-radius:4px;text-align:center;width:33%;">'
             + '<div style="font-size:9px;color:#64778C;">' + lbl + '</div>'
             + '<div style="font-size:14px;font-weight:bold;color:#1B3560;">' + val + '</div>'
             + '</td>';
    }
}