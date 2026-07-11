// Vercel serverless function — runs on Vercel's servers, never in the browser.
// Deploy this with an ANTHROPIC_API_KEY environment variable set in your
// Vercel project settings. The key is never sent to or visible from the client.

// Very basic in-memory per-IP daily cap. Resets whenever the function's
// container cold-starts, so it's a soft speed bump, not a hard guarantee.
// Good enough for a small group of testers; swap in Upstash Redis or a
// database-backed counter before a public launch.
var usage = {};
var DAILY_LIMIT = 60;

function checkAndBumpUsage(ip) {
  var today = new Date().toISOString().slice(0, 10);
  var key = ip + ":" + today;
  usage[key] = (usage[key] || 0) + 1;
  return usage[key] <= DAILY_LIMIT;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  var ip = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!checkAndBumpUsage(ip)) {
    res.status(429).json({ error: "Daily capture limit reached. Try again tomorrow." });
    return;
  }

  var body = req.body || {};
  var message = body.message;
  var context = body.context;
  var nowString = body.nowString || new Date().toString();
  var weekday = body.weekday || "";

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing message" });
    return;
  }

  var system = "You are the parsing engine for Ping, a task capture app whose whole point is turning a stray thought into a structured task in under 5 seconds, without ever asking unnecessary questions.\n\n" +
    "Current datetime: " + nowString + " (" + weekday + "). Use this to resolve relative dates like \"tomorrow\", \"Friday\", \"next month\".\n\n" +
    (context ? "Recent conversation for context (most recent last):\n" + context + "\n\n" : "") +
    "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this shape:\n" +
    "{\n" +
    '  "title": string,\n' +
    '  "due_date": string or null,\n' +
    '  "reminder_time": string or null,\n' +
    '  "category": "Personal" | "Work" | "School" | "Errands" | "Health" | "Other",\n' +
    '  "priority": "low" | "medium" | "high" | "none",\n' +
    '  "repeat_rule": string or null,\n' +
    '  "confidence": "high" | "medium" | "low",\n' +
    '  "clarifying_question": string or null,\n' +
    '  "confirmation": string\n' +
    "}\n\n" +
    "due_date and reminder_time must be full ISO 8601 datetimes (local time, e.g. \"2026-07-12T18:00:00\") when a date/time is known, otherwise null.\n\n" +
    "Rules:\n" +
    "- A task with no date mentioned (e.g. \"buy milk\") is HIGH confidence with due_date null. Missing date is not ambiguity.\n" +
    "- Only use \"low\" confidence when the task itself is unclear or the user references something (\"the thing\", \"that appointment\") you cannot identify even with context. In that case set clarifying_question to ONE short, specific question, and set confirmation to an empty string.\n" +
    "- Use \"medium\" confidence when you had to make a reasonable guess (e.g. \"pay rent every month\" -> assume the 1st). Phrase confirmation as a soft, correctable confirmation.\n" +
    "- confirmation is a short, warm, one-sentence message in Ping's voice. Never include the word JSON or any technical language.\n" +
    "- repeat_rule should be plain English like \"Every month on the 1st\" or null if one-time.\n" +
    "- Never invent a reminder_time earlier than due_date unless the user explicitly asked for an earlier reminder.";

  try {
    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: system,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error("Anthropic API error:", errText);
      res.status(502).json({ error: "Upstream AI request failed" });
      return;
    }

    var data = await response.json();
    var text = (data.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
    var clean = text.replace(/```json|```/g, "").trim();
    var parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch (err) {
    console.error("Parse handler error:", err);
    res.status(500).json({ error: "Something went wrong parsing that." });
  }
};
