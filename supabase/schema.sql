-- Run this once in the Supabase SQL editor.
-- After running, also add `rag` to: Project Settings → API → Exposed schemas.

create extension if not exists vector;

create schema if not exists rag;

create table if not exists rag.documents (
  id            uuid primary key default gen_random_uuid(),
  filename      text not null,
  num_pages     int,
  content_hash  text,                  -- sha256 hex of the file, for embedding cache
  created_at    timestamptz default now()
);
create unique index if not exists documents_content_hash_idx
  on rag.documents(content_hash) where content_hash is not null;

create table if not exists rag.chunks (
  id           bigserial primary key,
  document_id  uuid not null references rag.documents(id) on delete cascade,
  page_number  int,
  chunk_index  int,
  content      text not null,
  embedding    vector(768),                 -- Vertex text-embedding-004
  created_at   timestamptz default now()
);

-- HNSW (not IVFFlat): builds incrementally, accurate from row 1, no rebuild needed
-- as the table grows. IVFFlat would require ~lists*40 rows before its centroids
-- are meaningful, which fails on a cold-start demo.
create index if not exists chunks_embedding_idx
  on rag.chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_document_id_idx  on rag.chunks(document_id);
create index if not exists documents_created_at_idx on rag.documents(created_at);

-- Similarity search, optionally scoped to one document.
create or replace function rag.match_chunks(
  query_embedding vector(768),
  match_count     int  default 5,
  doc_id          uuid default null
)
returns table (
  id          bigint,
  document_id uuid,
  filename    text,
  page_number int,
  content     text,
  similarity  float
)
language sql stable as $$
  select
    c.id,
    c.document_id,
    d.filename,
    c.page_number,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from rag.chunks c
  join rag.documents d on d.id = c.document_id
  where doc_id is null or c.document_id = doc_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Delete docs older than the cutoff. Chunks cascade.
create or replace function rag.cleanup_old_documents(older_than interval default interval '24 hours')
returns int
language plpgsql as $$
declare
  deleted_count int;
begin
  delete from rag.documents where created_at < now() - older_than;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- RLS on, no policies: anon/authenticated get nothing.
-- service_role bypasses RLS, so server-side routes still work.
alter table rag.documents enable row level security;
alter table rag.chunks    enable row level security;

-- Grants so the service_role key (used server-side) can reach the schema via PostgREST.
grant usage on schema rag to service_role;
grant all on all tables    in schema rag to service_role;
grant all on all sequences in schema rag to service_role;
grant execute on all functions in schema rag to service_role;

alter default privileges in schema rag grant all on tables to service_role;
alter default privileges in schema rag grant all on sequences to service_role;
alter default privileges in schema rag grant execute on functions to service_role;
