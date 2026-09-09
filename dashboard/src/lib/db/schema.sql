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
