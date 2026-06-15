/**
 * ============================================================
 * ONAAgentGetPreMeetingBrief.cls
 * ============================================================
 * Author      : Sumit Mattey — Genpact Salesforce Practice
 * Module      : ONA Relationship Intelligence — Agentforce Layer
 * Used by     : Subagent "Pre-Meeting Briefing Generation"
 * ------------------------------------------------------------
 * Purpose:
 *   Agentforce invocable action that generates a concise
 *   pre-meeting briefing for an account: the top 3 contacts by
 *   influence, each with their engagement status and a
 *   recommended opening approach, plus tactical nudges for
 *   contacts who have gone cold.
 *
 *   All ranking/formatting logic lives in
 *   ONAAgentUtils.formatPreMeetingBrief(). This class only
 *   handles the Agentforce input/output contract, the optional
 *   meeting-context parameter, and error formatting.
 *
 * Agent wiring:
 *   - Reference Action Type     : Apex
 *   - Reference Action Category : Invocable Method
 *   - Attached to subagent      : Pre-Meeting Briefing Generation
 *   - Chained after             : ONAAgentFindAccount (resolver),
 *                                  when the user supplies an
 *                                  account NAME instead of an ID
 * ============================================================
 */
public with sharing class ONAAgentGetPreMeetingBrief {

    /**
     * Input wrapper.
     *   accountId      — required, the account being briefed for.
     *   meetingContext — optional free-text context the user gave
     *                    (e.g. "Q3 renewal discussion", "QBR").
     *                    If blank, defaults to "General meeting"
     *                    so the brief header is never empty.
     */
    public class Input {
        @InvocableVariable(label='Account ID' required=true
            description='Salesforce Account record ID')
        public Id accountId;

        @InvocableVariable(label='Meeting Context' required=false
            description='Optional context e.g. Q3 renewal discussion')
        public String meetingContext;
    }

    /**
     * Output wrapper — pre-formatted brief text: header with the
     * meeting context, top-3 key contacts with status, and a
     * "tactical nudges" section for cold contacts.
     */
    public class Output {
        @InvocableVariable(label='Agent Response')
        public String response;
    }

    /**
     * Entry point invoked by Agentforce.
     *
     * meetingContext handling: blank/null input is normalised to
     * "General meeting" before being passed down, so
     * formatPreMeetingBrief() never has to null-check it.
     */
    @InvocableMethod(
        label='Get ONA Pre-Meeting Relationship Brief'
        description='Generates a concise pre-meeting briefing — top contacts, their engagement status, what to open with and tactical nudges. Use before any meeting or call.'
        category='ONA Relationship Intelligence')
    public static List<Output> run(List<Input> inputs) {
        List<Output> results = new List<Output>();
        for (Input inp : inputs) {
            Output out = new Output();
            try {
                // Default the context label so the brief header
                // never reads "PRE-MEETING BRIEF —  " (blank).
                String ctx = String.isBlank(inp.meetingContext)
                    ? 'General meeting'
                    : inp.meetingContext;

                // Delegate to shared utils — see
                // ONAAgentUtils.formatPreMeetingBrief() for the
                // top-3 ranking and tactical-nudge generation.
                out.response = ONAAgentUtils.formatPreMeetingBrief(inp.accountId, ctx);
            } catch (Exception e) {
                out.response = 'Unable to generate meeting brief: ' + e.getMessage();
            }
            results.add(out);
        }
        return results;
    }
}