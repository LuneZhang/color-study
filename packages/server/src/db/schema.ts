export const SCHEMA_VERSION = 2;
export const migrationV2 = `
UPDATE library SET data=json_set(data,'$.origin','feed')
WHERE json_extract(data,'$.origin') IS NULL AND id IN (SELECT item_id FROM source_entries);
PRAGMA user_version = 2;
`;
export const migration = `
CREATE TABLE tutorials (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE UNIQUE INDEX tutorial_url ON tutorials(json_extract(data,'$.url'));
CREATE INDEX tutorial_topic ON tutorials(json_extract(data,'$.topic'));
CREATE TABLE knowledge (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE assets (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE sources (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE UNIQUE INDEX source_url ON sources(json_extract(data,'$.url'));
CREATE TABLE library (id TEXT PRIMARY KEY, thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE UNIQUE INDEX library_url ON library(json_extract(data,'$.url'));
CREATE TABLE source_entries (source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, guid TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES library(id) ON DELETE CASCADE, PRIMARY KEY(source_id,guid));
CREATE TABLE library_tutorials (item_id TEXT REFERENCES library(id) ON DELETE CASCADE, tutorial_id TEXT REFERENCES tutorials(id) ON DELETE RESTRICT, PRIMARY KEY(item_id,tutorial_id));
CREATE TABLE reviews (id TEXT PRIMARY KEY, tutorial_id TEXT NOT NULL REFERENCES tutorials(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE tutorial_assets (tutorial_id TEXT REFERENCES tutorials(id) ON DELETE CASCADE, asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT, role TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(tutorial_id,asset_id));
CREATE TABLE practices (id TEXT PRIMARY KEY, tutorial_id TEXT REFERENCES tutorials(id) ON DELETE RESTRICT, raw_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE practice_exports (id TEXT PRIMARY KEY, practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE conversations (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE UNIQUE INDEX conversation_page ON conversations(json_extract(data,'$.pageKey'));
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE INDEX messages_conversation ON messages(conversation_id);
CREATE TABLE message_assets (message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT, PRIMARY KEY(message_id,asset_id));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
PRAGMA user_version = 1;
`;
