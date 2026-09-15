  curl -i -X POST \
    'https://staging.connect.121.health/api/v1/causeway/events' \
    -H "X-API-Key: ${CONNECT_API_KEY_STAGING_MESSAGE_TEST}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    --data-raw '{
      "type": "olive.message.send",
      "data": {
        "member_id": "51b18566-225f-4451-89b4-b88bf0e72df1",
        "sender_id": "17e7b09e-0022-4d65-947d-1905ec619af5",
        "actor_id": "17e7b09e-0022-4d65-947d-1905ec619af5",
        "content": "testing testing 123"
      }
    }'
