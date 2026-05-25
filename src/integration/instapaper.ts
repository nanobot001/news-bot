/**
 * Sends a URL to the operator's Instapaper account via the Simple API.
 * Returns the sync status: "SUCCESS", "FAILED", or "SKIPPED".
 */
export async function saveToInstapaper(url: string): Promise<"SUCCESS" | "FAILED" | "SKIPPED"> {
  const username = process.env.INSTAPAPER_USERNAME;
  const password = process.env.INSTAPAPER_PASSWORD;

  if (!username || !password) {
    return "SKIPPED";
  }

  try {
    const body = new URLSearchParams();
    body.append("username", username);
    body.append("password", password);
    body.append("url", url);

    const response = await fetch("https://www.instapaper.com/api/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (response.ok || response.status === 201) {
      return "SUCCESS";
    } else {
      const text = await response.text();
      console.error(`[Instapaper Sync] Failed to save URL: ${url}. Status: ${response.status}. Response: ${text}`);
      return "FAILED";
    }
  } catch (error) {
    console.error(`[Instapaper Sync] Network/request error saving URL: ${url}`, error);
    return "FAILED";
  }
}
