# Olive agent lookup curl commands

Run these commands from `/Users/tim/Desktop/CODE/medusa/medusa-api`. Choose one environment below, then use the same lookup commands for either environment. Tokens are read from the local `.env`; no token values are stored in this document.

Both tokens have `emr:olive:admin` and `emr:olive:read`. The examples use `jq` to format JSON.

## Environment setup

### Staging

```bash
cd /Users/tim/Desktop/CODE/medusa/medusa-api
MEDUSA_BASE_URL='https://staging.medusa.121.health'
MEDUSA_API_KEY="$(rg '^STAGING_OLIVE_CONVERSATIONS_API_KEY=' .env | cut -d= -f2-)"
```

### Production

```bash
cd /Users/tim/Desktop/CODE/medusa/medusa-api
MEDUSA_BASE_URL='https://medusa.121.health'
MEDUSA_API_KEY="$(rg '^PRODUCTION_OLIVE_CONVERSATIONS_API_KEY=' .env | cut -d= -f2-)"
```

## 1. Discover recent conversation activity

```bash
curl --silent --show-error --fail-with-body \
  "${MEDUSA_BASE_URL}/api/v2/olive/recon/conversations/recent?minutes=1" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

- `minutes`: 1–15; defaults to 1.
- Rate limit: one request per 15 seconds per API client.
- Returns one row per conversation with its latest qualifying message, newest first.
- Excludes hidden, internal, and automated messages. It includes both inbound and outbound activity and can return existing conversations.
- Take `ticket_id`, `conversation_id`, and `message_id` from the row to process. The response does not include a member ID.

Set those IDs before the next calls:

```bash
TICKET_ID='<ticket_id from the recent-conversations response>'
CONVERSATION_ID='<conversation_id from the same row>'
MESSAGE_ID='<message_id from the same row>'
```

For the staging conversation inspected on September 9, 2026, these were:

```bash
TICKET_ID='ca5738e5-a9d7-48f6-aac4-8be05ba418c7'
CONVERSATION_ID='d10fbeab-8c9b-46ee-9b5a-eae48b7e8203'
MESSAGE_ID='094b3b4f-90c5-448e-9bfb-bffb9b23f7d6'
```

Use IDs returned by production when calling production.

## 2. Get the ticket and resolve the member ID

```bash
curl --silent --show-error --fail-with-body \
  "${MEDUSA_BASE_URL}/api/v2/olive/tickets/${TICKET_ID}" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

Returns the ticket and its conversations, including assignment fields and each conversation's latest qualifying message.

Find `conversations[].id == CONVERSATION_ID`. If its `latest_message.id == MESSAGE_ID`, take `latest_message.created_by_member_id` as `MEMBER_ID`.

If the latest message has changed or its member ID is null, use step 4 to locate the triggering message by ID. If that message also has no member ID, this sender-based lookup cannot resolve the member; do not assume a care-team user ID is a member ID.

```bash
MEMBER_ID='<created_by_member_id from the triggering message>'
```

For the inspected staging message:

```bash
MEMBER_ID='51b18566-225f-4451-89b4-b88bf0e72df1'
```

## 3. Get member context, including the last five messages

```bash
curl --silent --show-error --fail-with-body --location \
  "${MEDUSA_BASE_URL}/api/v2/olive/members/${MEMBER_ID}/context" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

Returns `member`, `active_feed`, `open_tickets`, `primary_provider`, `last_5_messages`, and `patient_note`. Member information includes demographics and `emr_patient_id` when populated.

`--location` follows the API's redirect to the canonical member if the original member was merged.

The five messages are from the member's feed and may span conversations. Check `conversation_id` and whether the triggering `MESSAGE_ID` is present. Fetch thread history when more context is needed.

## 4. Get conversation history when needed

```bash
curl --silent --show-error --fail-with-body \
  "${MEDUSA_BASE_URL}/api/v2/olive/conversations/${CONVERSATION_ID}/messages?limit=200" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

Returns `items`, `has_more`, and `next_after_sequence`. Each message includes content, direction, author IDs, sequence, timestamps, and visibility flags.

Messages are ordered oldest first. `limit` defaults to 50 and has a maximum of 200. While `has_more` is true, use the returned `next_after_sequence` to fetch the next page:

```bash
AFTER_SEQUENCE='<next_after_sequence from the previous response>'

curl --silent --show-error --fail-with-body \
  "${MEDUSA_BASE_URL}/api/v2/olive/conversations/${CONVERSATION_ID}/messages?limit=200&after_sequence=${AFTER_SEQUENCE}" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

The default excludes internal, hidden, and automated messages. To include internal care-team notes, add `&include=internal`. Supported opt-ins are `internal`, `hidden`, and `automated`, separated by commas; the ticket endpoint supports the same `include` parameter.

## Additional lookups

### Conversation status and assignments

```bash
curl --silent --show-error --fail-with-body \
  "${MEDUSA_BASE_URL}/api/v2/olive/conversations/${CONVERSATION_ID}" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

### Member profile without the composite context

```bash
curl --silent --show-error --fail-with-body --location \
  "${MEDUSA_BASE_URL}/api/v2/olive/members/${MEMBER_ID}" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

### Verify the token's identity and scopes

```bash
curl --silent --show-error --fail-with-body \
  "${MEDUSA_BASE_URL}/api/v1/auth/me" \
  -H "X-API-Key: ${MEDUSA_API_KEY}" | jq .
```

The created client IDs are `44` in staging and `562` in production. Recent conversations, ticket lookup, message history, and member context returned HTTP 200 with these tokens in both environments on September 9, 2026.
