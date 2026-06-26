import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stories = await prisma.story.findMany({
    where: {
      topic: "nba"
    },
    include: {
      event: true,
      articles: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  console.log(`=== NBA Topic Stories (${stories.length}) ===`);
  for (const s of stories) {
    console.log(`Story ID: ${s.id}`);
    console.log(`Title: "${s.title}"`);
    console.log(`Status: ${s.status}`);
    console.log(`Merged Into: ${s.mergedIntoId || "None"}`);
    console.log(`Event: ${s.event ? `"${s.event.title}" (Thread ID: ${s.event.discordThreadId || "NULL"})` : "None"}`);
    console.log(`Articles (${s.articles.length}):`);
    for (const a of s.articles) {
      console.log(`  - Title: "${a.title}" | Msg ID: ${a.discordMessageId || "NULL"} | Channel ID: ${a.discordChannelId || "NULL"}`);
    }
    console.log(`-----------------------------------`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
