import type { MessageReaction, User, Client } from "discord.js";
import { getArticleByMessageId, saveFavorite, getFavorites, deleteFavorite } from "../storage/articleRepo.js";
import { saveToInstapaper } from "../integration/instapaper.js";

const HEART_EMOJIS = new Set([
  "❤️", "♥️", "💖", "💝", "💕", "💗", "💓", "🖤", "💜", "💙", "💚", "💛", "🧡", "🤍", "🤎", "❤️‍🔥", "❤️‍🩹"
]);

/**
 * Handles incoming reaction addition events on bot-posted messages.
 */
export async function handleReactionAdd(reaction: MessageReaction, user: User): Promise<void> {
  // Ignore bot reactions
  if (user.bot) {
    return;
  }

  // Handle partials
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error("[Reaction Listener] Failed to fetch partial reaction:", error);
      return;
    }
  }

  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error("[Reaction Listener] Failed to fetch partial message:", error);
      return;
    }
  }

  // Check if it is a heart emoji
  const emojiName = reaction.emoji.name;
  if (!emojiName || !HEART_EMOJIS.has(emojiName)) {
    return;
  }

  const messageId = reaction.message.id;
  const channelId = reaction.message.channelId;

  // Retrieve matching article from database
  const article = await getArticleByMessageId(messageId);
  if (!article) {
    // Message does not correspond to a tracked posted article
    return;
  }

  try {
    // Check if user already favorited this article (for idempotency)
    const existing = await getFavorites(user.id, {
      topic: article.topic,
      limit: 1
    });

    const isAlreadyFavorited = existing.some(fav => fav.articleId === article.id);
    if (isAlreadyFavorited) {
      return;
    }

    // Call Instapaper sync if configured
    let instapaperStatus: "SUCCESS" | "FAILED" | "SKIPPED" = "SKIPPED";
    if (article.url) {
      instapaperStatus = await saveToInstapaper(article.url);
    }

    // Persist to database
    await saveFavorite({
      userId: user.id,
      articleId: article.id,
      articleTopic: article.topic,
      channelId,
      messageId,
      instapaperStatus
    });

    console.log(`[Reaction Listener] Article "${article.title}" favorited by user ${user.username} (${user.id}). Instapaper status: ${instapaperStatus}`);
  } catch (error) {
    console.error("[Reaction Listener] Error handling favorite persistence:", error);
  }
}

/**
 * Handles incoming reaction removal events on bot-posted messages.
 */
export async function handleReactionRemove(reaction: MessageReaction, user: User): Promise<void> {
  // Ignore bot reactions
  if (user.bot) {
    return;
  }

  // Handle partials
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error("[Reaction Listener] Failed to fetch partial reaction:", error);
      return;
    }
  }

  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error("[Reaction Listener] Failed to fetch partial message:", error);
      return;
    }
  }

  // Check if it is a heart emoji
  const emojiName = reaction.emoji.name;
  if (!emojiName || !HEART_EMOJIS.has(emojiName)) {
    return;
  }

  const messageId = reaction.message.id;

  // Retrieve matching article from database
  const article = await getArticleByMessageId(messageId);
  if (!article) {
    return;
  }

  try {
    const deleted = await deleteFavorite(user.id, article.id, article.topic);
    if (deleted) {
      console.log(`[Reaction Listener] Article "${article.title}" unfavorited by user ${user.username} (${user.id}) via reaction removal.`);
    }
  } catch (error) {
    console.error("[Reaction Listener] Error handling favorite deletion on reaction removal:", error);
  }
}

/**
 * Registers the reaction event listeners.
 */
export function registerReactionListener(client: Client): void {
  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (user.partial) {
        user = await user.fetch();
      }
      await handleReactionAdd(reaction as MessageReaction, user as User);
    } catch (error) {
      console.error("[Reaction Listener] Error in messageReactionAdd event handler:", error);
    }
  });

  client.on("messageReactionRemove", async (reaction, user) => {
    try {
      if (user.partial) {
        user = await user.fetch();
      }
      await handleReactionRemove(reaction as MessageReaction, user as User);
    } catch (error) {
      console.error("[Reaction Listener] Error in messageReactionRemove event handler:", error);
    }
  });
}
