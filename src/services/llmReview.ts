import { GoogleGenAI, Type } from "@google/genai";
import { prisma } from "../storage/prismaClient.js";
import { ARTICLE_STATUSES } from "../storage/articleStatus.js";
import { type Client } from "discord.js";
import { formatArticleEmbed } from "../bot/postEmbed.js";
import { updateEventIndex, generateIndexEmbed } from "../bot/indexManager.js";
import { createCoverageIndexThread } from "../bot/threadUtils.js";

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Schema definition for Gemini response using Type from @google/genai
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    merges: {
      type: Type.ARRAY,
      description: "List of story merges where duplicate stories are merged together.",
      items: {
        type: Type.OBJECT,
        properties: {
          sourceStoryId: { type: Type.STRING, description: "The ID of the duplicate story to merge FROM." },
          targetStoryId: { type: Type.STRING, description: "The ID of the primary story to merge INTO." },
          reason: { type: Type.STRING, description: "Reasoning for the merge decision." }
        },
        required: ["sourceStoryId", "targetStoryId", "reason"]
      }
    },
    reassignments: {
      type: Type.ARRAY,
      description: "List of article reassignments where articles are moved to a different story (or split out into a new story).",
      items: {
        type: Type.OBJECT,
        properties: {
          articleId: { type: Type.STRING, description: "The ID of the article to reassign." },
          targetStoryId: { type: Type.STRING, description: "The ID of the story to reassign to, or 'NEW' to split it into a new story." },
          newStoryTitle: { type: Type.STRING, description: "If targetStoryId is 'NEW', the title of the new story." },
          reason: { type: Type.STRING, description: "Reasoning for the reassignment/split." }
        },
        required: ["articleId", "targetStoryId", "reason"]
      }
    },
    events: {
      type: Type.ARRAY,
      description: "Groupings of related stories under common high-level events.",
      items: {
        type: Type.OBJECT,
        properties: {
          eventTitle: { type: Type.STRING, description: "Title of the high-level event (e.g. 'Knicks vs Celtics Playoffs 2026')." },
          storyIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "IDs of stories that belong to this event." }
        },
        required: ["eventTitle", "storyIds"]
      }
    }
  }
};

export async function runPeriodicReview(topic: string, client?: Client): Promise<void> {
  if (!ai) {
    console.warn(`[LLM Review] Gemini API key not configured. Skipping periodic review for topic: ${topic}`);
    return;
  }

  try {
    console.log(`[LLM Review] Running periodic review for topic: ${topic}`);

    // Fetch active (OPEN) stories from the last 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stories = await prisma.story.findMany({
      where: {
        topic,
        status: "OPEN",
        createdAt: { gte: cutoff }
      },
      include: {
        articles: true,
        event: true
      }
    });

    if (stories.length < 2) {
      console.log(`[LLM Review] Found only ${stories.length} active stories. No review necessary.`);
      return;
    }

    // Format the prompt with current story/article state
    let contextStr = "Active Stories and Articles:\n\n";
    for (const story of stories) {
      contextStr += `Story ID: ${story.id}\n`;
      contextStr += `Story Title: "${story.title}"\n`;
      if (story.event) {
        contextStr += `Current Event: "${story.event.title}" (Event ID: ${story.event.id})\n`;
      }
      contextStr += `Articles:\n`;
      for (const article of story.articles) {
        contextStr += `  - Article ID: ${article.id}\n`;
        contextStr += `    Title: "${article.title}"\n`;
        contextStr += `    Source: ${article.source}\n`;
        contextStr += `    URL: ${article.url || "None"}\n`;
      }
      contextStr += "\n";
    }

    const systemInstruction = 
      "You are an expert news editor. Analyze the stories and their grouped articles. " +
      "1. Identify duplicate stories that represent the exact same news event and should be MERGED. " +
      "2. Identify articles that are misgrouped and should be REASSIGNED to another story, or split out into a 'NEW' story if they are distinct. " +
      "3. Group related stories under a shared Event (e.g., 'NBA Playoffs Game 1' is an Event that might contain stories like 'Knicks win Game 1' and 'Brunson scores 40'). " +
      "Only create an Event if there are multiple distinct stories that belong under it. Do not create an Event for a single, standalone story. " +
      "Return your decisions in JSON format matching the schema provided.";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contextStr,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1
      }
    });

    if (!response.text) {
      console.warn("[LLM Review] Empty response from Gemini API.");
      return;
    }

    const decisions = JSON.parse(response.text);
    console.log("[LLM Review] Received decisions:", JSON.stringify(decisions, null, 2));

    // Execute Decisions

    // 1. Merges
    if (Array.isArray(decisions.merges)) {
      for (const merge of decisions.merges) {
        const { sourceStoryId, targetStoryId, reason } = merge;
        
        // Verify both stories exist and are open
        const sourceExists = stories.some(s => s.id === sourceStoryId);
        const targetExists = stories.some(s => s.id === targetStoryId);

        if (sourceExists && targetExists && sourceStoryId !== targetStoryId) {
          console.log(`[LLM Review] Merging story ${sourceStoryId} -> ${targetStoryId} (${reason})`);

          // Fetch complete story details including their events and articles
          const sourceStory = await prisma.story.findUnique({
            where: { id: sourceStoryId },
            include: { event: true, articles: true }
          });
          const targetStory = await prisma.story.findUnique({
            where: { id: targetStoryId },
            include: { event: true, articles: true }
          });

          if (sourceStory && targetStory) {
            const sourceEvent = sourceStory.event;
            const targetEvent = targetStory.event;

            const sourceThreadId = sourceEvent?.discordThreadId;
            let targetThreadId = targetEvent?.discordThreadId;

            // If target event doesn't have a thread but source event does, transfer the thread
            if (!targetThreadId && sourceThreadId && targetEvent) {
              targetThreadId = sourceThreadId;
              await prisma.event.update({
                where: { id: targetEvent.id },
                data: {
                  discordThreadId: sourceThreadId,
                  indexMessageId: sourceEvent?.indexMessageId
                }
              });
              if (sourceEvent) {
                await prisma.event.update({
                  where: { id: sourceEvent.id },
                  data: { discordThreadId: null, indexMessageId: null }
                });
              }
            }

            // DB merges execution
            await prisma.$transaction([
              // Update articles to target story
              prisma.article.updateMany({
                where: { storyId: sourceStoryId },
                data: { storyId: targetStoryId }
              }),
              // Mark source story as MERGED
              prisma.story.update({
                where: { id: sourceStoryId },
                data: {
                  status: "MERGED",
                  mergedIntoId: targetStoryId
                }
              }),
              // Log decision
              prisma.llmReviewLog.create({
                data: {
                  topic,
                  actionType: "MERGE",
                  targetId: sourceStoryId,
                  targetType: "STORY",
                  confidence: 1.0,
                  reason: `Merged into ${targetStoryId}. Reason: ${reason}`
                }
              })
            ]);

            // If we have a client and targetThreadId, move source articles into it
            if (client && targetThreadId) {
              for (const art of sourceStory.articles) {
                if (art.discordChannelId === targetThreadId) {
                  continue;
                }

                try {
                  // Delete old message
                  if (art.discordChannelId && art.discordMessageId) {
                    const oldChannel = await client.channels.fetch(art.discordChannelId).catch(() => null);
                    if (oldChannel?.isTextBased()) {
                      const oldMsg = await oldChannel.messages.fetch(art.discordMessageId).catch(() => null);
                      if (oldMsg) {
                        await oldMsg.delete().catch(err => console.warn(`Failed to delete message ${art.discordMessageId}:`, err));
                      }
                    }
                  }

                  // Repost in target thread
                  const formattedEvent = {
                    id: art.id,
                    type: "news.article" as const,
                    title: `[${targetStory.title}] ${art.title}`,
                    url: art.url ?? "",
                    sourceName: art.source,
                    topic: art.topic,
                    publishedAt: art.publishedAt?.toISOString() || undefined,
                  };

                  const threadChannel = await client.channels.fetch(targetThreadId).catch(() => null);
                  if (threadChannel?.isTextBased()) {
                    const embed = formatArticleEmbed({
                      event: formattedEvent,
                      score: art.score ?? 0,
                    });
                    const threadMsg = await (threadChannel as any).send({ embeds: [embed] });

                    // Update article message details
                    await prisma.article.update({
                      where: { id_topic: { id: art.id, topic: art.topic } },
                      data: {
                        discordChannelId: targetThreadId,
                        discordMessageId: threadMsg.id,
                        status: "RELATED_COVERAGE",
                        statusReason: `Merged to story thread via LLM review merge`
                      }
                    });
                  }
                } catch (moveErr) {
                  console.error(`Failed to move article ${art.id} during merge:`, moveErr);
                }
              }
            }

            // Archive the source thread if it was different
            if (client && sourceThreadId && sourceThreadId !== targetThreadId) {
              try {
                const oldThread = await client.channels.fetch(sourceThreadId).catch(() => null);
                if (oldThread?.isThread()) {
                  await oldThread.edit({
                    archived: true,
                    locked: true,
                    reason: `Story merged into "${targetStory.title}"`
                  });
                }
              } catch (oldThreadErr) {
                console.warn(`Failed to archive old thread ${sourceThreadId}:`, oldThreadErr);
              }

              // Delete old index message
              if (sourceEvent && sourceEvent.indexMessageId) {
                try {
                  const oldThread = await client.channels.fetch(sourceThreadId).catch(() => null);
                  if (oldThread?.isTextBased()) {
                    // Try to fetch from parent channel first (anchor style)
                    let oldIndexMsg = null;
                    if (oldThread.isThread() && oldThread.parent) {
                      oldIndexMsg = await (oldThread.parent as any).messages.fetch(sourceEvent.indexMessageId).catch(() => null);
                    }
                    // Fallback to within the thread
                    if (!oldIndexMsg) {
                      oldIndexMsg = await oldThread.messages.fetch(sourceEvent.indexMessageId).catch(() => null);
                    }
                    
                    if (oldIndexMsg) {
                      await oldIndexMsg.delete().catch(() => null);
                    }
                  }
                } catch (_) {}
              }

              // Clear old event's thread info
              if (sourceEvent) {
                await prisma.event.update({
                  where: { id: sourceEvent.id },
                  data: { discordThreadId: null, indexMessageId: null }
                });
              }
            }

            // Update indices
            if (client && targetEvent && targetThreadId && targetEvent.indexMessageId) {
              await updateEventIndex(client, targetEvent.id);
            }
          }
        }
      }
    }

    // 2. Reassignments
    if (Array.isArray(decisions.reassignments)) {
      for (const reassignment of decisions.reassignments) {
        const { articleId, targetStoryId, newStoryTitle, reason } = reassignment;
        
        // Find article to get its topic
        const article = await prisma.article.findUnique({
          where: { id_topic: { id: articleId, topic } }
        });

        if (!article) continue;

        if (targetStoryId === "NEW") {
          const title = newStoryTitle || `New Story: ${article.title}`;
          console.log(`[LLM Review] Splitting article ${articleId} into new story: "${title}"`);
          
          const newStory = await prisma.story.create({
            data: {
              topic,
              title
            }
          });

          await prisma.$transaction([
            prisma.article.update({
              where: { id_topic: { id: articleId, topic } },
              data: { storyId: newStory.id }
            }),
            prisma.llmReviewLog.create({
              data: {
                topic,
                actionType: "SPLIT",
                targetId: articleId,
                targetType: "ARTICLE",
                confidence: 1.0,
                reason: `Split out into new story: "${title}". Reason: ${reason}`
              }
            })
          ]);
        } else {
          // Verify target story exists and is open
          const targetExists = stories.some(s => s.id === targetStoryId);
          if (targetExists) {
            console.log(`[LLM Review] Reassigning article ${articleId} to story ${targetStoryId}`);
            
            await prisma.$transaction([
              prisma.article.update({
                where: { id_topic: { id: articleId, topic } },
                data: { storyId: targetStoryId }
              }),
              prisma.llmReviewLog.create({
                data: {
                  topic,
                  actionType: "REASSIGN",
                  targetId: articleId,
                  targetType: "ARTICLE",
                  confidence: 1.0,
                  reason: `Reassigned to story ${targetStoryId}. Reason: ${reason}`
                }
              })
            ]);
          }
        }
      }
    }

    // 3. Events
    if (Array.isArray(decisions.events)) {
      for (const group of decisions.events) {
        const { eventTitle, storyIds } = group;
        if (!eventTitle || !storyIds || storyIds.length === 0) continue;

        // Check if event already exists
        let event = await prisma.event.findFirst({
          where: { topic, title: eventTitle }
        });

        if (!event) {
          console.log(`[LLM Review] Creating new event: "${eventTitle}"`);
          event = await prisma.event.create({
            data: { topic, title: eventTitle }
          });
        }

        // Fetch stories with their current event and articles
        const storiesToGroup = await prisma.story.findMany({
          where: { id: { in: storyIds } },
          include: {
            event: true,
            articles: {
              where: { status: { not: "REMOVED" } }
            }
          }
        });

        // Find existing threads in the group
        const activeThreads = storiesToGroup
          .map(s => s.event)
          .filter((e): e is NonNullable<typeof e> => e !== null && e.discordThreadId !== null);

        let primaryThreadId: string | null = event.discordThreadId;
        let primaryIndexMsgId: string | null = event.indexMessageId;

        // If the target Event doesn't have a thread, but some stories do:
        if (!primaryThreadId && activeThreads.length > 0) {
          primaryThreadId = activeThreads[0].discordThreadId;
          primaryIndexMsgId = activeThreads[0].indexMessageId;
          
          event = await prisma.event.update({
            where: { id: event.id },
            data: {
              discordThreadId: primaryThreadId,
              indexMessageId: primaryIndexMsgId
            }
          });
        }

        // If we still don't have a thread, but we have multiple stories/articles in this group,
        // dynamically create a thread on the oldest posted article's parent channel.
        if (client && !primaryThreadId) {
          const postedArticles = storiesToGroup
            .flatMap(s => s.articles)
            .filter(a => a.discordChannelId && a.discordMessageId)
            .sort((a, b) => {
              const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
              const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
              return dateA - dateB;
            });

          if (postedArticles.length > 0 && (postedArticles.length > 1 || storiesToGroup.length > 1)) {
            const firstArt = postedArticles[0];
            try {
              const threadContext = await createCoverageIndexThread(
                client,
                firstArt.discordChannelId!,
                eventTitle
              );

              primaryThreadId = threadContext.threadId;
              primaryIndexMsgId = threadContext.indexMessageId;
              const thread = threadContext.thread;

              event = await prisma.event.update({
                where: { id: event.id },
                data: {
                  discordThreadId: primaryThreadId,
                  indexMessageId: primaryIndexMsgId
                }
              });

              // Auto-add managers
              const managerUserIdsStr = process.env.BOT_MANAGER_USER_IDS || "";
              const managerUserIds = managerUserIdsStr.split(",").map(id => id.trim()).filter(id => id.length > 0);
              for (const uId of managerUserIds) {
                try {
                  await thread.members.add(uId);
                } catch (memberErr) {
                  console.error(`Failed to auto-add user ${uId} to thread:`, memberErr);
                }
              }
            } catch (err) {
              console.error("Failed to dynamically create thread for event during LLM review:", err);
            }
          }
        }

        // If we have a thread but no index message, create it
        if (client && primaryThreadId && !primaryIndexMsgId) {
          try {
            const threadChannel = await client.channels.fetch(primaryThreadId).catch(() => null);
            if (threadChannel?.isTextBased()) {
              const indexEmbed = generateIndexEmbed(eventTitle, storiesToGroup, primaryThreadId);
              const indexMsg = await (threadChannel as any).send({ embeds: [indexEmbed] });
              await indexMsg.pin().catch((err: any) => console.warn("Failed to pin index message:", err));
              primaryIndexMsgId = indexMsg.id;

              event = await prisma.event.update({
                where: { id: event.id },
                data: {
                  indexMessageId: primaryIndexMsgId
                }
              });
            }
          } catch (err) {
            console.error("Failed to dynamically create index message for existing thread during LLM review:", err);
          }
        }

        // Rename primary thread to Event Title if client is provided
        if (client && primaryThreadId) {
          try {
            const primaryThread = await client.channels.fetch(primaryThreadId).catch(() => null);
            if (primaryThread?.isThread()) {
              await primaryThread.setName(eventTitle).catch(err => console.warn(`Failed to rename thread ${primaryThreadId}:`, err));
            }
          } catch (err) {
            console.warn(`Failed to fetch and rename thread ${primaryThreadId}:`, err);
          }
        }

        // Merge other threads/messages into the primary thread
        if (client && primaryThreadId) {
          for (const s of storiesToGroup) {
            const prevEvent = s.event;
            const oldThreadId = prevEvent?.discordThreadId;

            for (const art of s.articles) {
              // Skip the anchor article of the primary thread
              if (art.discordMessageId === primaryThreadId) {
                continue;
              }

              // Move article if it is not already inside the primary thread
              if (art.discordChannelId !== primaryThreadId) {
                try {
                  // Delete old message from Discord if it exists
                  if (art.discordChannelId && art.discordMessageId) {
                    const oldChannel = await client.channels.fetch(art.discordChannelId).catch(() => null);
                    if (oldChannel?.isTextBased()) {
                      const oldMsg = await oldChannel.messages.fetch(art.discordMessageId).catch(() => null);
                      if (oldMsg) {
                        await oldMsg.delete().catch(err => console.warn(`Failed to delete message ${art.discordMessageId}:`, err));
                      }
                    }
                  }

                  // Repost in primary thread with story prefix
                  const formattedEvent = {
                    id: art.id,
                    type: "news.article" as const,
                    title: `[${s.title}] ${art.title}`,
                    url: art.url ?? "",
                    sourceName: art.source,
                    topic: art.topic,
                    publishedAt: art.publishedAt?.toISOString() || undefined,
                  };
                  
                  const threadChannel = await client.channels.fetch(primaryThreadId).catch(() => null);
                  if (threadChannel?.isTextBased()) {
                    const embed = formatArticleEmbed({
                      event: formattedEvent,
                      score: art.score ?? 0,
                    });
                    const threadMsg = await (threadChannel as any).send({ embeds: [embed] });

                    // Update article in DB
                    await prisma.article.update({
                      where: { id_topic: { id: art.id, topic: art.topic } },
                      data: {
                        discordChannelId: primaryThreadId,
                        discordMessageId: threadMsg.id,
                        status: "RELATED_COVERAGE",
                        statusReason: `Merged to event thread "${eventTitle}" via LLM review`
                      }
                    });
                  }
                } catch (moveErr) {
                  console.error(`Failed to move article ${art.id} to primary thread:`, moveErr);
                }
              }
            }

            // Clean up the old thread if it was a different thread
            if (oldThreadId && oldThreadId !== primaryThreadId) {
              // Archive/lock the old thread
              try {
                const oldThread = await client.channels.fetch(oldThreadId).catch(() => null);
                if (oldThread?.isThread()) {
                  await oldThread.edit({ archived: true, locked: true, reason: `Merged into Event "${eventTitle}"` });
                }
              } catch (oldThreadErr) {
                console.warn(`Failed to archive old thread ${oldThreadId}:`, oldThreadErr);
              }

              // Delete old index message
              if (prevEvent && prevEvent.indexMessageId) {
                try {
                  const oldThread = await client.channels.fetch(oldThreadId).catch(() => null);
                  if (oldThread?.isTextBased()) {
                    const oldIndexMsg = await oldThread.messages.fetch(prevEvent.indexMessageId).catch(() => null);
                    if (oldIndexMsg) {
                      await oldIndexMsg.delete().catch(() => null);
                    }
                  }
                } catch (_) {}
              }

              // Clear the old Event's thread/index IDs
              await prisma.event.update({
                where: { id: prevEvent.id },
                data: { discordThreadId: null, indexMessageId: null }
              });
            }
          }
        }

        console.log(`[LLM Review] Grouping stories [${storyIds.join(", ")}] under event "${eventTitle}"`);
        
        for (const storyId of storyIds) {
          const storyExists = stories.some(s => s.id === storyId);
          if (storyExists) {
            await prisma.$transaction([
              prisma.story.update({
                where: { id: storyId },
                data: { eventId: event.id }
              }),
              prisma.llmReviewLog.create({
                data: {
                  topic,
                  actionType: "CREATE_EVENT",
                  targetId: storyId,
                  targetType: "STORY",
                  confidence: 1.0,
                  reason: `Linked to event: "${eventTitle}"`
                }
              })
            ]);
          }
        }

        // Update the event index after consolidation
        if (client && event.discordThreadId && event.indexMessageId) {
          await updateEventIndex(client, event.id);
        }
      }
    }

    console.log(`[LLM Review] Completed periodic review for topic: ${topic}`);

  } catch (error) {
    console.error(`[LLM Review] Error running periodic review:`, error);
  }
}
