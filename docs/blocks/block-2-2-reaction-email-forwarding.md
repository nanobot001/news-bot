# Block 2-2: Reaction Email Forwarding

## Goal

Let a Discord user mark a posted article for email forwarding with a dedicated reaction, then send the article URL and metadata to a configured email destination.

## Scope

- **Forward Reaction Listener:**
  - Listen for a configured forwarding reaction on bot-posted article messages.
  - Ignore reactions on unrelated messages.
  - Ignore bot/self reactions.
  - Keep the forwarding reaction distinct from the heart favorite reaction.
- **URL-Centered Forwarding:**
  - Forward the article URL, title, source, topic, and original Discord message link.
  - Do not forward the Discord message body as the primary content.
- **Email Delivery Configuration:**
  - Add environment/config support for one email delivery method, such as SMTP or a provider API.
  - Add a configured default recipient email address.
  - Keep credentials out of source-controlled config files.
- **Forward Persistence and Idempotency:**
  - Store forwarding attempts in SQLite/Prisma, including:
    - Posted article ID or URL.
    - Topic key.
    - Discord channel ID and message ID.
    - Forwarding Discord user ID.
    - Recipient email.
    - Delivery status.
    - Created timestamp.
  - Treat repeated forwarding reactions from the same user on the same article as idempotent unless a retry is explicitly needed.
- **Operational Feedback:**
  - Log successful and failed email forwards.
  - If practical, send an ephemeral or direct acknowledgement to the reacting user when forwarding succeeds or fails.

## Out Of Scope

- Forwarding to Discord channels.
- Per-user email address books.
- Forwarding full article content.
- Email newsletter/digest generation.
- AI-generated summaries.
- Automatically undoing an email forward when the reaction is removed.

## Acceptance Criteria

- Adding the configured forwarding reaction to a bot-posted article sends an email containing the article URL and metadata.
- Forwarding reactions on unrelated messages are ignored.
- Repeated forwarding reactions from the same user on the same article do not send duplicate emails.
- Email credentials are loaded from environment/config and are not committed to source control.
- Failed email sends are recorded and logged without crashing the bot.
- Automated tests cover reaction filtering, forward idempotency, email payload construction, and email success/failure handling.

## Verification

- Run typecheck and automated tests.
- In a development Discord server, post a test article and add the configured forwarding reaction.
- Verify the configured recipient receives an email with the article URL, title, source, topic, and Discord message link.
- Repeat the reaction and verify it does not send a duplicate email.
- Temporarily use invalid email credentials and verify the failure is logged and persisted.

## Status

Pending.
