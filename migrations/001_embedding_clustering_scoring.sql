-- Migration: Embedding Clustering & Per-User Scoring Infrastructure
-- Run this in Supabase SQL Editor

-- ============================================================
-- Part 1: New columns on `cases` table
-- ============================================================

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS case_viability text,
  ADD COLUMN IF NOT EXISTS viability_reasoning text,
  ADD COLUMN IF NOT EXISTS viability_scored_at timestamptz;

-- ============================================================
-- Part 2: case_embeddings_avg — one mean-pooled embedding per case
-- ============================================================

CREATE TABLE IF NOT EXISTS case_embeddings_avg (
  case_id text PRIMARY KEY REFERENCES cases(id),
  embedding vector(1024) NOT NULL,
  chunk_count integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- IVFFlat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_case_embeddings_avg_embedding
  ON case_embeddings_avg USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 20);

-- ============================================================
-- Part 3: case_clusters — cluster assignments
-- ============================================================

CREATE TABLE IF NOT EXISTS case_clusters (
  id serial PRIMARY KEY,
  cluster_id integer NOT NULL,
  case_id text NOT NULL REFERENCES cases(id) UNIQUE,
  is_representative boolean DEFAULT false,
  distance_to_representative float,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_clusters_cluster_id ON case_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_case_clusters_case_id ON case_clusters(case_id);

-- ============================================================
-- Part 4: user_case_scores — per-user relevance scores
-- ============================================================

CREATE TABLE IF NOT EXISTS user_case_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  case_id text NOT NULL REFERENCES cases(id),
  score integer NOT NULL CHECK (score >= 1 AND score <= 10),
  reasoning text,
  source text NOT NULL DEFAULT 'cluster',
  stale boolean DEFAULT false,
  scored_at timestamptz DEFAULT now(),
  UNIQUE (user_id, case_id)
);

CREATE INDEX IF NOT EXISTS idx_user_case_scores_user_stale
  ON user_case_scores(user_id, stale);

-- RLS policies
ALTER TABLE user_case_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scores"
  ON user_case_scores FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scores"
  ON user_case_scores FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scores"
  ON user_case_scores FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scores"
  ON user_case_scores FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Part 5: SQL Function — refresh_case_avg_embeddings()
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_case_avg_embeddings()
RETURNS integer AS $$
DECLARE
  row_count integer;
BEGIN
  TRUNCATE case_embeddings_avg;

  INSERT INTO case_embeddings_avg (case_id, embedding, chunk_count)
  SELECT
    case_id,
    avg(embedding)::vector(1024),
    count(*)::integer
  FROM case_chunks
  GROUP BY case_id;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Part 6: SQL Function — cluster_cases(target_cluster_size)
-- ============================================================

CREATE OR REPLACE FUNCTION cluster_cases(target_cluster_size integer DEFAULT 20)
RETURNS integer AS $$
DECLARE
  cluster_counter integer := 0;
  remaining integer;
  seed_case_id text;
  seed_embedding vector(1024);
  neighbor record;
  best_seed_id text;
  best_neighbor_count integer;
  candidate record;
BEGIN
  -- Step 1: Refresh averaged embeddings
  PERFORM refresh_case_avg_embeddings();

  -- Step 2: Truncate clusters (idempotent)
  TRUNCATE case_clusters;

  -- Step 3: Create temp table of unassigned case_ids
  CREATE TEMP TABLE unassigned_cases ON COMMIT DROP AS
    SELECT case_id, embedding
    FROM case_embeddings_avg;

  CREATE INDEX ON unassigned_cases(case_id);

  -- Step 5: Loop until no unassigned cases remain
  SELECT count(*) INTO remaining FROM unassigned_cases;

  WHILE remaining > 0 LOOP
    -- Step 6: If fewer than target_cluster_size remain, assign all to final cluster
    IF remaining <= target_cluster_size THEN
      -- Pick the first unassigned as representative
      SELECT uc.case_id, uc.embedding INTO seed_case_id, seed_embedding
      FROM unassigned_cases uc
      LIMIT 1;

      -- Insert representative
      INSERT INTO case_clusters (cluster_id, case_id, is_representative, distance_to_representative)
      VALUES (cluster_counter, seed_case_id, true, 0);

      -- Insert remaining members
      INSERT INTO case_clusters (cluster_id, case_id, is_representative, distance_to_representative)
      SELECT
        cluster_counter,
        uc.case_id,
        false,
        (uc.embedding <=> seed_embedding)::float
      FROM unassigned_cases uc
      WHERE uc.case_id != seed_case_id;

      cluster_counter := cluster_counter + 1;
      DELETE FROM unassigned_cases;
      remaining := 0;
      CONTINUE;
    END IF;

    -- Step 5a: Pick a seed — case with most neighbors within cosine distance < 0.3
    best_seed_id := NULL;
    best_neighbor_count := 0;

    FOR candidate IN
      SELECT uc.case_id, uc.embedding
      FROM unassigned_cases uc
    LOOP
      DECLARE
        n_count integer;
      BEGIN
        SELECT count(*) INTO n_count
        FROM unassigned_cases uc2
        WHERE uc2.case_id != candidate.case_id
          AND (uc2.embedding <=> candidate.embedding) < 0.3;

        IF n_count > best_neighbor_count THEN
          best_neighbor_count := n_count;
          best_seed_id := candidate.case_id;
          seed_embedding := candidate.embedding;
        END IF;
      END;
    END LOOP;

    -- If no case has neighbors within 0.3, pick any unassigned case
    IF best_seed_id IS NULL OR best_neighbor_count = 0 THEN
      SELECT uc.case_id, uc.embedding INTO best_seed_id, seed_embedding
      FROM unassigned_cases uc
      LIMIT 1;
    END IF;

    seed_case_id := best_seed_id;

    -- Step 5b: Insert seed as representative
    INSERT INTO case_clusters (cluster_id, case_id, is_representative, distance_to_representative)
    VALUES (cluster_counter, seed_case_id, true, 0);

    -- Step 5c: Find nearest (target_cluster_size - 1) unassigned cases to seed
    INSERT INTO case_clusters (cluster_id, case_id, is_representative, distance_to_representative)
    SELECT
      cluster_counter,
      sub.case_id,
      false,
      sub.dist
    FROM (
      SELECT
        uc.case_id,
        (uc.embedding <=> seed_embedding)::float AS dist
      FROM unassigned_cases uc
      WHERE uc.case_id != seed_case_id
      ORDER BY uc.embedding <=> seed_embedding
      LIMIT (target_cluster_size - 1)
    ) sub;

    -- Step 5f: Remove assigned cases from unassigned pool
    DELETE FROM unassigned_cases
    WHERE case_id IN (
      SELECT cc.case_id FROM case_clusters cc WHERE cc.cluster_id = cluster_counter
    );

    -- Step 5g: Increment
    cluster_counter := cluster_counter + 1;

    SELECT count(*) INTO remaining FROM unassigned_cases;
  END LOOP;

  RETURN cluster_counter;
END;
$$ LANGUAGE plpgsql;
