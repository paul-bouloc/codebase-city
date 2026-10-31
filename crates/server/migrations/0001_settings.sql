-- Runtime settings editable from the admin, with a cache in the server.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
