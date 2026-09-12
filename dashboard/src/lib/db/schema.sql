-- Схема сховища документів Mistblossom Vanguard.
--
-- Дані лежать так само, як лежали у Firestore: колекція + ідентифікатор
-- документа + вільний JSON. Це свідомий вибір, а не лінощі — переписати
-- двадцять девʼять модулів на реляційну схему одним кроком означало б
-- переписати й усю бізнес-логіку, тому спершу переїзд сховища, а нормалізація
-- окремих колекцій — коли й якщо стане потрібною.

CREATE TABLE IF NOT EXISTS documents (
  collection  text        NOT NULL,
  doc_id      text        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, doc_id)
);

-- Вибірки завжди йдуть у межах однієї колекції з сортуванням за полем JSON.
CREATE INDEX IF NOT EXISTS documents_collection_idx
  ON documents (collection);

-- Пошук за значенням поля: where("status", "==", "open") тощо.
-- jsonb_path_ops менший і швидший за стандартний GIN, а операція нам
-- потрібна рівно одна — @> (містить).
CREATE INDEX IF NOT EXISTS documents_data_gin_idx
  ON documents USING gin (data jsonb_path_ops);

-- Часті діапазонні запити по мілісекундних мітках: закриття пулів і рейдів
-- за розкладом. Без цих індексів cron-скан читав би колекцію цілком.
CREATE INDEX IF NOT EXISTS documents_closes_at_idx
  ON documents (collection, ((data ->> 'closesAtMs')::numeric))
  WHERE data ? 'closesAtMs';

CREATE INDEX IF NOT EXISTS documents_repeat_next_idx
  ON documents (collection, ((data ->> 'repeatNextAtMs')::numeric))
  WHERE data ? 'repeatNextAtMs';

CREATE INDEX IF NOT EXISTS documents_updated_at_idx
  ON documents (collection, updated_at DESC);

-- updated_at підтримує сама база: покладатись на застосунок означало б,
-- що будь-який пропущений виклик тихо ламає інкрементальні бекапи.
CREATE OR REPLACE FUNCTION documents_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_touch_updated_at ON documents;
CREATE TRIGGER documents_touch_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Structured runtime log (v2).
--
-- This replaces the old "Discord as log storage" model. Logs are retained for
-- exactly 3 days by the maintenance job and additionally bounded by a storage
-- / row budget. Discord receives only security events as a mirror; it is never
-- the source of truth for the log viewer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_logs (
  id             text        PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  level          text        NOT NULL CHECK (level IN ('debug','info','success','warning','error')),
  category       text        NOT NULL CHECK (category IN ('security','api','action','auth','discord','database','integration','system')),
  source         text        NOT NULL DEFAULT 'dashboard' CHECK (source IN ('dashboard','bot','cron','system')),
  event          text        NOT NULL,
  message        text,
  actor_id       text,
  actor_name     text,
  actor_group_id text,
  request_id     text,
  method         text,
  path           text,
  status_code    integer,
  duration_ms    integer,
  ip             text,
  resource_type  text,
  resource_id    text,
  fingerprint    text,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS system_logs_created_at_idx
  ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_category_created_idx
  ON system_logs (category, created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_level_created_idx
  ON system_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_event_created_idx
  ON system_logs (event, created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_request_id_idx
  ON system_logs (request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS system_logs_details_gin_idx
  ON system_logs USING gin (details jsonb_path_ops);

-- Runtime settings for the structured log subsystem.  This deliberately lives
-- beside system_logs rather than in the legacy Firestore-compatible document
-- wrapper: logging must keep working even when Firebase compatibility flags are
-- disabled on the self-hosted VPS.
CREATE TABLE IF NOT EXISTS system_log_settings (
  settings_key                 text        PRIMARY KEY DEFAULT 'default',
  security_discord_enabled     boolean     NOT NULL DEFAULT false,
  security_discord_channel_id  text        NOT NULL DEFAULT '',
  security_discord_min_level   text        NOT NULL DEFAULT 'warning' CHECK (security_discord_min_level IN ('info','warning','error')),
  max_storage_mb               integer     NOT NULL DEFAULT 192 CHECK (max_storage_mb BETWEEN 32 AND 1024),
  max_rows                     integer     NOT NULL DEFAULT 50000 CHECK (max_rows BETWEEN 5000 AND 250000),
  query_limit                  integer     NOT NULL DEFAULT 250 CHECK (query_limit BETWEEN 50 AND 500),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  updated_by                   text
);
