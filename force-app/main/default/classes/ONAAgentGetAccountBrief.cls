/**
 * ============================================================
 * ONAAgentGetAccountBrief.cls
 * ============================================================
 * Author      : Sumit Mattey — Genpact Salesforce Practice
 * Module      : ONA Relationship Intelligence — Agentforce Layer
 * Used by     : Subagent "Account Network Health Analytics"
 * ------------------------------------------------------------
 * Purpose:
 *   Agentforce invocable action that produces a plain-English
 *   relationship health summary for an Account — contact count,
 *   department coverage, Active/Cooling/Dark contact split, the
 *   top influencer, and recommended next actions.
 *
 *   All scoring logic lives in ONAAgentUtils.formatAccountBrief().
 *   This class is intentionally a thin wrapper: it only handles
 *   the Agentforce input/output contract and error formatting.
 *
 * Agent wiring:
 *   - Reference Action Type     : Apex
 *   - Reference Action Category : Invocable Method
 *   - Attached to subagent      : Account Network Health Analytics
 *   - Chained after             : ONAAgentFindAccount (resolver),
 *                                  when the user supplies an
 *                                  account NAME instead of an ID
 * ============================================================
 */
public with sharing class ONAAgentGetAccountBrief {

    /**
     * Input wrapper — single field expected from the agent.
     * The agent either takes this from record-page context
     * (when the user is on an Account page) or from the output
     * of ONAAgentFindAccount (when the user named the account).
     */
    public class Input {
        @InvocableVariable(label='Account ID' required=true
            description='Salesforce Account record ID')
        public Id accountId;
    }

    /**
     * Output wrapper — single text field the agent reads back
     * to the user. The text is pre-formatted (line breaks,
     * bullet markers) so the agent can present it directly.
     */
    public class Output {
        @InvocableVariable(label='Agent Response')
        public String response;
    }

    /**
     * Entry point invoked by Agentforce.
     * Iterates the input list (Agentforce typically sends one
     * element per call, but the invocable contract is bulk-safe).
     *
     * Error handling: any exception from ONAAgentUtils is caught
     * and returned as readable text in the response field — this
     * avoids surfacing a raw Apex stack trace to the end user in
     * the conversation, while the underlying message ("Unable to
     * load account data: ...") still gives enough detail for
     * debugging via the agent-user debug logs.
     */
    @InvocableMethod(
        label='Get ONA Account Relationship Brief'
        description='Returns relationship health summary for an account — contact count, activity health, warm vs cold contacts, whitespace gaps and recommended actions.'
        category='ONA Relationship Intelligence')
    public static List<Output> run(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            Output out = new Output();
            try {
                // Delegate all computation to the shared utils class —
                // see ONAAgentUtils.formatAccountBrief() for the
                // Active/Cooling/Dark bucketing and influence ranking logic.
                out.response = ONAAgentUtils.formatAccountBrief(inp.accountId);
            } catch (Exception e) {
                // Handled failure — agent relays this text instead of erroring out
                out.response = 'Unable to load account data: ' + e.getMessage();
            }
            results.add(out);
        }
        return results;
    }
}
