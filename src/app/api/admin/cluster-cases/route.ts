import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if clustering has been run
    const { data: clusters, error: clusterError } = await supabase
      .from('case_clusters')
      .select('cluster_id, case_id, is_representative');

    if (clusterError) {
      return NextResponse.json({ error: clusterError.message }, { status: 500 });
    }

    if (!clusters || clusters.length === 0) {
      return NextResponse.json({
        clustering_run: false,
        total_clusters: 0,
        total_cases_clustered: 0,
        representatives: 0,
        cases_per_cluster: null,
      });
    }

    // Compute stats
    const clusterMap = new Map<number, number>();
    let representatives = 0;

    for (const row of clusters) {
      clusterMap.set(row.cluster_id, (clusterMap.get(row.cluster_id) || 0) + 1);
      if (row.is_representative) representatives++;
    }

    const sizes = [...clusterMap.values()];
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const avg = Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 10) / 10;

    return NextResponse.json({
      clustering_run: true,
      total_clusters: clusterMap.size,
      total_cases_clustered: clusters.length,
      representatives,
      cases_per_cluster: { min, max, avg },
    });
  } catch (err: unknown) {
    console.error('GET /api/admin/cluster-cases error:', err);
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

    // Parse optional target_cluster_size from body
    let targetClusterSize = 20;
    try {
      const body = await request.json();
      if (body.target_cluster_size && typeof body.target_cluster_size === 'number') {
        targetClusterSize = body.target_cluster_size;
      }
    } catch {
      // Empty body is fine — use default
    }

    const { data: clusterCount, error } = await supabase.rpc('cluster_cases', {
      target_cluster_size: targetClusterSize,
    });

    if (error) {
      console.error('cluster_cases RPC error:', error);
      return NextResponse.json(
        { error: `Clustering failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      cluster_count: clusterCount,
      target_cluster_size: targetClusterSize,
    });
  } catch (err: unknown) {
    console.error('POST /api/admin/cluster-cases error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
