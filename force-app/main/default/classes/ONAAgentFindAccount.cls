/**
 * ONAAgentFindAccount.cls
 * ─────────────────────────────────────────────────────────────────────
 * Agentforce action: resolves an account NAME (full or partial) to its
 * Salesforce Account ID so downstream ONA actions (which require an ID)
 * can be called when the user only mentions the account by name.
 *
 * Author : Sumit Mattey — Genpact Salesforce Practice
 * Version: 1.0
 * ─────────────────────────────────────────────────────────────────────
 */
public with sharing class ONAAgentFindAccount {

    public class Input {
        @InvocableVariable(label='Account Name' required=true
            description='Full or partial account name mentioned by the user')
        public String accountName;
    }

    public class Output {
        @InvocableVariable(label='Agent Response'
            description='The matched Account ID and name, or a list of close matches to disambiguate')
        public String response;
    }

    @InvocableMethod(
        label='Find Account ID by Name'
        description='Resolves an account name to its Salesforce Account ID. Always call this first when the user mentions an account by name and you do not already have its Account ID from record context.'
        category='ONA Relationship Intelligence')
    public static List<Output> run(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            Output o = new Output();
            try {
                o.response = resolve(inp.accountName);
            } catch (Exception e) {
                o.response = 'Account search failed: ' + e.getMessage();
            }
            results.add(o);
        }
        return results;
    }

    private static String resolve(String name) {
        if (String.isBlank(name)) return 'No account name provided.';
        String term = '%' + name.trim() + '%';
        List<Account> accs = [
            SELECT Id, Name, Industry
            FROM   Account
            WHERE  Name LIKE :term AND IsDeleted = false
            ORDER  BY Name
            LIMIT  5
        ];
        if (accs.isEmpty())
            return 'No account found matching "' + name + '". Ask the user to confirm the account name.';
        if (accs.size() == 1)
            return 'Account ID: ' + accs[0].Id + ' — ' + accs[0].Name +
                   '. Use this Account ID for ONA actions.';
        String msg = 'Multiple accounts match "' + name + '":';
        for (Account a : accs)
            msg += '\n- ' + a.Name + ' (Account ID: ' + a.Id + ')';
        msg += '\nIf one clearly matches the user\'s wording, use its Account ID; otherwise ask the user which account they mean.';
        return msg;
    }
}
