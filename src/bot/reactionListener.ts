import type { MessageReaction, User, Client } from "discord.js";
import {
  getArticleByMessageId,
  saveFavorite,
  getFavorites,
  deleteFavorite,
  getEmailForward,
  saveEmailForward
} from "../storage/articleRepo.js";
import { saveToInstapaper } from "../integration/instapaper.js";
import { sendForward } from "../services/emailService.js";

const HEART_EMOJIS = new Set([
  "❤️", "♥️", "💖", "💝", "💕", "💗", "💓", "🖤", "💜", "💙", "💚", "💛", "🧡", "🤍", "🤎", "❤️‍🔥", "❤️‍🩹"
]);

const MAIL_EMOJIS = new Set([
  "📧", "✉️", "✉", "📩", "📨", "📬", "📮"
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

  const emojiName = reaction.emoji.name;
  if (!emojiName) {
    return;
  }

  const forwardEmoji = process.env.FORWARD_EMAIL_EMOJI;
  const isHeart = HEART_EMOJIS.has(emojiName);
  const isForward = emojiName === forwardEmoji || MAIL_EMOJIS.has(emojiName);

  if (!isHeart && !isForward) {
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

  // Handle Email Forwarding Reaction
  if (isForward) {
    try {
      const recipientEmail = process.env.FORWARD_DESTINATION_EMAIL || "";
      if (!recipientEmail) {
        console.warn("[Reaction Listener] FORWARD_DESTINATION_EMAIL is not configured in env.");
        try {
          const dmChannel = await user.createDM();
          await dmChannel.send(`⚠️ Could not forward article **${article.title}**: The email forwarding destination address is not configured.`);
        } catch (dmErr) {
          console.warn(`[Reaction Listener] Could not send DM to user ${user.username}:`, dmErr);
        }
        return;
      }

      // Check database for existing forward for idempotency
      const existingForward = await getEmailForward(user.id, article.id, article.topic);
      if (existingForward && existingForward.status === "SUCCESS") {
        console.log(`[Reaction Listener] Email forward for "${article.title}" by ${user.username} already succeeded (idempotent).`);
        return;
      }

      // Mark status as PENDING in DB
      await saveEmailForward({
        userId: user.id,
        articleId: article.id,
        articleTopic: article.topic,
        channelId,
        messageId,
        recipientEmail,
        status: "PENDING",
      });

      const guildId = reaction.message.guildId || "@me";
      const messageLink = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

      const forwardResult = await sendForward({
        articleUrl: article.url || "",
        articleTitle: article.title,
        source: article.source,
        topic: article.topic,
        discordMessageLink: messageLink,
      });

      if (forwardResult.success) {
        await saveEmailForward({
          userId: user.id,
          articleId: article.id,
          articleTopic: article.topic,
          channelId,
          messageId,
          recipientEmail,
          status: "SUCCESS",
          error: null,
        });

        console.log(`[Reaction Listener] Email forward for article "${article.title}" by user ${user.username} succeeded.`);

        // React with success emoji on original message
        if (typeof reaction.message.react === "function") {
          try {
            await reaction.message.react("✅");
          } catch (reactErr) {
            console.warn("[Reaction Listener] Could not react with ✅ to message:", reactErr);
          }
        }

        try {
          const dmChannel = await user.createDM();
          let feedbackMsg = `✅ Successfully forwarded article **${article.title}** to **${recipientEmail}**!`;
          if (forwardResult.previewUrl) {
            feedbackMsg += `\n📧 Preview URL: ${forwardResult.previewUrl}`;
          }
          await dmChannel.send(feedbackMsg);
        } catch (dmErr) {
          console.warn(`[Reaction Listener] Could not send DM feedback to user ${user.username}:`, dmErr);
        }
      } else {
        await saveEmailForward({
          userId: user.id,
          articleId: article.id,
          articleTopic: article.topic,
          channelId,
          messageId,
          recipientEmail,
          status: "FAILED",
          error: forwardResult.error || "Unknown error",
        });

        console.error(`[Reaction Listener] Email forward for article "${article.title}" by user ${user.username} failed: ${forwardResult.error}`);

        // React with failure emoji on original message
        if (typeof reaction.message.react === "function") {
          try {
            await reaction.message.react("❌");
          } catch (reactErr) {
            console.warn("[Reaction Listener] Could not react with ❌ to message:", reactErr);
          }
        }

        try {
          const dmChannel = await user.createDM();
          await dmChannel.send(`❌ Failed to forward article **${article.title}**: ${forwardResult.error}`);
        } catch (dmErr) {
          console.warn(`[Reaction Listener] Could not send DM feedback to user ${user.username}:`, dmErr);
        }
      }
    } catch (error) {
      console.error("[Reaction Listener] Error handling email forwarding:", error);
    }
    return;
  }

  // Handle Heart Curation Favorite Reaction
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
