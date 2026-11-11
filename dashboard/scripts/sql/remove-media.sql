-- Run only after the old dashboard and cron workers have stopped.
-- No shared collection/table is dropped. External Discord posts are not touched.
WITH publication_lease_ids AS (
  SELECT 'publication_' || encode(sha256(convert_to(to_json('streamer:' || event_id)::text,'UTF8')),'hex') AS doc_id
  FROM (
    SELECT doc_id AS event_id FROM documents WHERE collection='guildStreamerEvents'
    UNION
    SELECT data->>'resourceId' FROM documents WHERE collection='discordPublications' AND data->>'kind'='guild-streamer'
  ) events WHERE event_id IS NOT NULL
), removed_documents AS (
  DELETE FROM documents
  WHERE collection IN ('guildStreamers','guildStreamerEvents','guildStreamerIdentities',
                       'streamerProviderQuota','streamerTwitchSignals')
     OR (collection='dashboardSettings' AND doc_id='guildStreamers')
     OR (collection IN ('automationLeases','automationTaskRuns') AND doc_id='guild-streamers')
     OR (collection='automationLeases' AND doc_id IN (SELECT doc_id FROM publication_lease_ids))
     OR (collection='discordPublications' AND data->>'kind'='guild-streamer')
     OR (collection='externalApiCooldowns' AND
         (doc_id LIKE 'twitch:%' OR doc_id LIKE 'youtube:%' OR doc_id LIKE 'tiktok:%'))
  RETURNING collection
), removed_logs AS (
  DELETE FROM system_logs
  WHERE resource_type='guild-streamer' OR event LIKE 'streamers.%'
  RETURNING id
)
SELECT collection AS category,count(*)::int AS removed FROM removed_documents GROUP BY collection
UNION ALL
SELECT 'system_logs',count(*)::int FROM removed_logs
ORDER BY category;
