import "dotenv/config";
import { runPeriodicReview } from "../src/services/llmReview.js";
import { loadAppConfig } from "../src/config/loadConfig.js";

async function main() {
  const config = await loadAppConfig();
  const topics = Object.keys(config.topics);
  console.log(`Forcing LLM review for topics: ${topics.join(", ")}`);
  for (const topic of topics) {
    try {
      await runPeriodicReview(topic);
    } catch (err) {
      console.error(`Error reviewing topic ${topic}:`, err);
    }
  }
  console.log("Forced LLM review complete.");
}

main().catch(console.error);
