export const MVP_COMMANDS = ["ping", "testfeed", "lastposts", "reload-config"] as const;

export type MvpCommandName = (typeof MVP_COMMANDS)[number];
