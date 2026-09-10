  curl -i -X POST \
    'https://staging.connect.121.health/api/v1/causeway/events' \
    -H "X-API-Key: ${CONNECT_API_KEY_STAGING_MESSAGE_TEST}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    --data-raw '{
      "type": "olive.message.send",
      "data": {
        "member_id": "51b18566-225f-4451-89b4-b88bf0e72df1",
        "sender_id": "0142d143-a313-49dc-ae42-cd4038833539",
        "actor_id": "0142d143-a313-49dc-ae42-cd4038833539",
        "content": "testing testing 123"
      }
    }'