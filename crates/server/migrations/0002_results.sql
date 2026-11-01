-- Repositories with at least one stored result, named as GitHub spells them.
CREATE TABLE repos (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner      TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GitHub names are case-insensitive.
CREATE UNIQUE INDEX repos_name ON repos (lower(owner), lower(name));

-- One analysis of one commit by one version of the analyzer, as
-- brotli-compressed JSON.
CREATE TABLE results (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id          BIGINT NOT NULL REFERENCES repos ON DELETE CASCADE,
    sha              TEXT NOT NULL CHECK (sha ~ '^[0-9a-f]{40}$'),
    analyzer_version TEXT NOT NULL,
    format_version   INTEGER NOT NULL,
    body             BYTEA NOT NULL,
    raw_size         BIGINT NOT NULL,
    stored_size      BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (repo_id, sha, analyzer_version)
);

CREATE INDEX results_latest ON results (repo_id, created_at DESC, id DESC);

-- How many commits of a repository are kept.
INSERT INTO settings (key, value) VALUES ('results_kept_per_repo', '3');
