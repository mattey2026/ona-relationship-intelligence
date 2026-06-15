/**
 * ============================================================
 * ONAAgentUtils.cls — v1.3
 * ============================================================
 * Author      : Sumit Mattey — Genpact Salesforce Practice
 * Module      : ONA Relationship Intelligence — Agentforce Layer
 * ------------------------------------------------------------
 * Purpose:
 *   Shared scoring + text-formatting engine for all 5 ONA
 *   Agentforce actions (Account Brief, At-Risk, Top Influencers,
 *   Warm Intro Path, Pre-Meeting Brief). Each action class is a
 *   thin wrapper — ALL business logic and output formatting
 *   lives here so the five subagents stay consistent.
 *
 * Design notes:
 *   - "without sharing": the agent runs as the EinsteinServiceAgent
 *     user, which owns no records. Activity (Task/Event) sharing
 *     defaults to private, so "with sharing" would make every
 *     contact look "never contacted". This class only ever returns
 *     aggregate TEXT summaries (names, counts, status labels) —
 *     never raw record data — so the sharing bypass is scoped and safe.
 *   - Methods here intentionally use a SIMPLER scoring model than
 *     ONAController (the full graph engine): roleWeight() uses
 *     basic contains-matching rather than the full seniority
 *     taxonomy, and there is no edge/cluster graph — just per-
 *     contact activity counts. This keeps agent responses fast
 *     (no graph build) and easy to read in a chat window.
 *
 * v1.3 CHANGES vs v1.2:
 *  - Added per-method "why" documentation for each format*()
 *    method (used by the 5 agent action classes).
 *
 * v1.2 CHANGES vs v1.1:
 *  - ActivityDate does NOT support MAX() in SOQL aggregate queries.
 *    Replaced the two AggregateResult queries with direct Task/Event
 *    queries using ORDER BY ActivityDate DESC, building per-contact
 *    counts and last-date maps manually in Apex.
 *  - All public method signatures unchanged.
 * ============================================================
 */
public without sharing class ONAAgentUtils {

    static final Integer MONTHS_BACK = 12;

    public class ContactStats {
        public Contact  c;
        public Integer  activityCount = 0;
        public Integer  lastDays      = 9999;
    }

    // ── Core data loader ─────────────────────────────────────────────────────
    public static List<ContactStats> getAccountContactStats(Id accountId) {
        List<ContactStats> stats  = new List<ContactStats>();
        Map<Id, ContactStats> nm  = new Map<Id, ContactStats>();

        for (Contact c : [
            SELECT Id, Name, Title, Department, Email
            FROM   Contact
            WHERE  AccountId = :accountId
            AND    IsDeleted  = false
            ORDER  BY Name
            LIMIT  50
        ]) {
            ContactStats st = new ContactStats();
            st.c = c;
            stats.add(st);
            nm.put(c.Id, st);
        }
        if (stats.isEmpty()) return stats;

        Set<Id> ids    = nm.keySet();
        Date    cutoff = Date.today().addMonths(-MONTHS_BACK);

        // ── Tasks — iterate records, build count + last date per contact ──────
        // ActivityDate does NOT support MAX() in AggregateResult; use direct query.
        Map<Id, Date> lastTask = new Map<Id, Date>();
        for (Task t : [
            SELECT WhoId, ActivityDate
            FROM   Task
            WHERE  WhoId IN :ids
            AND    ActivityDate >= :cutoff
            AND    IsDeleted = false
            ORDER  BY ActivityDate DESC
            LIMIT  5000
        ]) {
            if (t.ActivityDate == null) continue;
            ContactStats st = nm.get(t.WhoId);
            if (st == null) continue;
            st.activityCount++;
            if (!lastTask.containsKey(t.WhoId) || lastTask.get(t.WhoId) < t.ActivityDate)
                lastTask.put(t.WhoId, t.ActivityDate);
        }

        // ── Events — same pattern ─────────────────────────────────────────────
        Map<Id, Date> lastEvent = new Map<Id, Date>();
        for (Event e : [
            SELECT WhoId, ActivityDate
            FROM   Event
            WHERE  WhoId IN :ids
            AND    ActivityDate >= :cutoff
            AND    IsDeleted = false
            ORDER  BY ActivityDate DESC
            LIMIT  5000
        ]) {
            if (e.ActivityDate == null) continue;
            ContactStats st = nm.get(e.WhoId);
            if (st == null) continue;
            st.activityCount++;
            if (!lastEvent.containsKey(e.WhoId) || lastEvent.get(e.WhoId) < e.ActivityDate)
                lastEvent.put(e.WhoId, e.ActivityDate);
        }

        // ── Resolve lastDays from whichever source is more recent ─────────────
        for (ContactStats st : stats) {
            Id cid = st.c.Id;
            Date best = null;
            if (lastTask.containsKey(cid))  best = lastTask.get(cid);
            if (lastEvent.containsKey(cid)) {
                Date ed = lastEvent.get(cid);
                if (best == null || ed > best) best = ed;
            }
            if (best != null) st.lastDays = best.daysBetween(Date.today());
        }
        return stats;
    }

    // ── Scoring helpers ───────────────────────────────────────────────────────
    public static Integer influenceRank(ContactStats st) {
        return roleWeight(st.c.Title) * 10 + Math.min(st.activityCount, 50) * 3;
    }

    public static Integer roleWeight(String title) {
        if (title == null) return 2;
        String t = title.toLowerCase();
        if (t.contains('chief') || t.contains('ceo') || t.contains('cfo')
         || t.contains('cto')   || t.contains('president'))   return 10;
        if (t.startsWith('vp ') || t.contains('vice'))        return 8;
        if (t.contains('director') || t.contains('head'))     return 6;
        if (t.contains('manager') || t.contains('lead'))      return 4;
        return 2;
    }

    public static String decayLabel(Integer days) {
        if (days >= 9999) return 'Never contacted';
        if (days < 30)    return days + 'd ago';
        if (days < 90)    return (days / 7) + 'w ago';
        return (days / 30) + 'm ago';
    }

    // ── Deprecated v1.0 shims (kept for compile safety) ──────────────────────
    public static List<Contact> getAccountContacts(Id accountId) {
        return [SELECT Id, Name, Title, Department, Email
                FROM Contact WHERE AccountId = :accountId AND IsDeleted = false
                ORDER BY Name LIMIT 50];
    }
    public static Integer influenceRank(Contact c) { return roleWeight(c.Title) * 10; }
    public static Integer daysSince(Contact c)     { return 9999; }

    // ── Format account brief ──────────────────────────────────────────────────
    /**
     * ── formatAccountBrief ───────────────────────────────────────────────
     * Used by: ONAAgentGetAccountBrief (subagent: Account Network Health)
     *
     * Produces a top-level "is this account healthy?" summary:
     *   - total contacts mapped + departments covered
     *   - Active (<60d) / Cooling (>60d) / Dark (never) split
     *   - the single highest-influence contact ("top influencer")
     *   - 1-3 recommended next actions, generated only if relevant
     *     (e.g. "Re-engage N cooling contact(s)" is omitted if N=0)
     *
     * This is typically the FIRST question a seller asks about an
     * account, so it deliberately stays high-level — detailed
     * breakdowns are handled by the other 4 actions.
     */
    public static String formatAccountBrief(Id accountId) {
        List<ContactStats> contacts = getAccountContactStats(accountId);
        if (contacts.isEmpty())
            return 'No contacts found for this account. Ensure contacts are linked in Salesforce.';

        List<Account> accts = [SELECT Name FROM Account WHERE Id = :accountId LIMIT 1];
        String acctName = accts.isEmpty() ? 'Account' : accts[0].Name;

        Integer cold = 0, warm = 0, dark = 0;
        Set<String> depts = new Set<String>();
        Integer topScore = 0; String topName = '';

        for (ContactStats st : contacts) {
            Integer d = st.lastDays;
            Integer s = influenceRank(st);
            if (d >= 9999)   dark++;
            else if (d > 60) cold++;
            else             warm++;
            if (s > topScore) { topScore = s; topName = st.c.Name; }
            if (String.isNotBlank(st.c.Department)) depts.add(st.c.Department);
        }

        String s = 'RELATIONSHIP BRIEF — ' + acctName.toUpperCase() + '\n\n';
        s += 'Network: ' + contacts.size() + ' contacts mapped\n';
        s += 'Departments covered: ' + depts.size() + '\n\n';
        s += 'HEALTH SIGNALS\n';
        s += '• Active (contacted < 60 days): ' + warm + '\n';
        s += '• Cooling (contacted > 60 days): ' + cold + '\n';
        s += '• Dark (never contacted): ' + dark + '\n';
        s += '• Top influencer: ' + topName + '\n\n';
        s += 'RECOMMENDED ACTIONS\n';
        if (cold > 0) s += '1. Re-engage ' + cold + ' cooling contact(s)\n';
        if (dark > 0) s += '2. Map introduction paths to ' + dark + ' dark contact(s)\n';
        s += '3. Ask "Who should I prioritise?" for a ranked list';
        return s;
    }

    // ── Format top influencers ────────────────────────────────────────────────
    /**
     * ── formatTopInfluencers ─────────────────────────────────────────────
     * Used by: ONAAgentGetTopInfluencers (subagent: Contact Prioritisation)
     *
     * Ranks ALL contacts on the account by influenceRank() (title weight
     * ×10 + activity count ×3) and returns the top `lim` (default 5,
     * capped at 10 by the calling action class).
     *
     * Per contact shows: name, title, and a status icon —
     *   ✓ Active   — contacted within 60 days
     *   ❄ Cooling  — last contact >60 days ago
     *   🌑 Never contacted — no activity history at all
     *
     * Tie-breaking: contacts with identical influenceRank scores are
     * grouped together and emitted in query order (Contact.Name ASC,
     * from getAccountContactStats) — deterministic, no random ordering.
     */
    public static String formatTopInfluencers(Id accountId, Integer lim) {
        List<ContactStats> contacts = getAccountContactStats(accountId);
        if (contacts.isEmpty()) return 'No contacts found for this account.';

        Map<Integer, List<ContactStats>> ranked = new Map<Integer, List<ContactStats>>();
        for (ContactStats st : contacts) {
            Integer r = influenceRank(st);
            if (!ranked.containsKey(r)) ranked.put(r, new List<ContactStats>());
            ranked.get(r).add(st);
        }
        List<Integer> scores = new List<Integer>(ranked.keySet());
        scores.sort();
        List<ContactStats> sorted = new List<ContactStats>();
        for (Integer i = scores.size()-1; i >= 0 && sorted.size() < lim; i--)
            for (ContactStats st : ranked.get(scores[i]))
                if (sorted.size() < lim) sorted.add(st);

        String s = 'TOP ' + sorted.size() + ' PRIORITY CONTACTS\n\n';
        Integer cnt = 0;
        for (ContactStats st : sorted) {
            cnt++;
            Integer days = st.lastDays;
            String status = days >= 9999 ? '🌑 Never contacted'
                          : days > 60    ? '❄ Cooling — ' + decayLabel(days)
                          : '✓ Active — ' + decayLabel(days);
            s += cnt + '. ' + st.c.Name + ' — ' + (st.c.Title != null ? st.c.Title : 'No title') + '\n';
            s += '   Status: ' + status + '\n\n';
        }
        s += 'Ask "How do I reach [name]?" to get a warm introduction path.';
        return s;
    }

    // ── Format at-risk contacts ───────────────────────────────────────────────
    /**
     * ── formatAtRiskContacts ─────────────────────────────────────────────
     * Used by: ONAAgentGetAtRiskContacts (subagent: At-Risk Detection)
     *
     * Buckets every contact into one of three risk tiers based on
     * lastDays (days since most recent Task or Event):
     *   - DARK     : lastDays >= 9999  (never contacted at all)
     *   - COLD     : lastDays > 60     (relationship has gone quiet)
     *   - COOLING  : 30 < lastDays <= 60 (early warning — not yet cold)
     *   - (no bucket if lastDays <= 30 — considered healthy, omitted)
     *
     * SPOF (single-point-of-failure) warning:
     *   The contact with the highest influenceRank() across the WHOLE
     *   account (regardless of their own risk tier) is called out by
     *   name — "if this person leaves or goes quiet, coverage drops
     *   significantly". This fires even if that contact is currently
     *   Active, because losing your #1 contact is a risk regardless
     *   of their current engagement level.
     *
     * If all three buckets are empty, returns a single "network health
     * is good" message instead of three empty section headers.
     */
    public static String formatAtRiskContacts(Id accountId) {
        List<ContactStats> contacts = getAccountContactStats(accountId);
        if (contacts.isEmpty()) return 'No contacts found for this account.';

        List<String> critical = new List<String>();
        List<String> cooling  = new List<String>();
        List<String> dark     = new List<String>();
        Integer topScore = 0; String spofName = '';

        for (ContactStats st : contacts) {
            Integer days  = st.lastDays;
            Integer score = influenceRank(st);
            if (score > topScore) { topScore = score; spofName = st.c.Name; }
            String title = st.c.Title != null ? st.c.Title : 'Unknown';
            if (days >= 9999)
                dark.add('• ' + st.c.Name + ' (' + title + ')');
            else if (days > 60)
                critical.add('• ' + st.c.Name + ' (' + title + ') — ' + decayLabel(days));
            else if (days > 30)
                cooling.add('• ' + st.c.Name + ' (' + title + ') — ' + decayLabel(days));
        }

        String s = 'RELATIONSHIP RISK SIGNALS\n\n';
        if (String.isNotBlank(spofName)) {
            s += '⚡ SINGLE-POINT-OF-FAILURE RISK\n• ' + spofName;
            s += ' is the top-ranked contact. Losing this relationship significantly reduces coverage.\n\n';
        }
        if (!critical.isEmpty()) {
            s += '❄ COLD — IMMEDIATE RE-ENGAGEMENT NEEDED\n';
            for (String l : critical) s += l + '\n';
            s += '\n';
        }
        if (!cooling.isEmpty()) {
            s += '⚠ COOLING — MONITOR CLOSELY\n';
            for (String l : cooling) s += l + '\n';
            s += '\n';
        }
        if (!dark.isEmpty()) {
            s += '🌑 DARK — NEVER CONTACTED\n';
            for (String l : dark) s += l + '\n';
            s += '\n';
        }
        if (critical.isEmpty() && cooling.isEmpty() && dark.isEmpty())
            s += '✓ No at-risk contacts detected. Network health is good.';
        else
            s += 'Ask "How do I reach [name]?" for the introduction path.';
        return s;
    }

    // ── Format warm intro path ────────────────────────────────────────────────
    /**
     * ── formatIntroPath ──────────────────────────────────────────────────
     * Used by: ONAAgentGetWarmIntroPath (subagent: Warm Intro Path Discovery)
     *
     * Finds a single best 2-hop path: You → Bridge Contact → Target.
     *
     * Bridge selection: among all contacts at the account EXCLUDING the
     * target, picks the one with the highest influenceRank() that is
     * ALSO currently active (lastDays < 9999, i.e. has at least one
     * recorded activity ever). An influential but completely dark
     * contact would make a useless bridge — they can't introduce anyone
     * if the seller has never engaged with them either.
     *
     * If no qualifying bridge exists (e.g. every other contact is also
     * dark, or the account has only 1 contact), falls back to a
     * "connect on LinkedIn first" suggestion rather than failing.
     *
     * Output also includes a ready-to-send "ask" message template,
     * personalised with the bridge's first name and the target's
     * full name — designed to be copy-pasted by the seller.
     *
     * NOTE: this is a SIMPLIFIED single-hop-bridge model — unlike
     * ONAController's Alg 8 (full BFS, up to 3 hops, returns up to 3
     * distinct paths), this returns at most ONE path with exactly one
     * intermediary. Sufficient for conversational use; for the full
     * multi-path graph view, direct the user to the ONA app.
     */
    public static String formatIntroPath(Id accountId, Id targetId) {
        List<ContactStats> contacts = getAccountContactStats(accountId);
        if (contacts.isEmpty()) return 'No contacts found for this account.';

        ContactStats target = null;
        ContactStats bridge = null;
        Integer bestScore = 0;

        for (ContactStats st : contacts) {
            if (st.c.Id == targetId) { target = st; continue; }
            Integer score = influenceRank(st);
            if (score > bestScore && st.lastDays < 9999) { bestScore = score; bridge = st; }
        }

        if (target == null) return 'Target contact not found on this account.';

        Integer days = target.lastDays;
        String s = 'WARM INTRO PATH TO ' + target.c.Name.toUpperCase() + '\n\n';
        s += 'Target: ' + target.c.Name + ' — ' + (target.c.Title != null ? target.c.Title : 'Unknown title') + '\n';
        s += 'Last contact: ' + (days >= 9999 ? 'Never' : decayLabel(days));
        if (days > 60) s += ' ⚠ Cold — warm intro essential';
        s += '\n\n';

        if (bridge != null) {
            s += 'RECOMMENDED PATH (2 hops)\n';
            s += 'Step 1 → Reach out to ' + bridge.c.Name + ' (' + (bridge.c.Title != null ? bridge.c.Title : 'Contact') + ')\n';
            s += 'Step 2 → Ask them to introduce you to ' + target.c.Name + '\n\n';
            s += 'WHAT TO SAY TO ' + bridge.c.Name.split(' ')[0].toUpperCase() + '\n';
            s += '"I\'m connecting with all the key stakeholders on this account. ';
            s += 'Given your relationship with ' + target.c.Name + ', could you make a quick introduction?"';
        } else {
            s += 'No warm path found. Consider connecting on LinkedIn first.';
        }
        return s;
    }

    // ── Format pre-meeting brief ──────────────────────────────────────────────
    /**
     * ── formatPreMeetingBrief ────────────────────────────────────────────
     * Used by: ONAAgentGetPreMeetingBrief (subagent: Pre-Meeting Briefing)
     *
     * Builds a "2 minutes before the call" briefing:
     *
     *  1. KEY CONTACTS — top 3 by influenceRank(), each with a one-line
     *     status + guidance:
     *       - Never contacted → "warm intro essential today"
     *       - Cold (>60d)     → "re-engagement priority"
     *       - Active          → "maintain and deepen"
     *
     *  2. TACTICAL NUDGES — re-scans the SAME top-3 contacts and, for
     *     anyone who is cold-but-not-dark (60 < lastDays < 9999), adds
     *     a specific warning: "open with business context, not a
     *     product pitch". Dark/never-contacted people are intentionally
     *     excluded from nudges — they're covered by the "warm intro
     *     essential" line above instead.
     *
     *  3. Two static closing reminders (clear next step; ask about
     *     uncovered departments) — these are constant across all
     *     accounts, not computed from data.
     *
     * `context` (meeting type/agenda) is used only as the header label
     * — it does not change which contacts are selected or how they're
     * ranked. Defaulting of blank context to "Upcoming Meeting" happens
     * in the calling action class (ONAAgentGetPreMeetingBrief).
     *
     * Tie-breaking for ranking: uses a Map<Integer,ContactStats> keyed
     * by influenceRank score; if two contacts tie on score, the `while
     * (ranked.containsKey(r)) r++` loop shifts the later one to score+1
     * so neither contact is silently dropped from the map.
     */
    public static String formatPreMeetingBrief(Id accountId, String context) {
        List<ContactStats> contacts = getAccountContactStats(accountId);
        if (contacts.isEmpty()) return 'No contacts found for this account.';

        String ctx = String.isBlank(context) ? 'Upcoming Meeting' : context;

        Map<Integer, ContactStats> ranked = new Map<Integer, ContactStats>();
        for (ContactStats st : contacts) {
            Integer r = influenceRank(st);
            while (ranked.containsKey(r)) r++;
            ranked.put(r, st);
        }
        List<Integer> scores = new List<Integer>(ranked.keySet());
        scores.sort();

        String s = 'PRE-MEETING BRIEF — ' + ctx.toUpperCase() + '\n\n';
        Integer shown = 0;
        s += 'KEY CONTACTS\n';
        for (Integer i = scores.size()-1; i >= 0 && shown < 3; i--) {
            ContactStats st = ranked.get(scores[i]);
            Integer days = st.lastDays;
            shown++;
            s += shown + '. ' + st.c.Name + ' — ' + (st.c.Title != null ? st.c.Title : 'No title') + '\n';
            if (days >= 9999)   s += '   Never contacted — warm intro essential today\n';
            else if (days > 60) s += '   Cold (' + decayLabel(days) + ') — re-engagement priority\n';
            else                s += '   Active (' + decayLabel(days) + ') — maintain and deepen\n';
        }
        s += '\nTACTICAL NUDGES\n';
        shown = scores.size() > 0 ? 3 : 0;
        for (Integer i = scores.size()-1; i >= 0 && shown > 0; i--) {
            ContactStats st = ranked.get(scores[i]);
            shown--;
            if (st.lastDays > 60 && st.lastDays < 9999)
                s += '⚠ ' + st.c.Name.split(' ')[0] + ' is cold — open with business context, not a product pitch\n';
        }
        s += '• End the meeting with a clear agreed next step\n';
        s += '• Ask who covers any department you have not yet engaged';
        return s;
    }
}