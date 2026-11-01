-- The body is already brotli-compressed: store it out of line without
-- trying to compress it again.
ALTER TABLE results ALTER COLUMN body SET STORAGE EXTERNAL;
