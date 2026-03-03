import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

const SENTINEL_VALUES = ['No complaint found', 'ERROR', 'Failed to fetch pleadings.', ''];

const HF_EMBEDDING_URL =
  'https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-large-en-v1.5';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitIntoChunks(text: string): string[] {
  // Split on double newlines (paragraph-level chunks)
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [text.trim()];
  return paragraphs;
}

async function embedText(text: string, hfToken: string): Promise<number[] | null> {
  try {
    const response = await fetch(HF_EMBEDDING_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hfToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text }),
    });

    if (!response.ok) {
      console.error(`HuggingFace API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const embedding = await response.json();
    return embedding;
  } catch (err) {
    console.error('Embedding request failed:', err);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Total cases with valid summaries
    const { data: allCases, error: casesError } = await supabase
      .from('cases')
      .select('id, complaint_summary')
      .not('complaint_summary', 'is', null);

    if (casesError) {
      return NextResponse.json({ error: casesError.message }, { status: 500 });
    }

    const validCases = (allCases || []).filter(
      (c: { id: string; complaint_summary: string | null }) =>
        c.complaint_summary && !SENTINEL_VALUES.includes(c.complaint_summary)
    );

    // Cases already with embeddings
    const { data: embeddedChunks, error: chunksError } = await supabase
      .from('case_chunks')
      .select('case_id');

    if (chunksError) {
      return NextResponse.json({ error: chunksError.message }, { status: 500 });
    }

    const embeddedCaseIds = new Set((embeddedChunks || []).map((c: { case_id: string }) => c.case_id));
    const missingCount = validCases.filter((c: { id: string }) => !embeddedCaseIds.has(c.id)).length;

    return NextResponse.json({
      total_valid_cases: validCases.length,
      cases_with_embeddings: embeddedCaseIds.size,
      cases_missing_embeddings: missingCount,
    });
  } catch (err: unknown) {
    console.error('GET /api/admin/generate-embeddings error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hfToken = process.env.HUGGINGFACE_API_TOKEN;
    if (!hfToken) {
      return NextResponse.json(
        { error: 'HUGGINGFACE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    // Step 1: Fetch all cases with valid complaint summaries
    const { data: allCases, error: casesError } = await supabase
      .from('cases')
      .select('id, complaint_summary')
      .not('complaint_summary', 'is', null);

    if (casesError) {
      return NextResponse.json({ error: casesError.message }, { status: 500 });
    }

    const validCases = (allCases || []).filter(
      (c: { id: string; complaint_summary: string | null }) =>
        c.complaint_summary && !SENTINEL_VALUES.includes(c.complaint_summary)
    );

    // Step 2: Fetch case_ids already in case_chunks
    const { data: embeddedChunks, error: chunksError } = await supabase
      .from('case_chunks')
      .select('case_id');

    if (chunksError) {
      return NextResponse.json({ error: chunksError.message }, { status: 500 });
    }

    const embeddedCaseIds = new Set((embeddedChunks || []).map((c: { case_id: string }) => c.case_id));

    // Step 3: Compute difference
    const unembeddedCases = validCases.filter(
      (c: { id: string }) => !embeddedCaseIds.has(c.id)
    );

    if (unembeddedCases.length === 0) {
      return NextResponse.json({
        success: true,
        embedded: 0,
        total_cases: validCases.length,
        already_embedded: embeddedCaseIds.size,
        message: 'All cases already embedded',
      });
    }

    // Step 5-6: Process in batches
    let embeddedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < unembeddedCases.length; i += BATCH_SIZE) {
      const batch = unembeddedCases.slice(i, i + BATCH_SIZE);

      for (const caseItem of batch) {
        const summary = caseItem.complaint_summary as string;
        const chunks = splitIntoChunks(summary);

        let caseSuccess = true;
        for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
          const chunkText = chunks[chunkIdx];
          const embedding = await embedText(chunkText, hfToken);

          if (!embedding) {
            errors.push(`Failed to embed case ${caseItem.id} chunk ${chunkIdx}`);
            caseSuccess = false;
            break;
          }

          const { error: insertError } = await supabase.from('case_chunks').insert({
            case_id: caseItem.id,
            chunk_index: chunkIdx,
            content: chunkText,
            embedding: embedding,
          });

          if (insertError) {
            errors.push(`Failed to insert case ${caseItem.id} chunk ${chunkIdx}: ${insertError.message}`);
            caseSuccess = false;
            break;
          }
        }

        if (caseSuccess) {
          embeddedCount++;
        }
      }

      // Delay between batches (except after last batch)
      if (i + BATCH_SIZE < unembeddedCases.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return NextResponse.json({
      success: true,
      embedded: embeddedCount,
      total_cases: validCases.length,
      already_embedded: embeddedCaseIds.size,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (err: unknown) {
    console.error('POST /api/admin/generate-embeddings error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
