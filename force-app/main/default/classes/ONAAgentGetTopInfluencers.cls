/**
 * ============================================================
 * ONAAgentGetTopInfluencers.cls
 * ============================================================
 * Author      : Sumit Mattey — Genpact Salesforce Practice
 * Module      : ONA Relationship Intelligence — Agentforce Layer
 * Used by     : Subagent "Contact Prioritisation Insights"
 * ------------------------------------------------------------
 * Purpose:
 *   Agentforce invocable action that ranks an account's contacts
 *   by influence (seniority + activity volume) and returns a
 *   shortlist with each contact's engagement status — so a
 *   seller knows exactly who to prioritise / call first.
 *
 *   All ranking logic lives in
 *   ONAAgentUtils.formatTopInfluencers(). This class only handles
 *   the Agentforce input/output contract, the optional result-
 *   limit parameter, and error formatting.
 *
 * Agent wiring:
 *   - Reference Action Type     : Apex
 *   - Reference Action Category : Invocable Method
 *   - Attached to subagent      : Contact Prioritisation Insights
 *   - Chained after             : ONAAgentFindAccount (resolver),
 *                                  when the user supplies an
 *                                  account NAME instead of an ID
 * ============================================================
 */
public with sharing class ONAAgentGetTopInfluencers {

    /**
     * Input wrapper.
     *   accountId   — required, the account to rank contacts for.
     *   maxContacts — optional. If the agent/user doesn't specify
     *                 a number (e.g. "top 3 contacts"), this is
     *                 left null and defaults to 5 (see below).
     */
    public class Input {
        @InvocableVariable(label='Account ID' required=true
            description='Salesforce Account record ID')
        public Id accountId;

        @InvocableVariable(label='Max Contacts' required=false
            description='Number of contacts to return (default 5)')
        public Integer maxContacts;
    }

    /**
     * Output wrapper — ranked list as pre-formatted text, each
     * entry showing name, title and engagement status icon
     * (Active / Cooling / Never contacted).
     */
    public class Output {
        @InvocableVariable(label='Agent Response')
        public String response;
    }

    /**
     * Entry point invoked by Agentforce.
     *
     * maxContacts handling:
     *   - null or <= 0  → default to 5
     *   - any value     → capped at 10 to keep the response
     *                     scannable and within token limits
     */
    @InvocableMethod(
        label='Get ONA Top Contacts by Influence'
        description='Returns top contacts ranked by seniority and activity level with engagement status. Use when seller asks who to prioritise or who are the key stakeholders.'
        category='ONA Relationship Intelligence')
    public static List<Output> run(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            Output out = new Output();
            try {
                // Resolve the limit: default 5, hard cap 10.
                // The cap prevents the agent from being asked
                // for "top 50" and dumping the entire contact list.
                Integer lim = (inp.maxContacts != null && inp.maxContacts > 0)
                    ? Math.min(inp.maxContacts, 10)
                    : 5;

                // Delegate to shared utils — see
                // ONAAgentUtils.formatTopInfluencers() for the
                // influenceRank() formula and status-icon logic.
                out.response = ONAAgentUtils.formatTopInfluencers(inp.accountId, lim);
            } catch (Exception e) {
                out.response = 'Unable to load contact data: ' + e.getMessage();
            }
            results.add(out);
        }
        return results;
    }
}
