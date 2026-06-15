/**
 * ============================================================
 * ONAAgentGetWarmIntroPath.cls
 * ============================================================
 * Author      : Sumit Mattey — Genpact Salesforce Practice
 * Module      : ONA Relationship Intelligence — Agentforce Layer
 * Used by     : Subagent "Warm Intro Path Discovery"
 * ------------------------------------------------------------
 * Purpose:
 *   Agentforce invocable action that finds the best 2-hop warm
 *   introduction route to a named target contact — i.e. which
 *   *other* contact at the account is the seller's best bridge
 *   to reach someone they don't yet have a relationship with —
 *   plus a ready-to-use "ask" script for that bridge contact.
 *
 *   All path-finding logic lives in
 *   ONAAgentUtils.formatIntroPath(). This class only handles
 *   the Agentforce input/output contract and error formatting.
 *
 * Agent wiring:
 *   - Reference Action Type     : Apex
 *   - Reference Action Category : Invocable Method
 *   - Attached to subagent      : Warm Intro Path Discovery
 *   - Chained after             : ONAAgentFindAccount (resolver),
 *                                  when the user supplies an
 *                                  account NAME instead of an ID.
 *                                  NOTE: targetContactId still
 *                                  needs to be a real Contact ID
 *                                  — the agent resolves the
 *                                  target person's name to an ID
 *                                  via record context / prior
 *                                  conversation turns before
 *                                  calling this action.
 * ============================================================
 */
public with sharing class ONAAgentGetWarmIntroPath {

    /**
     * Input wrapper.
     *   accountId       — the account whose network to search.
     *   targetContactId — the contact the seller wants an
     *                     introduction to. Required — without a
     *                     target there is nothing to path-find to.
     */
    public class Input {
        @InvocableVariable(label='Account ID' required=true
            description='Salesforce Account record ID')
        public Id accountId;

        @InvocableVariable(label='Target Contact ID' required=true
            description='Contact ID you want to be introduced to')
        public Id targetContactId;
    }

    /**
     * Output wrapper — pre-formatted intro path text:
     *   target's name + title + last-contact status,
     *   the recommended bridge contact (2-hop path),
     *   and a suggested message to send the bridge contact.
     * If no active bridge exists, returns a LinkedIn fallback
     * suggestion instead.
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
        label='Get ONA Warm Introduction Path to Contact'
        description='Returns the best introduction chain to reach a specific contact through the account network. Shows each step and what to say. Use when seller wants to reach an unconnected contact.'
        category='ONA Relationship Intelligence')
    public static List<Output> run(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            Output out = new Output();
            try {
                // Delegate to shared utils — see
                // ONAAgentUtils.formatIntroPath() for the bridge-
                // selection logic (highest-influence ACTIVE
                // contact other than the target) and the
                // suggested-ask script generation.
                out.response = ONAAgentUtils.formatIntroPath(inp.accountId, inp.targetContactId);
            } catch (Exception e) {
                out.response = 'Unable to compute introduction path: ' + e.getMessage();
            }
            results.add(out);
        }
        return results;
    }
}