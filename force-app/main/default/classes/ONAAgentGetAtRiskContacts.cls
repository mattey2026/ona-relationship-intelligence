/**
 * ============================================================
 * ONAAgentGetAtRiskContacts.cls
 * ============================================================
 * Author      : Sumit Mattey — Genpact Salesforce Practice
 * Module      : ONA Relationship Intelligence — Agentforce Layer
 * Used by     : Subagent "At-Risk Relationship Detection"
 * ------------------------------------------------------------
 * Purpose:
 *   Agentforce invocable action that identifies contacts whose
 *   engagement is decaying — grouped into COLD (>60 days),
 *   COOLING (31-60 days) and DARK (never contacted) — plus a
 *   single-point-of-failure (SPOF) warning naming the top-ranked
 *   contact at the account.
 *
 *   All grouping/ranking logic lives in
 *   ONAAgentUtils.formatAtRiskContacts(). This class only handles
 *   the Agentforce input/output contract and error formatting.
 *
 * Agent wiring:
 *   - Reference Action Type     : Apex
 *   - Reference Action Category : Invocable Method
 *   - Attached to subagent      : At-Risk Relationship Detection
 *   - Chained after             : ONAAgentFindAccount (resolver),
 *                                  when the user supplies an
 *                                  account NAME instead of an ID
 * ============================================================
 */
public with sharing class ONAAgentGetAtRiskContacts {

    /**
     * Input wrapper — single field expected from the agent.
     */
    public class Input {
        @InvocableVariable(label='Account ID' required=true
            description='Salesforce Account record ID')
        public Id accountId;
    }

    /**
     * Output wrapper — pre-formatted risk report text.
     * Sections (in order): SPOF warning, COLD, COOLING, DARK,
     * or a clean "no risk detected" message if none apply.
     */
    public class Output {
        @InvocableVariable(label='Agent Response')
        public String response;
    }

    /**
     * Entry point invoked by Agentforce.
     * See ONAAgentGetAccountBrief.run() for the bulk-safety and
     * error-handling pattern — identical here.
     */
    @InvocableMethod(
        label='Get ONA At-Risk and Cooling Contacts'
        description='Returns contacts with no recent activity, cooling relationships and dark contacts with zero history. Use when seller asks about risks, cold contacts or renewal vulnerabilities.'
        category='ONA Relationship Intelligence')
    public static List<Output> run(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            Output out = new Output();
            try {
                // Delegate to shared utils — see
                // ONAAgentUtils.formatAtRiskContacts() for the
                // COLD/COOLING/DARK threshold logic and the
                // single-point-of-failure detection.
                out.response = ONAAgentUtils.formatAtRiskContacts(inp.accountId);
            } catch (Exception e) {
                out.response = 'Unable to load risk data: ' + e.getMessage();
            }
            results.add(out);
        }
        return results;
    }
}