import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { decrypt } from '@/lib/encryption';
import { rerankCases } from '@/lib/personalization';

const SENTINEL_VALUES = ['No complaint found', 'ERROR', 'Failed to fetch pleadings.', ''];

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { query } = await request.json();
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // Get user settings for Gemini key
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    let synthesis: string | null = null;

    // Try vector search if HuggingFace token is available
    let matchedCaseIds: string[] = [];
    const hfToken = process.env.HUGGINGFACE_API_TOKEN;

    if (hfToken) {
      try {
        // Embed the query using HuggingFace Inference API
        const embeddingResponse = await fetch(
          'https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-large-en-v1.5',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${hfToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ inputs: query }),
          }
        );

        if (embeddingResponse.ok) {
          const embedding = await embeddingResponse.json();

          // Vector similarity search via Supabase RPC
          const { data: chunks, error: searchError } = await supabase.rpc(
            'match_case_chunks',
            {
              query_embedding: embedding,
              match_threshold: 0.3,
              match_count: 20,
            }
          );

          if (chunks && !searchError) {
            // Group by case_id, keep best similarity per case
            const caseScores = new Map<string, number>();
            for (const chunk of chunks) {
              const existing = caseScores.get(chunk.case_id) || 0;
              if (chunk.similarity > existing) {
                caseScores.set(chunk.case_id, chunk.similarity);
              }
            }
            // Sort by score descending and take top 10
            matchedCaseIds = [...caseScores.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([id]) => id);
          }
        }
      } catch (err) {
        console.error('Embedding/vector search failed, falling back to text search:', err);
      }
    }

    // Fallback: text search if vector search returned nothing
    if (matchedCaseIds.length === 0) {
      const { data: textResults } = await supabase
        .from('cases')
        .select('id')
        .not('complaint_summary', 'is', null)
        .neq('complaint_summary', '')
        .neq('complaint_summary', 'No complaint found')
        .neq('complaint_summary', 'ERROR')
        .neq('complaint_summary', 'Failed to fetch pleadings.')
        .or(`case_name.ilike.%${query}%,complaint_summary.ilike.%${query}%,nature_of_suit.ilike.%${query}%,cause_of_action.ilike.%${query}%,entity.ilike.%${query}%`)
        .limit(10);

      matchedCaseIds = (textResults || []).map((r: any) => r.id);
    }

    if (matchedCaseIds.length === 0) {
      return NextResponse.json({ cases: [], synthesis: null, query, total_count: 0 });
    }

    // Fetch full case data
    const { data: cases } = await supabase
      .from('cases')
      .select('*, consultant_results(*)')
      .in('id', matchedCaseIds);

    // Fetch user reactions
    const { data: reactions } = await supabase
      .from('user_reactions')
      .select('*')
      .eq('user_id', session.user.id)
      .in('case_id', matchedCaseIds);

    const reactionsMap = new Map(
      (reactions || []).map((r: any) => [r.case_id, r])
    );

    // Merge results
    const merged = (cases || [])
      .filter((c: any) => !SENTINEL_VALUES.includes(c.complaint_summary || ''))
      .map((c: any) => ({
        ...c,
        consultant_results: c.consultant_results?.[0] || null,
        user_reaction: reactionsMap.get(c.id) || null,
      }));

    // Maintain vector search ordering as base relevance
    const idOrder = new Map(matchedCaseIds.map((id, i) => [id, i]));
    merged.sort((a: any, b: any) => (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99));

    // Apply personalization reranking based on user preferences
    const { data: preferences } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', session.user.id);

    let finalResults = merged;
    if (preferences && preferences.length > 0) {
      finalResults = rerankCases(merged, preferences);
    }

    // Optional: Gemini synthesis
    if (settings?.api_key_encrypted && finalResults.length > 0) {
      try {
        const apiKey = decrypt(settings.api_key_encrypted);
        const modelId = settings.model_preference || 'gemini-2.0-flash';

        const context = finalResults.slice(0, 5).map((c: any, i: number) =>
          `Case ${i + 1}: ${c.case_name}\nCourt: ${c.court_name || 'N/A'}\nNature: ${c.nature_of_suit || 'N/A'}\nSummary: ${(c.complaint_summary || '').slice(0, 500)}`
        ).join('\n\n');

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `You are a legal research assistant. Based on the following search query and matching cases, provide a brief synthesis (2-3 paragraphs) that highlights key themes, common elements, and notable differences across these cases. Be concise and professional.\n\nSearch query: "${query}"\n\n${context}`
                }]
              }],
              generationConfig: {
                maxOutputTokens: 512,
                temperature: 0.3,
              },
            }),
          }
        );

        if (geminiResponse.ok) {
          const geminiData = await geminiResponse.json();
          synthesis = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || null;
        }
      } catch (err) {
        console.error('Gemini synthesis failed:', err);
        // Non-fatal — return results without synthesis
      }
    }

    return NextResponse.json({
      cases: finalResults,
      synthesis,
      query,
      total_count: finalResults.length,
    });
  } catch (err: any) {
    console.error('Search error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
